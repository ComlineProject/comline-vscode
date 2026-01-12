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

## Installation

### From VSIX (Manual Installation)
1. Download the latest `.vsix` file from [releases](https://github.com/ComlineProject/language-server/releases)
2. In VSCode: `Extensions` → `...` → `Install from VSIX...`
3. Select the downloaded file

### From Marketplace (Coming Soon)
Search for "Comline" in the VSCode Extensions marketplace.

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

## Usage

1. Open any `.ids` file
2. The extension will automatically activate and start the language server
3. Enjoy intelligent code editing features!

### Example Comline Schema

```comline
// User service protocol
namespace user.v1;

struct User {
  id: u64,
  name: string,
  email: string,
  created_at: i64,
}

enum UserRole {
  Admin,
  User,
  Guest,
}

protocol UserService {
  fn get_user(id: u64) -> option<User>;
  fn create_user(name: string, email: string) -> User;
  fn delete_user(id: u64) -> bool;
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
git clone https://github.com/ComlineProject/language-server
cd language-server/plugins/vscode/comline-vscode

# Install dependencies
yarn install

# Compile TypeScript
yarn compile

# Package the extension
yarn package
```

This creates a `.vsix` file that can be installed manually.

## Contributing

Contributions are welcome! Please open issues or submit pull requests on [GitHub](https://github.com/ComlineProject/language-server).

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [Comline Core](https://github.com/ComlineProject/core)
- [Comline Language Server](https://github.com/ComlineProject/language-server)
- [VSCode Extension API](https://code.visualstudio.com/api)
