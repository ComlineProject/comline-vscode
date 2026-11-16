#!/usr/bin/env bash
# Checks a .vsix is what the bundled build makes: the bundle, no node_modules,
# no compiled-for-the-tests out/. Usage: scripts/check-package.sh <file.vsix>
set -euo pipefail

vsix=${1:?usage: check-package.sh <file.vsix>}
entries=$(unzip -Z1 "$vsix")

fail() { echo "::error::$vsix: $1"; exit 1; }

grep -qx 'extension/dist/extension.js' <<<"$entries" || fail "extension/dist/extension.js is missing"
if grep -q '^extension/node_modules/' <<<"$entries"; then
  fail "it holds node_modules: $(grep '^extension/node_modules/' <<<"$entries" | head -3 | tr '\n' ' ')..."
fi
if grep -q '^extension/out/' <<<"$entries"; then
  fail "it holds out/, the tsc output for the tests"
fi
main=$(unzip -p "$vsix" extension/package.json | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).main')
[ "$main" = "./dist/extension.js" ] || fail "main is $main, not ./dist/extension.js"

echo "$vsix: $(wc -l <<<"$entries") files, no node_modules, main is $main"
unzip -Zl "$vsix" | grep -E 'extension/dist/|extension/package.json' || true
