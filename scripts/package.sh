#!/bin/bash
set -e

# Script to package the VSCode extension with multi-platform binaries
# Usage: ./scripts/package.sh [--bundle-binaries]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PROJECT_ROOT/bin"

echo "🚀 Comline VSCode Extension Packager"
echo "===================================="

# Check if --bundle-binaries flag is set
BUNDLE_BINARIES=false
if [[ "$1" == "--bundle-binaries" ]]; then
  BUNDLE_BINARIES=true
fi

# Compile TypeScript
echo ""
echo "📦 Compiling TypeScript..."
cd "$PROJECT_ROOT"
yarn compile

if [ $? -ne 0 ]; then
  echo "❌ TypeScript compilation failed"
  exit 1
fi

echo "✅ TypeScript compilation successful"

# Check for binaries if bundling
if [ "$BUNDLE_BINARIES" = true ]; then
  echo ""
  echo "🔍 Checking for language server binaries..."
  
  PLATFORMS=("linux-x64" "darwin-x64" "darwin-arm64" "win32-x64")
  MISSING_PLATFORMS=()
  
  for platform in "${PLATFORMS[@]}"; do
    if [ "$platform" = "win32-x64" ]; then
      BINARY_PATH="$BIN_DIR/$platform/comline-lsp.exe"
    else
      BINARY_PATH="$BIN_DIR/$platform/comline-lsp"
    fi
    
    if [ ! -f "$BINARY_PATH" ]; then
      MISSING_PLATFORMS+=("$platform")
    else
      echo "  ✅ Found binary for $platform"
    fi
  done
  
  if [ ${#MISSING_PLATFORMS[@]} -gt 0 ]; then
    echo ""
    echo "⚠️  Missing binaries for platforms: ${MISSING_PLATFORMS[*]}"
    echo "   Packaging will continue, but the extension may not work on all platforms."
    echo "   Multi-platform binaries are built by .github/workflows/release.yml on a"
    echo "   tag push — this script doesn't build them locally."
  else
    echo ""
    echo "✅ All platform binaries found"
  fi
fi

# Check for single binary (development mode)
if [ "$BUNDLE_BINARIES" = false ]; then
  if [ -f "$BIN_DIR/comline-lsp" ] || [ -f "$BIN_DIR/comline-lsp.exe" ]; then
    echo ""
    echo "ℹ️  Development mode: Using single binary from bin/"
  else
    echo ""
    echo "⚠️  No binary found in bin/ directory"
    echo "   For development: Create a symlink to your debug build"
    echo "   See bin/README.md for instructions"
  fi
fi

# Package extension
echo ""
echo "📦 Packaging extension..."

npx vsce package --allow-missing-repository --yarn

if [ $? -ne 0 ]; then
  echo "❌ Packaging failed"
  exit 1
fi

echo ""
echo "✅ Extension packaged successfully!"
echo ""

# Find the .vsix file
VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -n1)

if [ -n "$VSIX_FILE" ]; then
  VSIX_SIZE=$(du -h "$VSIX_FILE" | cut -f1)
  echo "📦 Package: $VSIX_FILE ($VSIX_SIZE)"
  echo ""
  echo "To install locally:"
  echo "  code --install-extension $VSIX_FILE"
else
  echo "⚠️  Could not find .vsix file"
fi

echo ""
echo "Done! 🎉"
