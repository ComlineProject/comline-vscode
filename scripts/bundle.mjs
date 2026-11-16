// Bundles src/extension.ts into dist/extension.js: the one JavaScript file the
// .vsix carries (`main` in package.json), with every dependency resolved the
// way Node resolves it from the file that requires it, so
// vscode-languageclient gets the minimatch it asks for and no node_modules
// ships.
//
//   node scripts/bundle.mjs                  development: unminified, with a source map
//   node scripts/bundle.mjs --production     minified, no map (what `vsce package` runs)
//   node scripts/bundle.mjs --report         also print every package in the bundle
//
// `tsc` (yarn compile) stays the type check and builds out/ for the unit tests
// and the Flatpak e2e; it does not produce what the editor runs.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const production = process.argv.includes('--production');
const report = process.argv.includes('--report');

const result = await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  // The editor provides `vscode`.
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  // The extension host of the oldest editor package.json allows (engines.vscode
  // ^1.75.0) is Electron 19, Node 16.14.
  target: 'node16',
  minify: production,
  sourcemap: !production,
  metafile: true,
  logLevel: 'info',
});

if (report) {
  // name@version, and where it came from, for every package that went in.
  const found = new Map();
  for (const input of Object.keys(result.metafile.inputs)) {
    const m = /^((?:.*\/)?node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
    if (m && !found.has(m[1])) {
      const { name, version } = JSON.parse(readFileSync(path.join(m[1], 'package.json'), 'utf8'));
      found.set(m[1], `${name}@${version}`);
    }
  }
  console.log('Packages in the bundle:');
  for (const [dir, id] of [...found].sort((a, b) => a[1].localeCompare(b[1]))) {
    console.log(`  ${id}  (${dir})`);
  }
}
