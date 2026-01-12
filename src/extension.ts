import * as path from 'path';
import * as fs from 'fs';
import { workspace, ExtensionContext, window } from 'vscode';
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

  const serverOptions: ServerOptions = {
    command: serverExecutable,
    transport: TransportKind.stdio,
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'comline' }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/*.ids'),
    },
  };

  client = new LanguageClient(
    'comline-lsp',
    'Comline Language Server',
    serverOptions,
    clientOptions
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
  let binaryName = 'comline-lsp';

  if (platform === 'win32') {
    binaryName = 'comline-lsp.exe';
  }

  // The bundled binary should be in the extension's bin directory
  const bundledPath = context.asAbsolutePath(path.join('bin', binaryName));

  if (fs.existsSync(bundledPath)) {
    // Make sure it's executable on Unix-like systems
    if (platform !== 'win32') {
      try {
        fs.chmodSync(bundledPath, 0o755);
      } catch (error) {
        console.error('Failed to set executable permissions:', error);
      }
    }
    return bundledPath;
  }

  window.showWarningMessage(
    `Bundled Comline Language Server not found at: ${bundledPath}. Please ensure the binary is packaged with the extension or configure a custom path.`
  );
  
  return null;
}
