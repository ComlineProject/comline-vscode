#!/usr/bin/env node
// Smoke-test a built `comline-lsp`: does it start, speak LSP over stdio, and
// actually parse a schema on this platform?
//
//   node scripts/smoke-lsp.mjs path/to/comline-lsp [--arch-x86_64]
//
// Run by the release workflow against every binary before it is packaged, and
// usable by hand against a local build. Node built-ins only, so it runs before
// `yarn install`.
//
// The parse step is the point. `comline-core` compiles its tree-sitter grammar
// from C at build time, so a binary can link and answer `initialize` and still
// be broken on a platform whose C toolchain miscompiled the parser. A schema
// with a syntax error must come back with at least one diagnostic.
//
// Order matters: tower-lsp silently drops anything sent before the
// `initialize` *response* arrives, so every step waits for the previous one.

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

const [binary, ...flags] = process.argv.slice(2);
if (!binary) {
  console.error("usage: smoke-lsp.mjs <path/to/comline-lsp> [--arch-x86_64]");
  process.exit(2);
}

const TIMEOUT_MS = 10_000;
const BROKEN = "struct Broken {\n    field: u32\n"; // unclosed `{`
const uri = pathToFileURL(path.resolve("smoke.ids")).href;

// `--arch-x86_64` runs an x86_64 macOS binary under Rosetta on an arm64 runner.
const [cmd, args] = flags.includes("--arch-x86_64")
  ? ["arch", ["-x86_64", binary]]
  : [binary, []];
const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] });

const fail = (why) => {
  console.error(`smoke-lsp: FAIL — ${why}`);
  child.kill();
  process.exit(1);
};
child.on("error", (e) => fail(`could not start ${binary}: ${e.message}`));
// Dying before `exit` is a failure, not a hang or an unhandled EPIPE.
let expectingExit = false;
child.on("exit", (code, signal) => {
  if (!expectingExit) fail(`exited early (${signal ?? `code ${code}`})`);
});
child.stdin.on("error", (e) => {
  if (!expectingExit) fail(`stdin closed early: ${e.message}`);
});

// ── framing ────────────────────────────────────────────────────────────────

const send = (msg) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...msg }));
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
};

let buf = Buffer.alloc(0);
const waiters = [];
child.stdout.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf("\r\n\r\n");
    if (sep < 0) return;
    const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, sep).toString())?.[1]);
    if (buf.length < sep + 4 + len) return;
    const msg = JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString());
    buf = buf.subarray(sep + 4 + len);
    for (const w of [...waiters]) {
      if (w.match(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  }
});

const waitFor = (what, match) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => fail(`no ${what} within ${TIMEOUT_MS / 1000}s`), TIMEOUT_MS);
    waiters.push({
      match,
      resolve: (m) => {
        clearTimeout(timer);
        resolve(m);
      },
    });
  });

// ── the probe ──────────────────────────────────────────────────────────────

const init = waitFor("initialize response", (m) => m.id === 1);
send({
  id: 1,
  method: "initialize",
  params: { processId: process.pid, rootUri: null, capabilities: {} },
});
const { result } = await init;
if (!result?.capabilities) fail("initialize returned no capabilities");

const diags = waitFor(
  "diagnostics for the broken schema",
  (m) => m.method === "textDocument/publishDiagnostics" && m.params?.uri === uri,
);
send({ method: "initialized", params: {} });
send({
  method: "textDocument/didOpen",
  params: { textDocument: { uri, languageId: "comline", version: 1, text: BROKEN } },
});
const { params } = await diags;
if (!params.diagnostics.length) fail("a schema with an unclosed `{` produced no diagnostics");

const shutdown = waitFor("shutdown response", (m) => m.id === 2);
send({ id: 2, method: "shutdown", params: null });
await shutdown;
expectingExit = true;
const exited = new Promise((resolve) => child.on("exit", resolve));
send({ method: "exit", params: null });
// Close the pipe, as an editor does. The server's stdin reader is a blocking
// thread that only returns at EOF, so the process cannot exit until it sees one.
child.stdin.end();

const timer = setTimeout(() => fail(`did not exit within ${TIMEOUT_MS / 1000}s of \`exit\``), TIMEOUT_MS);
const code = await exited;
clearTimeout(timer);
if (code !== 0) fail(`exited with ${code} after shutdown`);

console.log(
  `smoke-lsp: ok — initialize, ${params.diagnostics.length} diagnostic(s) for a broken schema, clean exit`,
);
