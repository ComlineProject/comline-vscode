# Comline VSCode Extension

Language support for [Comline](https://github.com/ComlineProject/core) schema files (`.ids`).

## Features

This extension provides rich language support for Comline through integration with the [Comline Language Server](https://github.com/ComlineProject/language-server):

### 🎨 Syntax Highlighting
- Keywords: `struct`, `enum`, `protocol`, `const`, `use`, `import`, `namespace`, `option`
- Primitive types: `i8`-`i128`, `u8`-`u128`, `f32`, `f64`, `bool`, `string`, `bytes`
- Collection types: `list`, `map`, `set`, `option`
- Comments: single-line (`//`) and multi-line (`/* */`)
- String literals and escape sequences
- Numbers: integers, floats, hexadecimal

### 🔍 Language Server Features
- **Real-time Diagnostics** - Syntax error detection as you type
- **Document Symbols** - Hierarchical outline view (Ctrl/Cmd+Shift+O)
- **Hover Information** - Type definitions and signatures on hover
- **Go to Definition** - Jump to type declarations (F12)
- **Find References** - Locate all usages of a symbol (Shift+F12)
- **Auto-Completion** - Context-aware suggestions for keywords, types, and symbols
- **Semantic Tokens** - Enhanced syntax highlighting based on semantic analysis

### 🛠️ Editor Features
- Comment toggling (`Ctrl/Cmd+/`)
- Bracket matching and auto-closing
- Code folding for struct/enum/protocol blocks
- `comline.toml` highlighting, and diagnostics, completion, hover and quick
  fixes from the Comline language server, which reads the file against the
  package next to it: the languages `config.idp` declares, the encodings in
  view, and the versions its generators handle. Other TOML extensions such as
  Even Better TOML attach to the `toml` language, so they leave `comline.toml`
  (its own `comline-toml` language) alone

### ⚙️ CLI Commands
A Comline icon in the editor title bar (when a `.ids`/`.idp` file or `comline.toml` is open)
opens a menu to run the [comline CLI](https://github.com/ComlineProject/cli)
against the current workspace, with a toast reporting success or failure:
- **Build** — compile and freeze a new version
- **Check** — validate without writing anything
- **Generate** — write generated code for every configured target
- **Clean** — remove generated code

Each is also available from the Command Palette as `Comline: Build` /
`Comline: Check` / `Comline: Generate` / `Comline: Clean`. Requires the
`comline` CLI to be installed and on `PATH` (or configured via
`comline.cli.customPath`, see below) — install it with:
```bash
cargo install --git https://github.com/ComlineProject/cli
```

## Requirements

- **The language server is bundled.** Releases ship one package per platform
  (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`), each
  carrying its own `comline-lsp`. Editing features need nothing else.
- **Build / Check / Generate / Clean need the `comline` CLI**, which is *not*
  bundled. Install it and put it on `PATH`, or point `comline.cli.customPath`
  at it (see [CLI Binary Location](#cli-binary-location)):
  ```bash
  cargo install --git https://github.com/ComlineProject/cli
  ```

## Installation

### From Open VSX (VSCodium and other Open VSX editors)
Search for "Comline" in the Extensions view. The editor picks the package for
your platform.

### From VSIX (Manual Installation)
1. Download the `.vsix` for your platform from
   [releases](https://github.com/ComlineProject/comline-vscode/releases), e.g.
   `comline-vscode-0.1.0-linux-x64.vsix`. `SHA256SUMS` lists their checksums.
2. In VS Code: `Extensions` → `...` → `Install from VSIX...`
3. Select the downloaded file

On a platform without its own package, install the `-universal` one. It has no
bundled server, so set `comline.server.mode` to `path` or `custom` (below).

### Development builds
Every change to `main` is built as a GitHub prerelease (`v0.1.1-dev.N`), and
release candidates appear as `-rc.N` prereleases. Neither is published to Open
VSX: install them from releases the same way. Expect them to be less tested.

### From the VS Code Marketplace (Coming Soon)
Not published there yet; use a `.vsix` from releases.

## Configuration

The extension supports three modes for locating the language server binary:

### 1. Bundled (Default)
The extension includes a pre-built language server binary. No configuration needed!

### 2. System PATH
Use a globally installed `comline-lsp` binary:

```json
{
  "comline.server.mode": "path"
}
```

First, install the language server:
```bash
cargo install --git https://github.com/ComlineProject/language-server
```

### 3. Custom Path
Specify a custom path to the language server binary:

```json
{
  "comline.server.mode": "custom",
  "comline.server.customPath": "/path/to/comline-lsp"
}
```

### Additional Settings

```json
{
  // Enable debug logging
  "comline.server.debug": true,
  
  // Trace LSP communication (off, messages, verbose)
  "comline.trace.server": "messages"
}
```

### CLI Binary Location

The Build/Check/Generate/Clean commands look for `comline` on `PATH` by
default. To use a non-`PATH` install instead:

```json
{
  "comline.cli.mode": "custom",
  "comline.cli.customPath": "/path/to/comline"
}
```

## Usage

1. Open any `.ids` file
2. The extension will automatically activate and start the language server
3. Enjoy intelligent code editing features!

### Example Comline Schema

```comline
/// User service protocol
struct User {
    id: u64
    name: string
    email: string
    created_at: u64
}

enum UserRole {
    Admin
    User
    Guest
}

error UserNotFound {
    message = "no user with id {self.id}"
    id: u64
}

protocol UserService {
    function get_user(id: u64) -> User ! UserNotFound;
    function create_user(name: string, email: string) -> User;
    function delete_user(id: u64) -> bool;
}
```

## Troubleshooting

### Language server not found
- **Default mode**: Ensure the bundled binary is included with the extension
- **PATH mode**: Run `which comline-lsp` (Linux/Mac) or `where comline-lsp` (Windows) to verify installation
- **Custom mode**: Check that `comline.server.customPath` points to the correct binary

### No syntax highlighting
- Ensure the file has a `.ids` extension
- Try reloading the window: `Ctrl/Cmd+Shift+P` → `Developer: Reload Window`

### LSP features not working
- Check the Output panel: `View` → `Output` → Select "Comline Language Server"
- Enable trace logging: `"comline.trace.server": "verbose"`
- Restart the language server: `Ctrl/Cmd+Shift+P` → `Comline: Restart Language Server`

## Building from Source

```bash
# Clone the repository
git clone https://github.com/ComlineProject/comline-vscode
cd comline-vscode

# Install dependencies
yarn install

# Link a local comline-lsp build (needed to actually run the server —
# see TESTING.md)
yarn link-binary <path-to-a-language-server-checkout>

# Compile TypeScript
yarn compile

# Package the extension
yarn package
```

This creates a `.vsix` file that can be installed manually.

## Contributing

Contributions are welcome! Please open issues or submit pull requests on [GitHub](https://github.com/ComlineProject/comline-vscode).

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [This extension](https://github.com/ComlineProject/comline-vscode)
- [Comline Core](https://github.com/ComlineProject/core)
- [Comline Language Server](https://github.com/ComlineProject/language-server)
- [VSCode Extension API](https://code.visualstudio.com/api)
