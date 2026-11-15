// Run with `yarn test` (node's built-in runner, on the compiled output).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cliCoreRev, coreRevMismatch, mismatchMessage, serverCoreRev } from './coreRev';

const A = '14ce54658455206d639ddc4fbe6d609d20292587';
const B = '3b9cc9d0a1f2e4c5b6a798011223344556677889';

const cliOutput = (rev: string): string =>
  `comline 0.2.0\ncommit-hash: 8590a0a8e2c1\ncommit-branch: main\ncommit-count: 123\n` +
  `build-date: 2026-11-16 10:00:00 UTC\ncore-rev: ${rev}\n`;

test('the server reports its core in serverInfo.version', () => {
  assert.equal(serverCoreRev(`0.1.0 (core ${A})`), A);
});

test('a server that does not say, or says unknown, has no core rev', () => {
  assert.equal(serverCoreRev(undefined), undefined);
  assert.equal(serverCoreRev('0.1.0'), undefined);
  assert.equal(serverCoreRev('0.1.0 (core unknown)'), undefined);
  assert.equal(serverCoreRev('0.1.0 (core 14ce546)'), undefined);
});

test('the CLI reports its core in a core-rev line of --version', () => {
  assert.equal(cliCoreRev(cliOutput(A)), A);
});

test('a CLI without the line, or with unknown, has no core rev', () => {
  assert.equal(cliCoreRev('comline 0.2.0\ncommit-hash: 8590a0a8e2c1\n'), undefined);
  assert.equal(cliCoreRev(cliOutput('unknown')), undefined);
  assert.equal(cliCoreRev(''), undefined);
});

test('the core-rev line is a line of its own, not a substring of another', () => {
  assert.equal(cliCoreRev(`commit-branch: core-rev: ${A}\n`), undefined);
});

test('different cores are a mismatch', () => {
  assert.deepEqual(coreRevMismatch(`0.1.0 (core ${A})`, cliOutput(B)), { server: A, cli: B });
});

test('the same core is not', () => {
  assert.equal(coreRevMismatch(`0.1.0 (core ${A})`, cliOutput(A)), undefined);
});

test('with either side unknown there is nothing to say', () => {
  assert.equal(coreRevMismatch(undefined, cliOutput(A)), undefined);
  assert.equal(coreRevMismatch('0.1.0 (core unknown)', cliOutput(A)), undefined);
  assert.equal(coreRevMismatch(`0.1.0 (core ${A})`, undefined), undefined);
  assert.equal(coreRevMismatch(`0.1.0 (core ${A})`, cliOutput('unknown')), undefined);
  assert.equal(coreRevMismatch(undefined, undefined), undefined);
});

test('the message names both cores, short', () => {
  assert.equal(
    mismatchMessage({ server: A, cli: B }),
    'Comline: the language server was built with core 14ce546, the CLI with core 3b9cc9d; ' +
      'diagnostics may differ from what `comline generation` reports.'
  );
});
