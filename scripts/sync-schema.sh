#!/bin/bash
set -euo pipefail

# Keep schemas/comline-toml.json equal to generation's.
#
# comline_codegen::config (ComlineProject/generation) is the source of truth
# for the comline.toml JSON Schema; this repo bundles a copy.
#
# Usage:
#   scripts/sync-schema.sh          # refresh the copy
#   scripts/sync-schema.sh --check  # exit 1 if the copy differs (CI)
#   REV=<sha> scripts/sync-schema.sh ...   # pin generation's ref (default HEAD)

cd "$(dirname "${BASH_SOURCE[0]}")/.."

url="https://raw.githubusercontent.com/ComlineProject/generation/${REV:-HEAD}/schemas/comline-toml.json"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp"

if [ "${1:-}" = "--check" ]; then
  if ! cmp -s "$tmp" schemas/comline-toml.json; then
    echo "::error::schemas/comline-toml.json differs from generation's. Refresh it with: scripts/sync-schema.sh"
    diff -u schemas/comline-toml.json "$tmp" | head -40 || true
    exit 1
  fi
  echo "schemas/comline-toml.json: up to date"
else
  cp "$tmp" schemas/comline-toml.json
  echo "wrote schemas/comline-toml.json from $url"
fi
