# Change Log

All notable changes to the "comline-vscode" extension will be documented in this file.

## [Unreleased]

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
