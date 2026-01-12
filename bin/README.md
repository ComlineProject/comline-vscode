# Language Server Binary

Place the compiled `comline-lsp` binary for your platform in this directory:

- **Linux**: `comline-lsp`
- **macOS**: `comline-lsp`
- **Windows**: `comline-lsp.exe`

## Building the Language Server

```bash
# Clone the language server repository
git clone https://github.com/ComlineProject/language-server
cd language-server

# Build the release binary
cargo build --release

# Copy the binary here
cp target/release/comline-lsp /path/to/comline-vscode/bin/
```

## Multi-Platform Support

To package the extension for multiple platforms, you'll need to build the language server on each platform or use cross-compilation.

The extension will automatically detect the platform and look for the appropriate binary name.
