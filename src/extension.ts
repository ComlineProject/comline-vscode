import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  workspace,
  ExtensionContext,
  window,
  commands,
  tasks,
  Task,
  TaskScope,
  ProcessExecution,
  TaskRevealKind,
  TaskPanelKind,
  RelativePattern,
  StatusBarAlignment,
  StatusBarItem,
  QuickPickItem,
  QuickPickItemKind,
  Uri,
  languages,
  TextDocument,
  Position,
  Range,
  CompletionItem,
  CompletionItemKind,
  MarkdownString,
  Hover,
  ThemeColor,
  TextEditor,
} from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import {
  stripNonCode,
  keyPathAt,
  findBlockSpan,
  findEntryKeys,
  tokenRangeAround,
  resolveSchemaAtPath,
  resolveFieldByPathAndWord,
  idpValueKindLabel,
  IdpFieldSchema,
} from './idpSchema';

const execFileAsync = promisify(execFile);

let client: LanguageClient | undefined;

const SELECTED_PACKAGE_KEY = 'comline.selectedPackageRoot';

let extensionContext: ExtensionContext;
let packageStatusBarItem: StatusBarItem;
let discoveredPackageRoots: string[] = [];

interface GenerationTarget {
  name: string;
  version: string;
}

type TargetsState =
  | { status: 'loading' }
  | { status: 'ready'; targets: Map<string, GenerationTarget> }
  | { status: 'error'; message: string };

let targetsState: TargetsState = { status: 'loading' };
let targetsPromise: Promise<void> | undefined;
let unregisteredDecoration: ReturnType<typeof window.createTextEditorDecorationType> | undefined;

function ensureTargetsLoaded(): Promise<void> {
  if (!targetsPromise) {
    targetsPromise = fetchTargets().finally(() => {
      targetsPromise = undefined;
    });
  }
  return targetsPromise;
}

async function fetchTargets(): Promise<void> {
  try {
    const { stdout } = await execFileAsync(resolveCliCommand(), ['targets'], { timeout: 5000 });
    const targets = new Map<string, GenerationTarget>();
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      const i = trimmed.indexOf('#');
      if (i < 0) {
        continue;
      }
      targets.set(trimmed, { name: trimmed.slice(0, i), version: trimmed.slice(i + 1) });
    }
    targetsState = { status: 'ready', targets };
  } catch (err) {
    targetsState = { status: 'error', message: String(err) };
    console.warn(`Comline: couldn't query code-generation targets ('comline targets' failed): ${err}`);
  }
  refreshAllVisibleDecorations();
}

