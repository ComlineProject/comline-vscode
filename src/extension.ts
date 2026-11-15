import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
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
  ConfigurationTarget,
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
  tokenRangeAround,
  resolveSchemaAtPath,
  resolveFieldByPathAndWord,
  idpValueKindLabel,
  IdpFieldSchema,
} from './idpSchema';
import {
  Tool,
  Plan,
  TOOLS,
  effectiveMode,
  planProgram,
  launchFor,
  planLocation,
  systemProbe,
  verifyPlan,
} from './resolve';
import { cliDisplayVersion, coreRevMismatch, displayVersion, mismatchMessage, serverCoreRev } from './coreRev';

const execFileAsync = promisify(execFile);

let client: LanguageClient | undefined;

/** The URL scheme of std's schemas, served by the language server (`comline/stdSource`). */
const STD_SCHEME = 'comline-std';

const SELECTED_PACKAGE_KEY = 'comline.selectedPackageRoot';

let extensionContext: ExtensionContext;
let packageStatusBarItem: StatusBarItem;
let discoveredPackageRoots: string[] = [];

/** What the status bar's tooltip says about the language server: where it
 * runs (`planLocation`), and its `serverInfo.version` once it has started,
 * or what went wrong. */
const serverStatus: { location?: string; version?: string; problem?: string } = {};

/** The same for the CLI, from one `comline --version` run (`loadCliStatus`),
 * whose output the core mismatch warning reads too. */
let cliStatus: { location?: string; version?: string; problem?: string } = {};
let cliVersionPromise: Promise<string | undefined> | undefined;

interface GenerationTarget {
  name: string;
  version: string;
  /** What `comline targets` says after the token: the versions it handles. */
  versions: string;
}

type TargetsState =
  | { status: 'loading' }
  | { status: 'ready'; targets: Map<string, GenerationTarget> }
  | { status: 'error'; message: string };

