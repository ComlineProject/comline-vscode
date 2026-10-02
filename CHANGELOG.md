# Change Log

All notable changes to the "comline-vscode" extension will be documented in this file.

## [Unreleased]

### Added
- Syntax highlighting for `.idp` (package/congregation config) files, as
  the new `comline-package` language — a separate grammar from `.ids`
  since the two share almost no vocabulary (`.idp`'s only real keyword is
  `congregation`; everything else is an ordinary identifier).
- A Comline icon in the editor title bar opens a menu to run
  `comline build` / `check` / `generate` / `clean` against the current
  workspace (via the VS Code Tasks API, with a toast reporting the CLI's
  real exit code), also available from the Command Palette. New settings:
  `comline.cli.mode` / `comline.cli.customPath`, mirroring the existing
  `comline.server.*` shape.
- Build/Check/Generate/Clean now resolve the right Comline package
  automatically: a single `config.idp` anywhere in the workspace is used
  with no prompt; with more than one, a status bar item (only shown when
  there's a real choice to make) shows the active package and opens a menu
  to switch it or to run a command against any other discovered package
  without changing the active one. Commands run with real colored CLI
  output instead of `--plain`.
- `.idp` completion and hover for the whole schema (`specification_version`,
  `code_generation.languages`, `dependencies`, `publish_registries`, and
  each one's own sub-keys) — client-side, no `.idp` language-server support
  existed to build on. `code_generation.languages` completion/hover is
  backed by a live `comline targets` query against the configured CLI
  (`comline.cli.*`), not a guessed list, with a dashed warning underline on
  any declared target that isn't actually registered.
- Real `.idp` parse-error diagnostics, from the actual `.idp` grammar via
  the language server (parse errors only — `.idp`'s deeper semantic
  validation isn't safe to run per-keystroke yet, see the language-server
  changelog).
- The editor-title Comline button is now file-scoped (`Format Document` /
  `Lint File`, both currently stubs — `comline` has no formatter or linter
  today) rather than duplicating the project-wide Build/Check/Generate/
  Clean actions, which stay reachable via the Command Palette.

### Fixed
- Packaged `.vsix` builds were missing their one runtime dependency
  (`vscode-languageclient`) — `.vscodeignore` excluded `node_modules/**`
  wholesale, which also stripped production dependencies `vsce` had
  correctly identified for inclusion. The extension crashed on activation
  in any installed (non-F5) context.
- `comline.trace.server` was declared but silently never read — the
  `LanguageClient` id didn't match the settings section it names.
- `comline.server.debug` was declared but never wired to anything.
- `.github/workflows/ci.yml`'s `package-test` job used `npm ci` against a
  yarn-only repo (no `package-lock.json`) — fixed to use yarn.
- `test-workspace/*.ids` example fixtures (and `examples/user.ids`) were
  written against a stale IDL dialect and failed to parse entirely —
  replaced with real schemas from `ComlineProject/examples`.

### Added
- `Comline: Restart Language Server` command (previously documented, never
  implemented).
- Language icons (`icons/comline-{light,dark}.png`).
- The extension's own icon (`icons/extension-icon.png`) — `package.json`
  had no top-level `icon` field at all, so it showed a generic placeholder
  in the Extensions view and Marketplace listing.

### Changed
- `bin/comline-lsp` is no longer a committed symlink (was machine-specific
  and dangling on a fresh clone) — run `yarn link-binary` after cloning.

## [0.1.0] - 2026-01-12

### Added
- Initial release of Comline VSCode extension
- Syntax highlighting for `.ids` files
- Language Server Protocol integration
- Real-time diagnostics
- Document symbols and outline view
- Hover information for types
- Go to definition
- Find references
- Auto-completion
- Semantic tokens
- Three server location modes: bundled (default), PATH, and custom path
- Comment toggling and bracket matching
- Code folding support
- Comprehensive configuration options

### Features
- TextMate grammar for Comline syntax
- Smart server executable resolution with fallback
- Cross-platform support (Linux, macOS, Windows)
- Debug logging and LSP tracing options