export async function activate(context: ExtensionContext): Promise<void> {
  extensionContext = context;

  packageStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  packageStatusBarItem.name = 'Comline Active Package';
  packageStatusBarItem.command = 'comline.packageStatusBarMenu';
  context.subscriptions.push(packageStatusBarItem);

  const configWatcher = workspace.createFileSystemWatcher('**/config.idp');
  configWatcher.onDidCreate(() => void refreshPackageRoots());
  configWatcher.onDidDelete(() => void refreshPackageRoots());
  context.subscriptions.push(configWatcher);
  context.subscriptions.push(workspace.onDidChangeWorkspaceFolders(() => void refreshPackageRoots()));
  void refreshPackageRoots();

  unregisteredDecoration = window.createTextEditorDecorationType({
    textDecoration: 'underline dashed',
    color: new ThemeColor('editorWarning.foreground'),
  });
  context.subscriptions.push(unregisteredDecoration);

  void ensureTargetsLoaded();

  context.subscriptions.push(
    languages.registerCompletionItemProvider(
      { scheme: 'file', language: 'comline-package' },
      new LanguagesCompletionProvider(),
      '#'
    ),
    languages.registerHoverProvider(
      { scheme: 'file', language: 'comline-package' },
      new LanguagesHoverProvider()
    ),
    // No client-side formatting provider for `.idp` is registered here —
    // would be redundant and conflicting, not just unnecessary. Since
    // `documentSelector` below includes `comline-package` (needed to sync
    // `.idp` documents for diagnostics), `vscode-languageclient` already
    // auto-registers a formatting provider for it too, backed by the
    // server's declared `document_formatting_provider` capability — the
    // server now formats `.idp` for real (`backend.rs::formatting` has no
    // `is_idp` guard; it reuses the same brace-depth pass `.ids` uses, see
    // `handlers/formatting.rs`). A second, client-side provider for the
    // same language would just show as a confusing duplicate in VS Code's
    // "select a default formatter" picker. `comline.formatFile` below
    // still routes through `editor.action.formatDocument` either way.
    commands.registerCommand('comline.refreshLanguageTargets', () => {
      targetsPromise = undefined;
      void ensureTargetsLoaded();
    }),
    commands.registerCommand('comline.formatFile', () =>
      commands.executeCommand('editor.action.formatDocument')
    ),
    commands.registerCommand('comline.lintFile', () => {
      window.showInformationMessage(
        'Comline: Lint is not implemented yet. .ids files are already checked live by the ' +
          'language server (see Problems); .idp checking is planned.'
      );
    }),
    // `comline.menu.*`: same handlers, shorter titles — the "Comline" submenu
    // this dropdown already groups under makes the "Comline:" Command
    // Palette prefix redundant here, so these get their own short title
    // instead of reusing comline.formatFile/lintFile's. Hidden from the
    // Command Palette itself (package.json's `commandPalette` menu entries)
    // so they don't show up as confusing near-duplicates of those.
    commands.registerCommand('comline.menu.formatFile', () =>
      commands.executeCommand('comline.formatFile')
    ),
    commands.registerCommand('comline.menu.lintFile', () =>
      commands.executeCommand('comline.lintFile')
    ),
    workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('comline.cli.mode') || e.affectsConfiguration('comline.cli.customPath')) {
        targetsPromise = undefined;
        void ensureTargetsLoaded();
      }
    }),
    window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        refreshDecorations(editor);
      }
    }),
    workspace.onDidChangeTextDocument((e) => debounceDecorationRefresh(e.document))
  );

  const serverExecutable = getServerExecutable(context);

  if (!serverExecutable) {
    window.showErrorMessage(
      'Comline Language Server not found. Please configure the server path in settings or ensure it is in your PATH.'
    );
    return;
  }

  // Check if the executable exists and is accessible
  if (!fs.existsSync(serverExecutable)) {
    window.showErrorMessage(
      `Comline Language Server not found at: ${serverExecutable}. Please check your configuration.`
    );
    return;
  }

  const config = workspace.getConfiguration('comline');
  const debug = config.get<boolean>('server.debug', false);

  const serverOptions: ServerOptions = {
    command: serverExecutable,
    transport: TransportKind.stdio,
    // `comline-lsp` builds its tracing subscriber from `RUST_LOG` (see
    // `language-server/src/main.rs`'s `EnvFilter::from_default_env()`) — an
    // env var name, not a JS property, hence the naming-convention opt-out.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    options: debug ? { env: { ...process.env, RUST_LOG: 'debug' } } : undefined,
  };

  const clientOptions: LanguageClientOptions = {
    // `.idp` is synced so parse-error diagnostics flow from the server (see
    // language-server's `backend.rs::parse_and_publish_diagnostics`) — every
    // *other* request type (hover/completion/definition/etc.) is explicitly
    // guarded server-side to no-op for `.idp` (`backend.rs::is_idp`), since
    // those are already handled correctly client-side (see idpSchema.ts).
    documentSelector: [
      { scheme: 'file', language: 'comline' },
      { scheme: 'file', language: 'comline-package' },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/*.{ids,idp}'),
    },
  };

  // The id (first arg) doubles as the settings section `vscode-languageclient`
  // reads `trace.server` from — must be 'comline' to match the declared
  // `comline.trace.server` setting, not the display name.
  client = new LanguageClient(
    'comline',
    'Comline Language Server',
    serverOptions,
    clientOptions
  );

  context.subscriptions.push(
    commands.registerCommand('comline.restartServer', async () => {
      if (!client) {
        return;
      }
      await client.stop();
      await client.start();
      window.showInformationMessage('Comline Language Server restarted.');
    }),
    commands.registerCommand('comline.build', () => runCliCommand('build')),
    commands.registerCommand('comline.check', () => runCliCommand('check')),
    commands.registerCommand('comline.generate', () => runCliCommand('generate')),
    commands.registerCommand('comline.clean', () => runCliCommand('clean')),
    commands.registerCommand('comline.selectPackage', () => selectPackageRoot()),
    commands.registerCommand('comline.packageStatusBarMenu', () => showPackageStatusBarMenu())
  );

  try {
    await client.start();
    console.log('Comline Language Server started successfully');
  } catch (error) {
    window.showErrorMessage(
      `Failed to start Comline Language Server: ${error}`
    );
  }
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
  }
}

interface PackageQuickPickItem extends QuickPickItem {
  root: string;
}

/** `path.relative`-based containment check — a raw `startsWith` on `fsPath`
 * strings would wrongly match `packages/foo2` against a root of `packages/foo`. */
function isUnder(root: string, filePath: string): boolean {
  const rel = path.relative(root, filePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Which discovered root (if any) the active editor's file lives under.
 * Nearest ancestor wins when packages are nested (shortest relative path). */
function rootContainingActiveFile(roots: string[]): string | undefined {
  const doc = window.activeTextEditor?.document;
  if (!doc || doc.uri.scheme !== 'file') {
    return undefined;
  }
  const filePath = doc.uri.fsPath;
  const matches = roots.filter((root) => isUnder(root, filePath));
  if (matches.length === 0) {
    return undefined;
  }
  matches.sort((a, b) => path.relative(a, filePath).length - path.relative(b, filePath).length);
  return matches[0];
}

/** Best-effort `congregation <name>` label for a package root — cosmetic
 * only, never load-bearing for resolution; falls back to the directory name. */
function packageLabel(root: string): string {
  try {
    const contents = fs.readFileSync(path.join(root, 'config.idp'), 'utf8');
    const match = /\bcongregation\s+([a-zA-Z_][a-zA-Z0-9_]*)/.exec(contents);
    if (match) {
      return match[1];
    }
  } catch {
    // fall through to the basename below
  }
  return path.basename(root);
}

async function discoverPackageRoots(): Promise<string[]> {
  const folders = workspace.workspaceFolders ?? [];
  const roots: string[] = [];
  for (const folder of folders) {
    const found = await workspace.findFiles(
      new RelativePattern(folder, '**/config.idp'),
      '{**/node_modules/**,**/.git/**}',
      100
    );
    roots.push(...found.map((uri) => path.dirname(uri.fsPath)));
  }
  return roots;
}

async function refreshPackageRoots(): Promise<void> {
  discoveredPackageRoots = await discoverPackageRoots();

  const stored = extensionContext.workspaceState.get<string>(SELECTED_PACKAGE_KEY);
  if (stored && !discoveredPackageRoots.includes(stored)) {
    await extensionContext.workspaceState.update(SELECTED_PACKAGE_KEY, undefined);
  }

  updatePackageStatusBarItem();
}

function updatePackageStatusBarItem(): void {
  // Always visible with 1+ packages — shows the current context even when
  // there's only one (nothing to disambiguate, but still worth seeing at a
  // glance), same idea as an editor's always-shown git branch indicator.
  // Resolution itself stays fully implicit either way (resolvePackageRoot
  // never prompts for a single package) — this only controls visibility.
  if (discoveredPackageRoots.length < 1) {
    packageStatusBarItem.hide();
    return;
  }
  const current =
    extensionContext.workspaceState.get<string>(SELECTED_PACKAGE_KEY) ??
    rootContainingActiveFile(discoveredPackageRoots) ??
    discoveredPackageRoots[0];
  packageStatusBarItem.text = `$(comline-mark) $(package) ${packageLabel(current)}`;
  packageStatusBarItem.tooltip = `Currently active/selected package:\n${current}\n\nClick to open menu`;
  packageStatusBarItem.show();
}

function toPackageQuickPickItem(root: string): PackageQuickPickItem {
  const base = workspace.getWorkspaceFolder(Uri.file(root));
  return {
    root,
    label: packageLabel(root),
    description: base ? path.relative(base.uri.fsPath, root) : root,
    detail: root,
  };
}

async function showPackageQuickPick(
  roots: string[],
  preselect: string | undefined
): Promise<string | undefined> {
  const items = roots.map(toPackageQuickPickItem);
  const quickPick = window.createQuickPick<PackageQuickPickItem>();
  quickPick.title = 'Select Comline Package';
  quickPick.placeholder = 'Which Comline package should CLI commands act on?';
  quickPick.items = items;
  if (preselect) {
    const preselected = items.find((item) => item.root === preselect);
    if (preselected) {
      quickPick.activeItems = [preselected];
    }
  }

  return new Promise<string | undefined>((resolve) => {
    quickPick.onDidAccept(() => {
      resolve(quickPick.selectedItems[0]?.root);
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve(undefined);
    });
    quickPick.show();
  });
}

// VS Code has no public API for an extension to query the keybinding
// currently bound to a command — so this is a manual mirror of
// `contributes.keybindings` in package.json, kept in sync by hand. Empty
// today (no keybindings are declared); the status bar menu only shows a
// shortcut hint for an entry present here.
const COMMAND_KEYBINDING_LABELS: Record<string, string> = {};

const CLI_ACTIONS: { subcommand: string; label: string }[] = [
  { subcommand: 'build', label: 'Build' },
  { subcommand: 'check', label: 'Check' },
  { subcommand: 'generate', label: 'Generate' },
  { subcommand: 'clean', label: 'Clean' },
];

interface StatusBarMenuItem extends QuickPickItem {
  action?: 'switch' | 'run';
  subcommand?: string;
  root?: string;
}

/** One section per discovered package offering Build/Check/Generate/Clean
 * scoped to just that package — lets a command run against a package other
 * than the active one without switching it — followed by "Change Active
 * Package" last, since it acts on the whole menu rather than one package. */
function buildStatusBarMenuItems(roots: string[]): StatusBarMenuItem[] {
  const items: StatusBarMenuItem[] = [];

  for (const root of roots) {
    items.push({ label: packageLabel(root), kind: QuickPickItemKind.Separator });
    for (const { subcommand, label } of CLI_ACTIONS) {
      items.push({ label, action: 'run', subcommand, root });
    }
  }

  items.push(
    { label: 'Actions', kind: QuickPickItemKind.Separator },
    {
      label: 'Change Active Package',
      description: COMMAND_KEYBINDING_LABELS['comline.selectPackage'],
      action: 'switch',
    }
  );

  return items;
}

/** Status-bar click entry point: a menu of "change the active package" plus
 * a run-against-this-package-only section per discovered package, shown
 * before anything actually runs — the Command Palette's "Comline: Select
 * Active Package" skips straight to the picker instead, since its title
 * already says what it does. */
async function showPackageStatusBarMenu(): Promise<void> {
  const picked = await window.showQuickPick(buildStatusBarMenuItems(discoveredPackageRoots), {
    title: 'Comline',
  });
  if (!picked?.action) {
    return;
  }
  if (picked.action === 'switch') {
    await selectPackageRoot();
  } else if (picked.action === 'run' && picked.subcommand && picked.root) {
    await runCliCommand(picked.subcommand, [], picked.root);
  }
}

/** Always force-opens the picker, bypassing the persisted/active-file shortcuts. */
async function selectPackageRoot(): Promise<void> {
  if (discoveredPackageRoots.length < 2) {
    window.showInformationMessage(
      discoveredPackageRoots.length === 0
        ? 'Comline: no Comline package (config.idp) found in this workspace.'
        : 'Comline: only one package found in this workspace — nothing to switch.'
    );
    return;
  }
  const preselect = rootContainingActiveFile(discoveredPackageRoots);
  const picked = await showPackageQuickPick(discoveredPackageRoots, preselect);
  if (picked) {
    await extensionContext.workspaceState.update(SELECTED_PACKAGE_KEY, picked);
    updatePackageStatusBarItem();
  }
}

/** Resolves which package root a CLI command should run against. Only an
 * explicit QuickPick confirmation (or `comline.selectPackage`) persists a
 * selection — the active-file default below is deliberately per-invocation
 * only, so opening a file never silently and permanently pins a package. */
async function resolvePackageRoot(): Promise<string | undefined> {
  const roots = discoveredPackageRoots;

  if (roots.length === 0) {
    return undefined;
  }
  if (roots.length === 1) {
    return roots[0];
  }

  const stored = extensionContext.workspaceState.get<string>(SELECTED_PACKAGE_KEY);
  if (stored && roots.includes(stored)) {
    return stored;
  }

  const activeRoot = rootContainingActiveFile(roots);
  if (activeRoot) {
    return activeRoot;
  }

  const picked = await showPackageQuickPick(roots, undefined);
  if (picked) {
    await extensionContext.workspaceState.update(SELECTED_PACKAGE_KEY, picked);
    updatePackageStatusBarItem();
  }
  return picked;
}

function resolveCliCommand(): string {
  const config = workspace.getConfiguration('comline');
  const mode = config.get<string>('cli.mode', 'path');
  const customPath = config.get<string>('cli.customPath', '');
  return mode === 'custom' && customPath ? customPath : 'comline';
}

/** `rootOverride` runs against a specific package without touching the
 * persisted active-package selection — used by the status bar menu's
 * per-package actions. Omit it to resolve the active package normally. */
async function runCliCommand(
  subcommand: string,
  extraArgs: string[] = [],
  rootOverride?: string
): Promise<void> {
  if (!workspace.workspaceFolders?.length) {
    window.showErrorMessage('Comline: no workspace folder open.');
    return;
  }

  const packageRoot = rootOverride ?? (await resolvePackageRoot());
  if (!packageRoot) {
    window.showErrorMessage('Comline: no Comline package (config.idp) found in this workspace.');
    return;
  }

  // No `--plain`, plus CLICOLOR_FORCE: the CLI colors its output via
  // `anstream`, which auto-detects a real terminal and disables color
  // otherwise — a ProcessExecution-spawned task may not get a PTY, so
  // `CLICOLOR_FORCE` (which `anstream` explicitly honors, bypassing TTY
  // detection) guarantees color here the same as typing the command by hand.
  const args = ['--path', packageRoot, subcommand, ...extraArgs];
  const task = new Task(
    { type: 'comline', subcommand },
    TaskScope.Workspace,
    `Comline: ${subcommand} (${packageLabel(packageRoot)})`,
    'comline',
    new ProcessExecution(resolveCliCommand(), args, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      env: { ...process.env, CLICOLOR_FORCE: '1' },
    })
  );
  task.presentationOptions = {
    reveal: TaskRevealKind.Always,
    panel: TaskPanelKind.Shared,
  };

  const execution = await tasks.executeTask(task);
  const disposable = tasks.onDidEndTaskProcess((e) => {
    if (e.execution !== execution) {
      return;
    }
    disposable.dispose();
    if (e.exitCode === 0) {
      window.showInformationMessage(`Comline: ${subcommand} succeeded.`);
    } else {
      window.showErrorMessage(
        `Comline: ${subcommand} failed (exit ${e.exitCode}). See the terminal for details.`
      );
    }
  });
}

class LanguagesCompletionProvider {
  async provideCompletionItems(doc: TextDocument, pos: Position): Promise<CompletionItem[]> {
    const clean = stripNonCode(doc.getText());
    const offset = doc.offsetAt(pos);
    const path = keyPathAt(clean, offset);
    const resolved = resolveSchemaAtPath(path);
    if (!resolved) {
      return [];
    }

    const [start, end] = tokenRangeAround(doc.getText(), offset);
    const range = new Range(doc.positionAt(start), doc.positionAt(end));

    if ('isRegistry' in resolved) {
      await ensureTargetsLoaded();
      if (targetsState.status !== 'ready') {
        return [];
      }
      return [...targetsState.targets.values()].map((t) => {
        const label = `${t.name}#${t.version}`;
        const item = new CompletionItem(label, CompletionItemKind.EnumMember);
        item.insertText = label; // the whole opaque token — the grammar never splits it
        item.range = range;
        item.detail = 'comline generate target';
        item.documentation = new MarkdownString(
          'Registered with the configured `comline` CLI. Write `{}` for the value — ' +
            'no options here; per-target config lives in `comline.toml`.'
        );
        return item;
      });
    }

    return resolved.fields.map((field) => {
      const item = new CompletionItem(field.key, CompletionItemKind.Field);
      item.insertText = field.key;
      item.range = range;
      item.detail = idpValueKindLabel(field.value);
      item.documentation = new MarkdownString(field.description);
      return item;
    });
  }
}

const LANGUAGES_PATH = ['code_generation', 'languages'];

/** One `key: type  // summary` line per field, column-aligned, as plain text
 * meant for a `comline-package`-tagged code block — real tokens (identifiers,
 * `//` comments) the grammar actually colors, not markdown bold/backticks. */
function renderFieldsBlock(fields: IdpFieldSchema[]): string {
  const lines = fields.map((f) => ({
    keyType: `${f.key}: ${idpValueKindLabel(f.value)}`,
    summary: f.summary,
  }));
  const width = Math.max(...lines.map((l) => l.keyType.length));
  return lines.map((l) => `${l.keyType.padEnd(width)}  // ${l.summary}`).join('\n');
}

/** `key: type` colored via the `comline-package` grammar (a real fenced code
 * block, not markdown bold/backticks — those never get syntax tokenization),
 * a separator, the full description, then (for a `dictionary`/`map` field) a
 * "Fields" section — another colored block, one short `summary` per line
 * rather than each sub-field's full `description`, which reads better in a
 * packed list; hovering that sub-field directly shows its full description. */
function renderFieldHover(field: IdpFieldSchema): MarkdownString {
  const md = new MarkdownString();
  md.appendCodeblock(`${field.key}: ${idpValueKindLabel(field.value)}`, 'comline-package');
  md.appendMarkdown('---\n\n');
  md.appendMarkdown(`${field.description}\n`);

  if (field.value.kind === 'dictionary' && field.value.fields.length > 0) {
    md.appendMarkdown('\n---\n\n#### Fields\n\n');
    md.appendCodeblock(renderFieldsBlock(field.value.fields), 'comline-package');
  } else if (field.value.kind === 'map' && field.value.entry.value.kind === 'dictionary') {
    md.appendMarkdown(`\n---\n\n#### Each entry (${field.value.entry.key})\n\n`);
    md.appendMarkdown(`${field.value.entry.description}\n\n`);
    md.appendCodeblock(renderFieldsBlock(field.value.entry.value.fields), 'comline-package');
  }

  return md;
}

class LanguagesHoverProvider {
  provideHover(doc: TextDocument, pos: Position): Hover | undefined {
    const text = doc.getText();
    const clean = stripNonCode(text);
    const offset = doc.offsetAt(pos);
    const [start, end] = tokenRangeAround(text, offset);
    if (start === end) {
      return undefined;
    }
    const word = text.slice(start, end);
    const range = new Range(doc.positionAt(start), doc.positionAt(end));
    const path = keyPathAt(clean, offset);

    const field = resolveFieldByPathAndWord(path, word);
    if (field) {
      return new Hover(renderFieldHover(field), range);
    }

    // Not a fixed schema key — the one dynamic case worth a hover is a
    // code_generation.languages entry (`name#version`), checked against the
    // live CLI registry.
    const isLanguagesEntry =
      path.length === LANGUAGES_PATH.length &&
      path.every((k, i) => k === LANGUAGES_PATH[i]) &&
      /^[a-zA-Z0-9_]+(?:::[a-zA-Z0-9_]+)*#[a-zA-Z0-9_.]+$/.test(word);
    if (!isLanguagesEntry) {
      return undefined;
    }

    if (targetsState.status !== 'ready') {
      return new Hover(
        new MarkdownString(
          `Comline: couldn't determine whether \`${word}\` is registered — the configured ` +
            '`comline` CLI could not be queried.'
        ),
        range
      );
    }

    const registered = targetsState.targets.has(word);
    const [name, version] = word.split('#');
    const body = registered
      ? `✅ \`${word}\` is registered with the **currently configured** \`comline\` CLI — ` +
        '`comline generate` can produce this target here.'
      : `⚠️ \`${word}\` is **not** registered with the currently configured \`comline\` CLI. ` +
        `Running \`comline generate\` here would fail: \`no generator for '${name}' ` +
        `(version '${version}')\`. Run \`comline targets\` to see what this CLI build ` +
        'supports, or check `comline.cli.*` settings.';
    return new Hover(new MarkdownString(body), range);
  }
}

function refreshDecorations(editor: TextEditor): void {
  if (!unregisteredDecoration || editor.document.languageId !== 'comline-package') {
    return;
  }
  if (targetsState.status !== 'ready') {
    editor.setDecorations(unregisteredDecoration, []); // fail open — unknown ≠ broken
    return;
  }

  const clean = stripNonCode(editor.document.getText());
  const span = findBlockSpan(clean, LANGUAGES_PATH);
  const ranges = (span ? findEntryKeys(clean, span) : [])
    .filter((e) => targetsState.status === 'ready' && !targetsState.targets.has(e.token))
    .map((e) => new Range(editor.document.positionAt(e.start), editor.document.positionAt(e.end)));
  editor.setDecorations(unregisteredDecoration, ranges);
}

function refreshAllVisibleDecorations(): void {
  for (const editor of window.visibleTextEditors) {
    refreshDecorations(editor);
  }
}

const decorationRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

function debounceDecorationRefresh(doc: TextDocument): void {
  if (doc.languageId !== 'comline-package') {
    return;
  }
  const key = doc.uri.toString();
  const existing = decorationRefreshTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  decorationRefreshTimers.set(
    key,
    setTimeout(() => {
      decorationRefreshTimers.delete(key);
      const editor = window.visibleTextEditors.find((e) => e.document.uri.toString() === key);
      if (editor) {
        refreshDecorations(editor);
      }
    }, 200)
  );
}

function getServerExecutable(context: ExtensionContext): string | null {
  const config = workspace.getConfiguration('comline');
  const mode = config.get<string>('server.mode', 'bundled');
  const customPath = config.get<string>('server.customPath', '');

  switch (mode) {
    case 'bundled':
      return getBundledServerPath(context);

    case 'path':
      return 'comline-lsp'; // Will be searched in system PATH

    case 'custom':
      if (!customPath) {
        window.showWarningMessage(
          'Comline: Custom server path is not configured. Fallback to bundled server.'
        );
        return getBundledServerPath(context);
      }
      return customPath;

    default:
      return getBundledServerPath(context);
  }
}

function getBundledServerPath(context: ExtensionContext): string | null {
  const platform = process.platform;
  const arch = process.arch;
  let binaryName = 'comline-lsp';

  if (platform === 'win32') {
    binaryName = 'comline-lsp.exe';
  }

  // Multi-platform structure for production releases
  // Try platform-specific subdirectory first (e.g., bin/linux-x64/comline-lsp)
  const platformDir = getPlatformIdentifier(platform, arch);
  const platformSpecificPath = context.asAbsolutePath(
    path.join('bin', platformDir, binaryName)
  );

  if (fs.existsSync(platformSpecificPath)) {
    ensureExecutable(platformSpecificPath, platform);
    return platformSpecificPath;
  }

  // Fallback to single binary in bin/ for development (e.g., bin/comline-lsp)
  const simplePath = context.asAbsolutePath(path.join('bin', binaryName));

  if (fs.existsSync(simplePath)) {
    ensureExecutable(simplePath, platform);
    return simplePath;
  }

  window.showWarningMessage(
    `Bundled Comline Language Server not found. Searched:\n- ${platformSpecificPath}\n- ${simplePath}\n\nPlease ensure the binary is available or configure a custom path.`
  );

  return null;
}

function getPlatformIdentifier(platform: string, arch: string): string {
  // Map Node.js platform/arch to VSCode platform identifiers
  if (platform === 'win32') {
    return arch === 'x64' ? 'win32-x64' : `win32-${arch}`;
  } else if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  } else if (platform === 'linux') {
    return arch === 'x64' ? 'linux-x64' : `linux-${arch}`;
  }
  return `${platform}-${arch}`;
}

function ensureExecutable(filePath: string, platform: string): void {
  if (platform !== 'win32') {
    try {
      fs.chmodSync(filePath, 0o755);
    } catch (error) {
      console.error('Failed to set executable permissions:', error);
    }
  }
}
