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
