import * as path from 'path';
import * as fs from 'fs';
import { workspace, ExtensionContext, window, commands, tasks, Task, TaskScope, ProcessExecution, TaskRevealKind, TaskPanelKind } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export async function activate(context: ExtensionContext): Promise<void> {
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
    documentSelector: [{ scheme: 'file', language: 'comline' }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/*.ids'),
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
    commands.registerCommand('comline.clean', () => runCliCommand('clean'))
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

function getWorkspacePath(): string | undefined {
  const doc = window.activeTextEditor?.document;
  const folder = doc ? workspace.getWorkspaceFolder(doc.uri) : workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

function resolveCliCommand(): string {
  const config = workspace.getConfiguration('comline');
  const mode = config.get<string>('cli.mode', 'path');
  const customPath = config.get<string>('cli.customPath', '');
  return mode === 'custom' && customPath ? customPath : 'comline';
}

async function runCliCommand(subcommand: string, extraArgs: string[] = []): Promise<void> {
  const workspacePath = getWorkspacePath();
  if (!workspacePath) {
    window.showErrorMessage('Comline: no workspace folder open.');
    return;
  }

  const args = ['--path', workspacePath, '--plain', subcommand, ...extraArgs];
  const task = new Task(
    { type: 'comline', subcommand },
    TaskScope.Workspace,
    `Comline: ${subcommand}`,
    'comline',
    new ProcessExecution(resolveCliCommand(), args)
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