let targetsState: TargetsState = { status: 'loading' };
let targetsPromise: Promise<void> | undefined;

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
    const plan = await resolveProgram('cli');
    if (plan.kind === 'error') {
      throw new Error(plan.message);
    }
    const launch = launchFor(plan, ['targets'], {}, process.env);
    const { stdout } = await execFileAsync(launch.command, launch.args, {
      timeout: 5000,
      env: launch.env,
    });
    const targets = new Map<string, GenerationTarget>();
    // `rust#1.85.0  (1.85.0 or later; verified up to 1.99, ...)`: the token,
    // then what versions its generator handles.
    for (const line of stdout.split('\n')) {
      const match = /^\s*(\S+)\s*(?:\((.*)\))?\s*$/.exec(line);
      const token = match?.[1];
      const i = token?.indexOf('#') ?? -1;
      if (!token || i < 0) {
        continue;
      }
      targets.set(token, { name: token.slice(0, i), version: token.slice(i + 1), versions: match?.[2] ?? '' });
    }
    targetsState = { status: 'ready', targets };
  } catch (err) {
    targetsState = { status: 'error', message: String(err) };
    console.warn(`Comline: couldn't query code-generation targets ('comline targets' failed): ${err}`);
  }
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

  // Whether a declared target is handled - unknown language, below the
  // generator's floor or a dependency's, past what it verified - is the
  // language server's diagnostics and hover: it resolves through the same
  // registry `comline build` does.
  void ensureTargetsLoaded();
  cliVersionPromise = loadCliStatus();

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
    // The CLI commands don't depend on the language server: they're
    // registered before it is looked up, so a server that isn't found leaves
    // them working.
    commands.registerCommand('comline.build', () => runCliCommand(['build'])),
    commands.registerCommand('comline.check', () => runCliCommand(['check'])),
    // `comline generation` and `comline generation clean` (cli#153 renamed
    // `generate`/`clean`); the command ids stay `comline.generate`/`.clean`
    // so keybindings and tasks that use them keep working.
    commands.registerCommand('comline.generate', () => runCliCommand(['generation'])),
    commands.registerCommand('comline.clean', () => runCliCommand(['generation', 'clean'])),
    commands.registerCommand('comline.selectPackage', () => selectPackageRoot()),
    commands.registerCommand('comline.packageStatusBarMenu', () => showPackageStatusBarMenu()),
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
        cliVersionPromise = loadCliStatus();
      }
    })
  );

  const plan = await resolveProgram('server', context);
  if (plan.kind === 'error') {
    serverStatus.problem = 'not found';
    updatePackageStatusBarItem();
    window.showErrorMessage(plan.message);
    return;
  }

  const config = workspace.getConfiguration('comline');
  serverStatus.location = planLocation(
    plan,
    effectiveMode('server', config.get<string>('server.mode', TOOLS.server.defaultMode), config.get<string>('server.customPath', '').trim()).mode
  );
  const debug = config.get<boolean>('server.debug', false);

  // `comline-lsp` builds its tracing subscriber from `RUST_LOG` (see
  // `language-server/src/main.rs`'s `EnvFilter::from_default_env()`). Run on
  // the host, it doesn't get the editor's environment, so the variable goes
  // through `flatpak-spawn --env=`; `launchFor` does either.
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const launch = launchFor(plan, [], debug ? { RUST_LOG: 'debug' } : {}, process.env, {
    watchBus: true,
  });
  const processOptions: { env?: Record<string, string>; cwd?: string } = {};
  if (launch.env) {
    processOptions.env = launch.env;
  }
  if (plan.kind === 'host') {
    // `flatpak-spawn --host` runs in the working directory it is started in,
    // which has to exist on the host: the home directory does, in the sandbox
    // and out of it.
    processOptions.cwd = os.homedir();
  }

  const serverOptions: ServerOptions = {
    command: launch.command,
    args: launch.args,
    transport: TransportKind.stdio,
    options: Object.keys(processOptions).length > 0 ? processOptions : undefined,
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
      // `comline.toml`: the server reads it against the package next to it
      // (diagnostics, completion, hover, quick fixes).
      { scheme: 'file', language: 'comline-toml' },
      // std's schemas (see the `comline-std` provider below): hover and
      // go-to-definition keep working inside them.
      { scheme: STD_SCHEME, language: 'comline' },
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
    // The standard library is embedded in the server and never on disk:
    // go-to-definition into it lands on a `comline-std:/http.ids` document,
    // whose text the server serves (`comline/stdSource`). Content-provider
    // documents are read-only.
    workspace.registerTextDocumentContentProvider(STD_SCHEME, {
      async provideTextDocumentContent(uri: Uri): Promise<string> {
        if (!client) {
          return '// The Comline language server is not running.';
        }
        const source = await client.sendRequest<string | null>('comline/stdSource', {
          uri: uri.toString(),
        });
        return source ?? `// ${uri.toString()} is not part of the standard library.`;
      },
    }),
    commands.registerCommand('comline.restartServer', async () => {
      if (!client) {
        return;
      }
      await client.stop();
      await client.start();
      serverStatus.version = client.initializeResult?.serverInfo?.version;
      updatePackageStatusBarItem();
      window.showInformationMessage('Comline Language Server restarted.');
    }),
  );

  try {
    await client.start();
    console.log('Comline Language Server started successfully');
    serverStatus.version = client.initializeResult?.serverInfo?.version;
    serverStatus.problem = undefined;
    updatePackageStatusBarItem();
    const serverVersion = client.initializeResult?.serverInfo?.version;
    void cliVersionPromise?.then((cliVersion) => warnOnCoreMismatch(serverVersion, cliVersion));
  } catch (error) {
    serverStatus.problem = 'failed to start';
    updatePackageStatusBarItem();
    window.showErrorMessage(
      `Failed to start Comline Language Server: ${error}`
    );
  }
}

let coreRevChecked = false;

/** Warns, once per session, when the language server and the CLI were built
 * with different `comline-core` commits (`coreRev.ts`): they can then
 * disagree about the same file. Says nothing when either doesn't report its
 * commit, when there is no CLI to ask, or when `comline.warnOnCoreMismatch`
 * is off. Never throws. */
async function warnOnCoreMismatch(
  serverVersion: string | undefined,
  cliVersionOutput: string | undefined
): Promise<void> {
  if (coreRevChecked) {
    return;
  }
  coreRevChecked = true;
  try {
    const config = workspace.getConfiguration('comline');
    if (!config.get<boolean>('warnOnCoreMismatch', true) || serverCoreRev(serverVersion) === undefined) {
      return;
    }
    const mismatch = coreRevMismatch(serverVersion, cliVersionOutput);
    if (!mismatch) {
      return;
    }
    const dontShowAgain = "Don't show again";
    if ((await window.showWarningMessage(mismatchMessage(mismatch), dontShowAgain)) === dontShowAgain) {
      await config.update('warnOnCoreMismatch', false, ConfigurationTarget.Global);
    }
  } catch (err) {
    console.warn(`Comline: couldn't warn about the language server's and the CLI's core: ${err}`);
  }
}

/** Finds the CLI and runs `comline --version` once, for the status bar's
 * tooltip; resolves to its output, or undefined when there is no CLI or it
 * failed. Never throws. */
