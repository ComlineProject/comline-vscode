# Releasing

A release is a reviewed PR plus a tag. Pushing the tag runs
`.github/workflows/release.yml`, which does everything else: it builds the
language server for every platform, smoke-tests each binary, packages one
`.vsix` per platform, creates the GitHub release and publishes to Open VSX.

## What a release contains

| package | bundled server |
|---|---|
| `comline-vscode-X.Y.Z-linux-x64.vsix` | static musl `comline-lsp` |
| `comline-vscode-X.Y.Z-linux-arm64.vsix` | static musl `comline-lsp` |
| `comline-vscode-X.Y.Z-darwin-x64.vsix` | `comline-lsp` |
| `comline-vscode-X.Y.Z-darwin-arm64.vsix` | `comline-lsp` |
| `comline-vscode-X.Y.Z-win32-x64.vsix` | `comline-lsp.exe` |
| `comline-vscode-X.Y.Z-universal.vsix` | none |

`SHA256SUMS` covers all six. Open VSX serves each user the package for their
platform. An editor on any other platform falls back to `universal`, where the
user sets `comline.server.mode` to `path` or `custom`.

Every server is built from the **language-server rev pinned in `package.json`**:

```json
"comline": { "languageServer": { "rev": "<full commit sha>" } }
```

So a release always records which server it ships. Moving the server is a
reviewed change like any other pin, and CI fails a PR whose pinned rev is not
on GitHub.

> **Caveat:** `language-server` does not commit its `Cargo.lock`. The pin fixes
> the server's own source, but its transitive crate versions are resolved when
> the release builds. Committing that lockfile would make releases fully
> reproducible.

The `comline` CLI is **not** bundled. Build/Check/Generate/Clean need it on
`PATH` (see the README's Requirements section).

## Cutting a release

1. **Release PR** against `main`:
   - bump `version` in `package.json`
   - in `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`
     and start a fresh empty `## [Unreleased]` above it. That section becomes
     the release notes word for word.
   - optionally move `comline.languageServer.rev` to a newer `language-server`
     commit

   Merge it.

2. **Dry run** (recommended whenever the pin moved): Actions → *Release
   Extension* → *Run workflow* on `main`. It builds, tests and packages every
   target and uploads the packages as artifacts, but publishes nothing.

3. **Tag the merge commit**:
   ```bash
   git fetch origin
   git tag vX.Y.Z origin/main
   git push origin vX.Y.Z
   ```

The workflow refuses to release if:
- the tag isn't `v` + the `package.json` version
- `CHANGELOG.md` has no `## [X.Y.Z]` section
- the pinned rev doesn't exist
- any binary fails its smoke test (start, `initialize`, a diagnostic for a
  broken schema, clean exit)
- any package contains anything other than exactly its own binary

**An Open VSX version can never be republished.** A broken release is fixed by
releasing X.Y.Z+1, not by re-tagging. Re-running a failed workflow is safe:
the GitHub release refreshes its assets, and Open VSX skips packages that
already landed.

## One-time setup

Publishing to Open VSX needs a token the repository doesn't have yet:

1. Sign in at [open-vsx.org](https://open-vsx.org) with an Eclipse account and
   sign the publisher agreement.
2. Create an access token (Settings → Access Tokens).
3. Claim the `comline` namespace (it matches `publisher` in `package.json`):
   ```bash
   npx ovsx create-namespace comline -p <token>
   ```
4. Add the token as a repository secret named `OVSX_PAT` (Settings → Secrets
   and variables → Actions).

Without `OVSX_PAT`, the GitHub release is still created, and then the
*Publish to Open VSX* job fails, saying so.

## Locally

`yarn package` builds a `.vsix` for this machine only, bundling whatever
`bin/comline-lsp` points at. `node scripts/smoke-lsp.mjs <path/to/comline-lsp>`
runs the same smoke test CI does.
