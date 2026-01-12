# Language Server Binary

This directory should contain the compiled `comline-lsp` binary for your platform:

- **Linux**: `comline-lsp`
- **macOS**: `comline-lsp`
- **Windows**: `comline-lsp.exe`

## Development Setup (Recommended: Symlink)

For active development, **use a symlink** instead of copying. This automatically uses your latest build:

```bash
# Navigate to the language server repository
cd /path/to/language-server

# Build in debug mode (faster compilation)
cargo build

# Create symlink from the extension's bin directory to the debug build
ln -s "$(pwd)/target/debug/comline-lsp" "/path/to/comline-vscode/bin/comline-lsp"

# Or for release builds:
cargo build --release
ln -s "$(pwd)/target/release/comline-lsp" "/path/to/comline-vscode/bin/comline-lsp"
```

**Benefits:**
- No need to copy after each rebuild
- Always uses the latest build
- Saves disk space

**Windows (PowerShell):**
```powershell
# Run as Administrator
New-Item -ItemType SymbolicLink -Path "C:\path\to\comline-vscode\bin\comline-lsp.exe" -Target "C:\path\to\language-server\target\debug\comline-lsp.exe"
```

## Production Build (Copy Binary)

For packaging and distribution, copy the binary:

```bash
# Build the release binary
cd /path/to/language-server
cargo build --release

# Copy to extension
cp target/release/comline-lsp /path/to/comline-vscode/bin/
```

## Multi-Platform Packaging

For multi-platform `.vsix` packages, you need binaries for each platform:

```
bin/
├── linux-x64/
│   └── comline-lsp
├── darwin-x64/
│   └── comline-lsp
├── darwin-arm64/
│   └── comline-lsp
└── win32-x64/
    └── comline-lsp.exe
```

Use the provided build scripts (see `scripts/package.sh`) to automate this process.

The extension automatically detects platform and architecture at runtime.
