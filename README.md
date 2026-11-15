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
- **Generate** — write generated code for every configured target (`comline generation`)
- **Clean** — remove generated code (`comline generation clean`)

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

The extension supports four modes for locating the language server binary:

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

### 4. Host (`host`)
Run the language server on the host system:

```json
{
  "comline.server.mode": "host"
}
```

Inside a Flatpak (below) this goes through `flatpak-spawn --host`; anywhere else
the editor is already on the host, and `host` is the same as `path`. Set
`comline.server.customPath` as well to run a binary that isn't on the host's
`PATH`, such as `~/.cargo/bin/comline-lsp` (written out, `~` is not expanded).

`path` and `custom` look up the program where the editor runs. `path` searches
the editor's own `PATH` (with `PATHEXT` on Windows) and says which directories it
searched if the server isn't there. An editor started from a launcher or a
dock can have a different `PATH` than your shell.

### Flatpak (VSCodium, VS Code)

The bundled server needs none of this: it is a static build and runs inside the
sandbox. Read on only to run a different `comline-lsp` (a newer build, say), or
the `comline` CLI, in the Flatpak builds of VSCodium (`com.vscodium.codium`) or
VS Code (`com.visualstudio.code`).

The editor runs in a sandbox with its own `PATH` and its own runtime, so it
can't run programs installed on your system. Install the program on the host as
usual, and the extension runs it there with
[`flatpak-spawn --host`](https://docs.flatpak.org/en/latest/flatpak-command-reference.html#flatpak-spawn):

- **`path` mode does this by itself inside a Flatpak.** For the CLI it is the
  default, so Build/Check/Generate/Clean work with `comline` installed on the
  host. For the server, set `"comline.server.mode": "path"` (or `"host"`).
- If the program isn't on the host's `PATH` (the host command runs with your
  session's `PATH`, which can lack `~/.cargo/bin`), set `"host"` mode and
  `customPath` to its absolute path on the host. The extension checks the host
  first and tells you what to install or which setting to change.
- It needs `flatpak-spawn` in the sandbox and the permission to talk to
  `org.freedesktop.Flatpak` on D-Bus, which the Flathub manifests of both
  editors grant
  ([VSCodium](https://github.com/flathub/com.vscodium.codium/blob/master/com.vscodium.codium.yaml),
  [VS Code](https://github.com/flathub/com.visualstudio.code/blob/master/com.visualstudio.code.yaml):
  `--talk-name=org.freedesktop.Flatpak`). `flatpak info --show-permissions
  <app-id>` lists what yours has; `flatpak override --user
  --talk-name=org.freedesktop.Flatpak <app-id>` adds it back.
- The server's stdio is passed through, and `RUST_LOG` (the `comline.server.debug`
  setting) is forwarded with `--env`.

**A custom path** (`custom` mode) is read inside the sandbox. Both Flathub
manifests have `--filesystem=host`, so the binary can be anywhere under your home
directory (or another path `host` covers), but not in the host's `/usr`, `/etc`,
`/bin` or `/lib`: those are [reserved
paths](https://docs.flatpak.org/en/latest/sandbox-permissions.html#reserved-paths),
a `--filesystem` for them has no effect, and the host's `/usr` is at
`/run/host/usr`, not `/usr`. A server installed in `/usr/bin` can only be
reached with `host` mode. A binary the sandbox can read must also run there: it
has the Flatpak runtime's libraries, not your distro's, so a dynamically linked
build may not start (the bundled Linux servers are static musl builds for that
reason). `host` mode has neither limit.

After changing a setting, run `Developer: Reload Window`; the extension reads the
server settings when it activates.

### Additional Settings

```json
{
  // Enable debug logging
  "comline.server.debug": true,
  
  // Trace LSP communication (off, messages, verbose)
  "comline.trace.server": "messages"
}
```

`comline.warnOnCoreMismatch` (default `true`): the language server and the CLI
each know which `comline-core` they were built with (`comline-lsp --version`,
`comline --version`). When they differ, the extension warns once per session
that diagnostics may differ from what `comline generation` reports. Nothing is
said if either one doesn't report it. "Don't show again" in the warning, or
this setting set to `false`, turns it off.

### CLI Binary Location

The Build/Check/Generate/Clean commands look for `comline` on `PATH` by
default (`comline.cli.mode`: `path`; inside a Flatpak, on the host, see
[Flatpak](#flatpak-vscodium-vs-code)). To use a non-`PATH` install instead:

```json
{
  "comline.cli.mode": "custom",
  "comline.cli.customPath": "/path/to/comline"
}
```

`"host"` runs it on the host system, as for the server above, with
`comline.cli.customPath` as the program when set.

Generate runs `comline generation` and Clean runs `comline generation clean`,
so the CLI has to be a version with those commands (cli#153); older ones had
`generate` and `clean`.

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
- **PATH mode**: Run `which comline-lsp` (Linux/Mac) or `where comline-lsp` (Windows) to verify installation. The error message lists the directories searched; an editor started from a launcher can have a different `PATH` than your shell
- **Custom mode**: Check that `comline.server.customPath` points to the correct binary
- **Host mode**: the program has to be on the host (see the message the extension shows)
- **Flatpak**: see [Flatpak](#flatpak-vscodium-vs-code)

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
