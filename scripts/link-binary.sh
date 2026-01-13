#!/bin/bash
set -e

# Script to help with creating symlinks for development
# Usage: ./scripts/link-binary.sh /path/to/language-server [debug|release]

if [ $# -lt 1 ]; then
  echo "Usage: $0 /path/to/language-server [debug|release]"
  echo ""
  echo "Example:"
  echo "  $0 ~/projects/language-server debug"
  echo "  $0 ~/projects/language-server release"
  exit 1
fi

LSP_REPO="$1"
BUILD_TYPE="${2:-debug}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PROJECT_ROOT/bin"

# Validate LSP repository
if [ ! -d "$LSP_REPO" ]; then
  echo "❌ Directory not found: $LSP_REPO"
  exit 1
fi

if [ ! -f "$LSP_REPO/Cargo.toml" ]; then
  echo "❌ Not a Rust project: $LSP_REPO"
  exit 1
fi

# Determine binary path
BINARY_PATH="$LSP_REPO/target/$BUILD_TYPE/comline-lsp"

if [ ! -f "$BINARY_PATH" ]; then
  echo "⚠️  Binary not found: $BINARY_PATH"
  echo "Building $BUILD_TYPE binary..."
  
  cd "$LSP_REPO"
  if [ "$BUILD_TYPE" = "release" ]; then
    cargo build --release
  else
    cargo build
  fi
  
  if [ ! -f "$BINARY_PATH" ]; then
    echo "❌ Build failed or binary not found"
    exit 1
  fi
fi

# Create bin directory if it doesn't exist
mkdir -p "$BIN_DIR"

# Remove existing symlink or file
TARGET_LINK="$BIN_DIR/comline-lsp"
if [ -L "$TARGET_LINK" ]; then
  echo "🗑️  Removing existing symlink"
  rm "$TARGET_LINK"
elif [ -f "$TARGET_LINK" ]; then
  echo "⚠️  Found regular file at $TARGET_LINK"
  read -p "Replace it with symlink? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm "$TARGET_LINK"
  else
    echo "Aborted"
    exit 1
  fi
fi

# Create symlink (relative path for portability)
RELATIVE_PATH=$(realpath --relative-to="$BIN_DIR" "$BINARY_PATH")
ln -s "$RELATIVE_PATH" "$TARGET_LINK"

echo "✅ Created symlink:"
echo "   $TARGET_LINK -> $RELATIVE_PATH"
echo ""
echo "🎉 Ready for development!"
echo "   Press F5 in VSCode to test the extension"
