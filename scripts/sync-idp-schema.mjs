#!/usr/bin/env node
// Keep `src/idpSchema.generated.json`, the keys of `config.idp`, equal to core's.
//
//   node scripts/sync-idp-schema.mjs            # check; exit 1 on drift
//   node scripts/sync-idp-schema.mjs --write    # refresh the committed copy
//   node scripts/sync-idp-schema.mjs --rev <sha> [--write]
//
// Core keeps a table of every key its `config.idp` reader takes, with types,
// allowed values, defaults and prose (`comline_core::package::config::keys`,
// held to the reader by core's own tests), and commits it as
// `schemas/config-idp.json`. This copies that file at the core commit
// `comline.idpSchema.rev` in package.json pins (`--rev` tries another one), the
// way the docs repo keeps its copy of the `comline.toml` schema. Bump the pin
// when core changes what `config.idp` takes, then `--write`.
//
// Run by CI (`idp-schema` in ci.yml). Node built-ins only, so it runs before
// `yarn install`.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const copy = path.join(root, "src", "idpSchema.generated.json");

const args = process.argv.slice(2);
const write = args.includes("--write");
const revFlag = args.indexOf("--rev");
const pinned = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).comline?.idpSchema?.rev;
const rev = revFlag >= 0 ? args[revFlag + 1] : pinned;
if (!rev || !/^[0-9a-f]{40}$/.test(rev)) {
  console.error("sync-idp-schema: no core rev: set comline.idpSchema.rev in package.json (40 hex digits), or pass --rev");
  process.exit(2);
}

const url = `https://raw.githubusercontent.com/ComlineProject/core/${rev}/schemas/config-idp.json`;
const response = await fetch(url);
if (!response.ok) {
  console.error(`sync-idp-schema: ${url}: ${response.status} ${response.statusText}`);
  process.exit(2);
}
const upstream = await response.text();

const name = path.relative(root, copy);
if (write) {
  writeFileSync(copy, upstream);
  console.log(`wrote ${name} from core ${rev.slice(0, 7)}`);
  process.exit(0);
}

let current = "";
try {
  current = readFileSync(copy, "utf8");
} catch {
  // Missing counts as different.
}
if (current === upstream) {
  console.log(`${name}: up to date with core ${rev.slice(0, 7)}`);
} else {
  console.error(`${name} differs from ${url}`);
  console.error("Refresh with:\n    node scripts/sync-idp-schema.mjs --write");
  process.exit(1);
}
