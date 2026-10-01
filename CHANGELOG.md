# Change Log

All notable changes to the "comline-vscode" extension will be documented in this file.

## [Unreleased]

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
