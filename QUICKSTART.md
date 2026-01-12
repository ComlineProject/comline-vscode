# Quick Start Guide

## Development Setup (5 minutes)

### 1. Link to Language Server Binary

The easiest way to get started is symlinking to your language server build:

```bash
# Make sure you have the language server repository
cd /path/to/language-server
cargo build  # or cargo build --release

# Then run the helper script from the extension directory
cd /path/to/comline-vscode
./scripts/link-binary.sh /path/to/language-server debug
```

Alternatively, create the symlink manually:

```bash
ln -s /path/to/language-server/target/debug/comline-lsp \
      /path/to/comline-vscode/bin/comline-lsp
```

### 2. Test the Extension

Open this folder in VSCode and press **F5**. This will:
- Compile TypeScript automatically
- Launch an Extension Development Host window
- Activate the extension

### 3. Try It Out

In the Extension Development Host window:
1. Open `examples/user.ids`
2. You should see:
   - ✅ Syntax highlighting
   - ✅ Outline view (Ctrl+Shift+O)
   - ✅ Hover over types for info
   - ✅ Auto-completion (try typing `struct`)

---

## Building for Production

### Package for Distribution

```bash
# Development package (no binaries bundled)
npm run package

# Production package (requires binaries for all platforms)
npm run package:bundle
```

The `package:bundle` command will check for binaries in:
- `bin/linux-x64/comline-lsp`
- `bin/darwin-x64/comline-lsp`
- `bin/darwin-arm64/comline-lsp`
- `bin/win32-x64/comline-lsp.exe`

---

## CI/CD

Push a Git tag to trigger automatic release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The GitHub Actions workflow will:
1. Build LSP binaries for all platforms
2. Package the extension with all binaries
3. Create a GitHub release
4. (Optional) Publish to VSCode Marketplace

---

## NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile TypeScript |
| `npm run watch` | Watch mode for development |
| `npm run lint` | Run ESLint |
| `npm run package` | Package extension (dev mode) |
| `npm run package:bundle` | Package with all binaries |
| `npm run link-binary` | Run symlink helper script |

---

## Troubleshooting

**Extension not activating?**
- Make sure a binary exists at `bin/comline-lsp`
- Check the Output panel: View → Output → "Comline Language Server"

**TypeScript errors?**
```bash
npm run compile
```

**Want to rebuild?**
```bash
npm run compile && code --install-extension *.vsix
```

---

## Next Steps

- See [README.md](README.md) for full documentation
- Check [bin/README.md](bin/README.md) for binary setup details
- Review [.github/workflows/](.github/workflows/) for CI/CD configuration