async function loadCliStatus(): Promise<string | undefined> {
  const config = workspace.getConfiguration('comline');
  const mode = effectiveMode(
    'cli',
    config.get<string>('cli.mode', TOOLS.cli.defaultMode),
    config.get<string>('cli.customPath', '').trim()
  ).mode;
  const plan = await resolveProgram('cli');
  if (plan.kind === 'error') {
    cliStatus = { problem: 'not found' };
    updatePackageStatusBarItem();
    return undefined;
  }
  cliStatus = { location: planLocation(plan, mode) };
  try {
    const launch = launchFor(plan, ['--version'], {}, process.env);
    const { stdout } = await execFileAsync(launch.command, launch.args, {
      timeout: 5000,
      env: launch.env,
    });
    cliStatus.version = cliDisplayVersion(stdout);
    return stdout;
  } catch (err) {
    cliStatus.problem = "'comline --version' failed";
    console.warn(`Comline: 'comline --version' failed: ${err}`);
    return undefined;
  } finally {
    updatePackageStatusBarItem();
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
  packageStatusBarItem.tooltip =
    `Currently active/selected package:\n${current}\n\n` +
    `Language server: ${serverStatusLine()}\n` +
    (serverStatus.location ? `${serverStatus.location}\n` : '') +
    `\nCLI: ${cliStatus.version ?? cliStatus.problem ?? 'checking'}\n` +
    (cliStatus.location ? `${cliStatus.location}\n` : '') +
    `\nClick to open menu`;
  packageStatusBarItem.show();
}

/** `comline-lsp 0.1.0 (core 14ce546)`, or why there is none. */
function serverStatusLine(): string {
  if (serverStatus.version) {
    return `comline-lsp ${displayVersion(serverStatus.version)}`;
  }
  return serverStatus.problem ?? (serverStatus.location ? 'starting' : 'not started');
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

const CLI_ACTIONS: { subcommand: string[]; label: string }[] = [
  { subcommand: ['build'], label: 'Build' },
  { subcommand: ['check'], label: 'Check' },
  { subcommand: ['generation'], label: 'Generate' },
  { subcommand: ['generation', 'clean'], label: 'Clean' },
];

interface StatusBarMenuItem extends QuickPickItem {
  action?: 'switch' | 'run';
  subcommand?: string[];
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

/** Where the language server or the CLI is and how to run it, from the
 * `comline.server.*` / `comline.cli.*` settings (see `resolve.ts`). A plan
 * that runs on the host through `flatpak-spawn` has been checked against the
 * host: the program is there, and the editor may talk to it. Never throws;
 * what went wrong is the `error` plan's message. */
async function resolveProgram(tool: Tool, context?: ExtensionContext): Promise<Plan> {
  const info = TOOLS[tool];
  const config = workspace.getConfiguration('comline');
  const section = tool === 'server' ? 'server' : 'cli';
  const mode = config.get<string>(`${section}.mode`, info.defaultMode);
  const customPath = config.get<string>(`${section}.customPath`, '');

  const effective = effectiveMode(tool, mode, customPath);
  if (effective.notice) {
    window.showWarningMessage(effective.notice);
  }
  const bundled = effective.mode === 'bundled' && context ? getBundledServerPath(context) : null;
  return verifyPlan(tool, planProgram({ tool, mode, customPath, bundled }, systemProbe()));
}

/** `rootOverride` runs against a specific package without touching the
 * persisted active-package selection — used by the status bar menu's
 * per-package actions. Omit it to resolve the active package normally. */
async function runCliCommand(
  subcommand: string[],
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
  const plan = await resolveProgram('cli');
  if (plan.kind === 'error') {
    window.showErrorMessage(plan.message);
    return;
  }

  const name = subcommand.join(' ');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const launch = launchFor(plan, ['--path', packageRoot, ...subcommand, ...extraArgs], { CLICOLOR_FORCE: '1' }, process.env);
  const task = new Task(
    { type: 'comline', subcommand: name },
    TaskScope.Workspace,
    `Comline: ${name} (${packageLabel(packageRoot)})`,
    'comline',
    new ProcessExecution(launch.command, launch.args, launch.env ? { env: launch.env } : {})
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
      window.showInformationMessage(`Comline: ${name} succeeded.`);
    } else {
      window.showErrorMessage(
        `Comline: ${name} failed (exit ${e.exitCode}). See the terminal for details.`
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
        item.detail = t.versions || 'comline generate target';
        item.documentation = new MarkdownString(
          'Registered with the configured `comline` CLI. The version is a minimum: any later ' +
            'one the generator handles works too. Write `{}` for the value — no options here; ' +
            'per-target config lives in `comline.toml`.'
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

    // A code_generation.languages entry (`name#version`) is the language
    // server's hover: what its generator supports at that version.
    const field = resolveFieldByPathAndWord(path, word);
    return field ? new Hover(renderFieldHover(field), range) : undefined;
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
