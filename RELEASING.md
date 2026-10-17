# Releasing

A release is a reviewed PR plus a tag. Pushing the tag runs
`.github/workflows/release.yml`, which does everything else: it builds the
language server for every platform, smoke-tests each binary, packages one
`.vsix` per platform, creates the GitHub release and publishes to Open VSX.

## Channels

The same workflow makes four kinds of build. `scripts/release-meta.sh`
decides which from the event that started it.

| channel | started by | version | GitHub | Open VSX |
|---|---|---|---|---|
| **stable** | you push `vX.Y.Z` | `X.Y.Z` (= `package.json`) | release, marked latest | **published** |
| **pre** | you push `vX.Y.Z-rc.1`, `-beta.2`, … | the tag | prerelease | never |
| **dev** | every push to `main` | `X.Y.Z-dev.N` (CI tags it) | prerelease | never |
| **dry** | *Run workflow* by hand | `package.json` | nothing (artifacts only) | never |

**Dev builds** are prereleases of the next unreleased version. That is
`package.json`'s version until it is tagged, then the patch after it:
`0.1.0-dev.N` before `v0.1.0` exists, `0.1.1-dev.N` after. `N` counts the
commits since the last stable tag, so it only grows along `main`. In semver a
dev build sorts below the release it leads up to (`0.1.1-dev.4 < 0.1.1`).
Only the newest 10 are kept: older dev prereleases are deleted along with
their tags. A commit that already carries a stable tag gets no dev build.
`-dev.N` tags are CI's; a pushed one starts nothing.

**Prereleases** (`-rc`, `-beta`, …) must lead up to a version that isn't
released yet: `v0.2.0-rc.1` is refused once `v0.2.0` exists. Their notes come
from `## [X.Y.Z]` in `CHANGELOG.md` if there is one, else from
`## [Unreleased]`. Tag the commit you want tested:
```bash
git tag v0.2.0-rc.1 origin/main && git push origin v0.2.0-rc.1
```

Neither dev builds nor prereleases are ever published to Open VSX. Install
one by downloading its `.vsix` from the releases page.

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

2. **Check the dev build** of that merge commit, which CI has already made as
   a prerelease: install its `.vsix` and try it. A dry run (Actions →
   *Release Extension* → *Run workflow*) builds the same packages without
   creating a prerelease. Use it to test a branch before it merges.

3. **Tag the merge commit**:
   ```bash
   git fetch origin
   git tag vX.Y.Z origin/main
   git push origin vX.Y.Z
   ```

The workflow refuses to release if:
- a stable tag isn't `v` + the `package.json` version
- a stable tag has no `## [X.Y.Z]` section in `CHANGELOG.md`
- a prerelease tag leads up to an already-released version
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
