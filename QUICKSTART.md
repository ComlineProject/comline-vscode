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

F5 opens straight onto `test-workspace/`:
1. Open `test-workspace/chat.ids` (or `keyvalue.ids`)
2. You should see:
   - ✅ Syntax highlighting
   - ✅ Outline view (Ctrl+Shift+O)
   - ✅ Hover over types for info
   - ✅ Auto-completion (try typing `struct`)

---

## Building for Production

### Package for This Machine

```bash
# Bundles whatever bin/comline-lsp points at (see bin/README.md)
yarn package
```

Release packages, one per platform, are built by CI only.

---

## CI/CD

Releases are cut by a release PR plus a `vX.Y.Z` tag. The workflow builds the
pinned language server for every platform, smoke-tests each binary, packages one
`.vsix` per platform, creates the GitHub release and publishes to Open VSX. See
[RELEASING.md](RELEASING.md) for the steps and the one-time setup.

---

## NPM Scripts

| Command | Description |
|---------|-------------|
| `yarn compile` | Compile TypeScript |
| `yarn watch` | Watch mode for development |
| `yarn lint` | Run ESLint |
| `yarn package` | Package extension for this machine |
| `yarn link-binary` | Run symlink helper script |

---

## Troubleshooting

**Extension not activating?**
- Make sure a binary exists at `bin/comline-lsp`
- Check the Output panel: View → Output → "Comline Language Server"

**TypeScript errors?**
```bash
yarn compile
```

**Want to rebuild?**
```bash
yarn compile && code --install-extension *.vsix
```

---

## Next Steps

- See [README.md](README.md) for full documentation
- Check [bin/README.md](bin/README.md) for binary setup details
- Review [.github/workflows/](.github/workflows/) for CI/CD configuration
