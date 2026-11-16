// Loads the bundled extension the way the editor does, with `vscode` stubbed,
// and checks it exports activate and deactivate. Run it under the oldest Node
// an editor the extension supports uses (16): a module the bundle needs but
// lacks, or syntax that Node cannot parse, fails here and not at a user's
// first activation.
//
//   node scripts/check-bundle.cjs <directory the .vsix was unzipped into>
//
// It does not call activate(): that needs an editor.
'use strict';
const Module = require('module');
const path = require('path');

const dir = process.argv[2];
if (!dir) {
  console.error('usage: check-bundle.cjs <unzipped .vsix directory>');
  process.exit(2);
}
const file = path.resolve(dir, 'extension', 'dist', 'extension.js');

// Any property, call or construction on it answers with itself.
const stub = new Proxy(function () {}, {
  get: (_t, prop) => (prop === 'then' || prop === '__esModule' ? undefined : prop === Symbol.toPrimitive ? () => '' : stub),
  apply: () => stub,
  construct: () => stub,
});
const load = Module._load;
Module._load = function (request, ...rest) {
  return request === 'vscode' ? stub : load.call(this, request, ...rest);
};

console.log(`node ${process.version}: loading ${file}`);
const ext = require(file);
for (const name of ['activate', 'deactivate']) {
  if (typeof ext[name] !== 'function') {
    console.error(`::error::the bundle does not export ${name}()`);
    process.exit(1);
  }
}
console.log('loaded: exports activate() and deactivate()');
