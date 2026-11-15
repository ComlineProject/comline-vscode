# Change Log

All notable changes to the "comline-vscode" extension will be documented in this file.

## [Unreleased]

### Added
- The `char` type highlights as a primitive, and `max` as a keyword right
  after `[` (`char[max 32]`, `T[max N]`); a field named `max` stays an
  identifier.
- README: running a language server other than the bundled one in Flatpak
  VSCodium and VS Code.
- `host` mode for `comline.server.mode` and `comline.cli.mode`: runs the
  language server or the CLI on the host system. Inside a Flatpak that is
  `flatpak-spawn --host` (stdio and `RUST_LOG` pass through); the extension
  checks `flatpak-spawn` and the program on the host first, and says what to
  install or which setting to change. Outside a Flatpak it is the same as
  `path`. `comline.server.customPath` / `comline.cli.customPath` name the
  program to run in `host` mode, for one that isn't on the host's `PATH`
  (`~/.cargo/bin`).
- Unit tests for the server and CLI resolution (`yarn test`), run in CI, and a
  workflow that runs the same code inside Flathub's VSCodium sandbox against a
  real `flatpak-spawn --host` (`scripts/flatpak-e2e.cjs`).
- `comline.toml` is its own language, `comline-toml`, highlighted with a
  bundled TOML grammar (Taplo's, MIT; see `syntaxes/THIRD-PARTY-NOTICES.md`)
  and served by the Comline language server: diagnostics for its shape and
  for the package it's in, completion, hover and quick fixes. Needs a
  language server with comline.toml support (language-server#90).
- `f"..."` strings highlight as interpolated, each `{path}` placeholder
  apart; `{{` and `}}` as escapes.

### Changed
- Inside a Flatpak, `path` mode runs the program on the host through
  `flatpak-spawn --host`, since the sandbox's `PATH` is not the host's. The
  CLI's default mode is `path`, so Build/Check/Generate/Clean find a `comline`
  installed on the host. The bundled server (the server's default) is
  unaffected: it runs in the sandbox.
- Generate runs `comline generation` and Clean runs `comline generation clean`,
  as cli#153 renamed them; they need a CLI with those commands. The command
  ids (`comline.generate`, `comline.clean`) and titles are unchanged.

### Fixed
- `comline.server.mode: "path"` never worked: the extension passed the bare
  name `comline-lsp` to a file-existence check, which looks in the current
  directory, not on `PATH`. The name is now looked up on `PATH` (with
  `PATHEXT` on Windows), and the error lists the directories searched. The
  CLI's `path` mode and a bare `customPath` are resolved the same way, and a
  CLI that isn't found is reported before the task runs.
- Build, Check, Generate and Clean were not registered when the language server
  wasn't found; they no longer depend on it.
- The bundled language server moves from `b980a6e` to `8590a0a`. The old one
  linked a comline-core from before `T[max N]` bounds and `char`, so it
  reported "unexpected token `max`" on `char[max 32]`. The new one also reports
  a bare path to the package's own schema (`use types::Message`) and offers
  `package::` instead; `test-workspace/chat.ids` is updated.
- A lone `<` or `>` (a comparison, `->`) no longer shows as an unmatched
  bracket. Comline has no angle brackets.
- Accepting a `code_generation.languages` completion inserts only the
  target (`rust#1.85.0`), not the versions `comline targets` lists after it;
  those now show as the item's detail.
- `.idp` keys (`specification_version`, `languages`, a dependency's name,
  `path`) highlight as property names, apart from the `congregation`
  keyword.

### Removed
- The `tomlValidation` contribution, the Even Better TOML extension pack and
  the bundled `schemas/comline-toml.json` (with `scripts/sync-schema.sh` and
  its CI job). The language server now owns `comline.toml`, reading the
  schema from the CLI's own types, so nothing here used the copy. Even Better
  TOML only attaches to the `toml` language, so it no longer sees the file;
  other editors still get the schema from the `#:schema` line `comline new`
  writes.
- The dashed underline on a declared target, and the target hover. They
  matched `name#version` exactly, but a version is a minimum; the language
  server's diagnostics and hover check a target as `comline build` does.

## [0.1.0] - 2026-10-18

The first release.

### Added
- One package per platform (`linux-x64`, `linux-arm64`, `darwin-x64`,
  `darwin-arm64`, `win32-x64`), each bundling its own `comline-lsp`, plus a
  `universal` package without one. Linux builds are static, so they run on any
  distribution.
- Language Server Protocol integration: real-time diagnostics, hover,
  go-to-definition, find-references, document symbols and the outline view,
  auto-completion, and semantic tokens.
- Three ways to locate the language server: bundled (default), on `PATH`, or a
  custom path (`comline.server.*`), with debug logging
  (`comline.server.debug`) and LSP tracing (`comline.trace.server`).
- Syntax highlighting for `.ids` files, with comment toggling, bracket
  matching and code folding.
- Go-to-definition into the standard library (`use std::http::Request`) opens
  std's schema as a read-only `comline-std:` document, served by the language
  server (`comline/stdSource`) — std is embedded in the toolchain, never on
  disk. Hover and go-to-definition keep working inside it.
- Syntax highlighting, completion, hover, and outline/go-to-definition/
  find-references support for `.ids`'s `type` alias declaration
  (`type UserId = u64` — fully transparent, erased before code generation,
  same as Rust's own `type`).
- Syntax highlighting for `.idp` (package/congregation config) files, as
  the `comline-package` language — a separate grammar from `.ids`
  since the two share almost no vocabulary (`.idp`'s only real keyword is
  `congregation`; everything else is an ordinary identifier).
- `.idp` completion and hover for the whole schema (`specification_version`,
  `code_generation.languages`, `dependencies`, `publish_registries`, and
  each one's own sub-keys). `code_generation.languages` completion/hover is
  backed by a live `comline targets` query against the configured CLI
  (`comline.cli.*`), not a guessed list, with a dashed warning underline on
  any declared target that isn't actually registered.
- `.idp` parse-error diagnostics, from the actual `.idp` grammar via the
  language server (parse errors only — `.idp`'s deeper semantic validation
  isn't safe to run per-keystroke yet, see the language-server changelog).
- `Comline: Build` / `Check` / `Generate` / `Clean` from the Command Palette,
  run through the VS Code Tasks API with the CLI's real colored output and a
  toast reporting its exit code. These need the `comline` CLI, which is not
  bundled: on `PATH` by default, or set `comline.cli.mode` /
  `comline.cli.customPath`.
- Those commands resolve the right Comline package automatically: a single
  `config.idp` anywhere in the workspace is used with no prompt; with more
  than one, the active one is inferred from context instead. A status bar item
  (shown whenever at least one package is found, so the current context is
  always visible) opens a menu to switch the active package or to run a
  command against any other discovered package without changing it.
- An editor-title Comline button with file-scoped actions (`Format Document` /
  `Lint File`, both stubs for now — `comline` has no formatter or linter yet).
- `Comline: Restart Language Server`.
- Language icons (`icons/comline-{light,dark}.png`) and the extension's own
  icon.
