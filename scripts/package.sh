#!/bin/bash
set -e

# Package the extension locally, for this machine only.
# Usage: ./scripts/package.sh
#
# Bundles whatever bin/comline-lsp points at (usually a symlink into a local
# language-server build — see bin/README.md). vsce follows the symlink and
# embeds the binary, so the result is a snapshot of today's build.
#
# Release packages — one per platform, each built from the language-server rev
# pinned in package.json — are made by .github/workflows/release.yml only. See
# RELEASING.md.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PROJECT_ROOT/bin"

echo "🚀 Comline VSCode Extension Packager (local)"
echo "============================================"

echo ""
echo "📦 Compiling TypeScript..."
cd "$PROJECT_ROOT"
yarn compile
echo "✅ TypeScript compilation successful"

if [ -e "$BIN_DIR/comline-lsp" ] || [ -e "$BIN_DIR/comline-lsp.exe" ]; then
  echo ""
  echo "ℹ️  Bundling bin/comline-lsp"
else
  echo ""
  echo "⚠️  No binary at bin/comline-lsp — the package will need comline.server.mode"
  echo "   set to 'path' or 'custom'. See bin/README.md to link a local build."
fi

echo ""
echo "📦 Packaging extension..."
npx vsce package --yarn

VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -n1)
if [ -n "$VSIX_FILE" ]; then
  echo ""
  echo "✅ $VSIX_FILE ($(du -h "$VSIX_FILE" | cut -f1))"
  echo ""
  echo "To install locally:"
  echo "  codium --install-extension $VSIX_FILE"
  echo ""
  echo "Installing replaces the installed bin/comline-lsp with a copy of the binary."
  echo "To keep picking up new language-server builds, re-link it afterwards:"
  echo "  ln -sf \"\$(realpath bin/comline-lsp)\" ~/.vscode-oss/extensions/comline.comline-vscode-*/bin/comline-lsp"
else
  echo "⚠️  Could not find the .vsix file"
  exit 1
fi
