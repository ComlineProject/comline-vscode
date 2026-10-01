# Testing the Comline VSCode Extension

## ✅ Setup

The extension needs a local `comline-lsp` binary before F5 will find a
server to attach to — this isn't committed (it's machine-specific), so run
once after cloning:
```bash
yarn install
yarn link-binary <path-to-your-language-server-checkout>
# e.g. yarn link-binary ../../../../language-server
```
This builds `comline-lsp` (debug, by default) in that checkout if needed and
symlinks it to `bin/comline-lsp`.

---

## 🧪 How to Test

### Method 1: Debug Mode (Recommended)

1. **Open this repo's root folder in VSCode.**

2. **Press F5**
   - This launches the "Extension Development Host" window
   - The extension will auto-compile and activate
   - It opens straight onto `test-workspace/`

3. **In the new window, open one of the example files:**
   - `test-workspace/chat.ids` / `types.ids` — a small protocol split across
     two files, good for cross-file hover/go-to-definition
   - `test-workspace/keyvalue.ids` — a single-file example with docstrings
   - Or create a new `.ids` file

4. **Test these features:**

   ✅ **Syntax Highlighting**
   - Keywords like `struct`, `enum`, `protocol` should be colored
   - Types like `u64`, `string`, `bool` should be highlighted
   - Comments should be distinct

   ✅ **Document Outline** (Ctrl+Shift+O)
   - Should show all structs, enums, and protocols
   - Try clicking on symbols to navigate

   ✅ **Hover Information**
   - Hover over type names
   - Should show definition tooltips

   ✅ **Auto-Completion** (Ctrl+Space)
   - Start typing `str` - should suggest `struct`
   - Start typing `u` - should suggest `u8`, `u16`, etc.
   - Inside a struct, should suggest field types

   ✅ **Go to Definition** (F12)
   - Click on a type reference
   - Should jump to where it's defined

   ✅ **Find References** (Shift+F12)
   - Right-click on a type name
   - Should show all usages

5. **Check for Errors**
   - Look at the Output panel: `View → Output → "Comline Language Server"`
   - Should see "Starting Comline Language Server"
   - No error messages

---

### Method 2: Install Locally

If you want to test as a regular extension:

```bash
# Package the extension
yarn package

# Install it
code --install-extension comline-vscode-0.1.0.vsix

# Reload VSCode
# Then open any .ids file
```

---

## 🐛 Troubleshooting

### Extension not activating?
- Check Output panel for errors
- Verify binary exists: `ls -la bin/comline-lsp`
- Try reloading: Ctrl+Shift+P → "Developer: Reload Window"

### No syntax highlighting?
- Make sure file has `.ids` extension
- Check if language is detected (bottom right corner should show "Comline")

### LSP features not working?
- Check if server started: Output → "Comline Language Server"
- Enable trace: Settings → `comline.trace.server` → `"verbose"`
- Check for diagnostic errors in the file

### Need to rebuild language server?
```bash
yarn link-binary <path-to-your-language-server-checkout>
# Rebuilds (if needed) and re-links bin/comline-lsp to the new build.
```

---

## 📝 What to Test

Here's a comprehensive test checklist:

### Basic Functionality
- [ ] Syntax highlighting works for all token types
- [ ] File is recognized as Comline (check status bar)
- [ ] Extension activates on opening `.ids` file

### LSP Features
- [ ] Real-time diagnostics (try adding syntax errors)
- [ ] Document outline/symbols view
- [ ] Hover tooltips on types
- [ ] Auto-completion suggests keywords and types
- [ ] Go to definition navigates correctly
- [ ] Find references shows all usages
- [ ] Semantic tokens (enhanced coloring)

### Editor Features
- [ ] Comment toggling (Ctrl+/)
- [ ] Bracket matching works
- [ ] Auto-closing pairs work
- [ ] Code folding works

### Configuration
- [ ] Try changing `comline.trace.server` setting
- [ ] Extension respects configuration changes

---

## 🎯 Next Steps After Testing

Once you've verified everything works:

1. **Report any issues** you find
2. **Test with real Comline schemas** from your projects
3. **Create a release** when ready:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   # GitHub Actions will build multi-platform binaries automatically
   ```

---

## 🚀 Ready to Test!

**Just press F5 in VSCode to get started!**
