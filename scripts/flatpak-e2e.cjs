'use strict';
// The extension's program resolution, run inside Flathub's real VSCodium
// sandbox, against a real `flatpak-spawn --host`.
//
//   flatpak run --command=/app/share/codium/com.vscodium.codium \
//     --env=ELECTRON_RUN_AS_NODE=1 com.vscodium.codium \
//     scripts/flatpak-e2e.cjs <config.json>
//
// Run by .github/workflows/flatpak.yml (see there for how the sandbox, the
// session bus and the host's programs are set up). Not a unit test: it needs a
// Flatpak sandbox with `--talk-name=org.freedesktop.Flatpak`, which is what it
// proves the extension works in. The unit tests (`yarn test`) cover the same
// logic with a fake machine; this covers the machine.
//
// It imports the compiled `out/resolve.js`, the very module the extension
// loads, and uses `systemProbe()` (the real file system and environment), so
// it sees the sandbox exactly as the extension does. Nothing here re-implements
// what the extension decides; each scenario asks the extension's code what to
// run, runs that, and checks what happened, on the host as well as in here.
//
// Config (JSON): repo, bundledLsp, hostLspUsr, hostLspHome, package, appId.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const r = require(path.join(config.repo, 'out', 'resolve.js'));
const probe = r.systemProbe();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no ${what} within ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// -- The host, through the same door the extension uses -----------------

const spawnPath = r.resolveExecutable(r.FLATPAK_SPAWN, probe).found;

/** A shell script on the host, with positional arguments. */
async function onHost(script, ...args) {
  assert.ok(spawnPath, 'flatpak-spawn is not in the sandbox');
  const { stdout } = await execFileAsync(spawnPath, ['--host', 'sh', '-c', script, 'sh', ...args], {
    timeout: 20000,
  });
  return stdout;
}

async function hostServerPids() {
  const out = await onHost('pgrep -x comline-lsp || true');
  return out.split('\n').filter((line) => line.trim() !== '');
}

async function waitForNoHostServer(what) {
  const deadline = Date.now() + 15000;
  for (;;) {
    const pids = await hostServerPids();
    if (pids.length === 0) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`${what}: host comline-lsp still running (pid ${pids.join(', ')}) after 15s`);
    }
    await sleep(250);
  }
}

// -- A language client, just enough of one ------------------------------

function startServer(launch, options = {}) {
  const child = spawn(launch.command, launch.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: launch.env,
    ...options,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const spawnFailed = new Promise((_, reject) => child.on('error', reject));
  spawnFailed.catch(() => {});

  let buf = Buffer.alloc(0);
  const waiters = [];
  child.stdout.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const sep = buf.indexOf('\r\n\r\n');
      if (sep < 0) {
        return;
      }
      const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, sep).toString())?.[1]);
      if (buf.length < sep + 4 + len) {
        return;
      }
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
  child.stdin.on('error', () => {});

  const send = (msg) => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg }));
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    child.stdin.write(body);
  };
  const waitFor = (what, match) =>
    withTimeout(
      Promise.race([
        new Promise((resolve) => waiters.push({ match, resolve })),
        spawnFailed,
        exited.then((e) => {
          throw new Error(`exited early (${e.signal ?? `code ${e.code}`}); stderr: ${stderr.trim()}`);
        }),
      ]),
      20000,
      what
    );

  return {
    child,
    exited,
    stderr: () => stderr,
    /** `initialize` as an editor sends it; resolves with the result. */
    async initialize() {
      const response = waitFor('initialize response', (m) => m.id === 1);
      send({
        id: 1,
        method: 'initialize',
        params: { processId: process.pid, rootUri: null, capabilities: {} },
      });
      const { result, error } = await response;
      assert.ok(!error, `initialize failed: ${JSON.stringify(error)}`);
      assert.ok(result && result.capabilities, 'initialize returned no capabilities');
      send({ method: 'initialized', params: {} });
      return result;
    },
    /** `shutdown`, `exit`, and the pipe closed, as an editor stops a server. */
    async stop() {
      const response = waitFor('shutdown response', (m) => m.id === 2);
      send({ id: 2, method: 'shutdown', params: null });
      await response;
      send({ method: 'exit', params: null });
      child.stdin.end();
      return withTimeout(exited, 20000, 'exit after `exit`');
    },
  };
}

/** A server as the extension would start it: its plan, checked, launched. */
async function startAsExtension(settings, { debug = false } = {}) {
  const planned = r.planProgram({ tool: 'server', bundled: null, customPath: '', ...settings }, probe);
  const plan = await r.verifyPlan('server', planned);
  assert.notEqual(plan.kind, 'error', plan.message);
  const launch = r.launchFor(plan, [], debug ? { RUST_LOG: 'debug' } : {}, process.env, {
    watchBus: true,
  });
  // The extension runs a host server in the home directory (extension.ts).
  const options = plan.kind === 'host' ? { cwd: os.homedir() } : {};
  return { plan, launch, server: startServer(launch, options) };
}

/** What the host process is: its binary and whether it got RUST_LOG. */
async function describeHostServer() {
  const pids = await hostServerPids();
  assert.equal(pids.length, 1, `expected one host comline-lsp, found ${pids.length}`);
  const exe = (await onHost('readlink -f /proc/$1/exe', pids[0])).trim();
  const environ = await onHost('tr "\\0" "\\n" < /proc/$1/environ', pids[0]);
  const rustLog = environ.split('\n').find((line) => line.startsWith('RUST_LOG='));
  return { pid: pids[0], exe, rustLog };
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

// -- The scenarios ------------------------------------------------------

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('this is the Flathub VSCodium sandbox, and the host is reachable', async () => {
  assert.equal(r.insideFlatpak(probe), true, 'insideFlatpak() is false in the sandbox');
  assert.equal(process.env.FLATPAK_ID, config.appId);
  assert.ok(fs.existsSync('/.flatpak-info'), '/.flatpak-info is missing');
  assert.ok(spawnPath, 'flatpak-spawn is not on the sandbox PATH');
  // The host is another machine's worth of file system: its /usr/local is
  // not the sandbox's.
  assert.equal(fs.existsSync(config.hostLspUsr), false, `${config.hostLspUsr} is visible in the sandbox`);
  await onHost('test -x "$1"', config.hostLspUsr);
});

scenario('1. bundled: the static comline-lsp runs in the sandbox and answers initialize', async () => {
  const { plan, server } = await startAsExtension({ mode: 'bundled', bundled: config.bundledLsp });
  assert.deepEqual(plan, { kind: 'direct', command: config.bundledLsp });
  try {
    const result = await server.initialize();
    assert.ok(result.capabilities.textDocumentSync !== undefined, 'no textDocumentSync capability');
    const { code } = await server.stop();
    assert.equal(code, 0);
  } finally {
    server.child.kill('SIGKILL');
  }
});

scenario('2a. host, by name: runs on the host, RUST_LOG reaches it, a clean stop ends it', async () => {
  await waitForNoHostServer('before');
  const { plan, launch, server } = await startAsExtension({ mode: 'host' }, { debug: true });
  try {
    assert.equal(plan.kind, 'host');
    assert.equal(plan.program, 'comline-lsp');
    assert.deepEqual(launch.args.slice(0, 3), ['--host', '--watch-bus', '--env=RUST_LOG=debug']);
    await server.initialize();
    const host = await describeHostServer();
    assert.equal(host.exe, config.hostLspUsr, 'the host server is not the host binary');
    assert.equal(host.rustLog, 'RUST_LOG=debug', 'RUST_LOG did not reach the host process');
    const { code } = await server.stop();
    assert.equal(code, 0);
  } finally {
    server.child.kill('SIGKILL');
  }
  await waitForNoHostServer('after a clean stop');
});

scenario('2b. host, customPath under the host-only /usr: runs, and no RUST_LOG when not debugging', async () => {
  await waitForNoHostServer('before');
  const { plan, server } = await startAsExtension({ mode: 'host', customPath: config.hostLspUsr });
  try {
    assert.equal(plan.kind, 'host');
    assert.equal(plan.program, config.hostLspUsr);
    await server.initialize();
    const host = await describeHostServer();
    assert.equal(host.exe, config.hostLspUsr);
    assert.equal(host.rustLog, undefined, `RUST_LOG is set without debug: ${host.rustLog}`);
    await server.stop();
  } finally {
    server.child.kill('SIGKILL');
  }
  await waitForNoHostServer('after');
});

scenario('2c. host, customPath in the home directory: killing flatpak-spawn stops the host server', async () => {
  await waitForNoHostServer('before');
  const { server } = await startAsExtension({ mode: 'host', customPath: config.hostLspHome });
  await server.initialize();
  const host = await describeHostServer();
  assert.equal(host.exe, fs.realpathSync(config.hostLspHome));
  // SIGKILL: flatpak-spawn can't forward it or clean up. Only --watch-bus,
  // the session helper noticing the bus connection close, can stop the server.
  server.child.kill('SIGKILL');
  await waitForNoHostServer('after killing flatpak-spawn');
});

scenario('2d. --watch-bus is what ends a host process when flatpak-spawn dies (with a control)', async () => {
  // comline-lsp also exits when its stdin closes, so 2c alone doesn't prove
  // --watch-bus. `sleep` doesn't read stdin: only the bus watch can end it.
  const plan = { kind: 'host', spawn: spawnPath, program: 'sleep' };
  const hostSleeps = async (seconds) =>
    (await onHost('pgrep -f "^sleep $1\\$" || true', String(seconds))).split('\n').filter((l) => l.trim());
  const waitFor = async (seconds, wanted, what) => {
    const deadline = Date.now() + 15000;
    for (;;) {
      if ((await hostSleeps(seconds)).length > 0 === wanted) {
        return;
      }
      assert.ok(Date.now() < deadline, `${what}: still ${wanted ? 'absent' : 'running'} after 15s`);
      await sleep(250);
    }
  };

  const watched = r.launchFor(plan, ['3141'], {}, process.env, { watchBus: true });
  const a = spawn(watched.command, watched.args, { stdio: ['pipe', 'ignore', 'ignore'] });
  await waitFor(3141, true, 'the watched sleep starting');
  a.kill('SIGKILL');
  await waitFor(3141, false, 'the watched sleep after killing flatpak-spawn');

  // The control: the same without --watch-bus is left running.
  const unwatched = r.launchFor(plan, ['3142'], {}, process.env, { watchBus: false });
  const b = spawn(unwatched.command, unwatched.args, { stdio: ['pipe', 'ignore', 'ignore'] });
  try {
    await waitFor(3142, true, 'the unwatched sleep starting');
    b.kill('SIGKILL');
    await sleep(3000);
    assert.equal((await hostSleeps(3142)).length, 1, 'without --watch-bus the host process should outlive flatpak-spawn');
  } finally {
    await onHost('pkill -f "^sleep 3142$" || true');
  }
});

scenario('3. host probe: ok, missing, and flatpak-spawn itself failing', async () => {
  const run = async (program, env = process.env) => {
    try {
      const { stdout, stderr } = await execFileAsync(spawnPath, r.hostProbeArgs(program), {
        timeout: 20000,
        env,
      });
      return r.interpretHostProbe({ exitCode: 0, stdout, stderr });
    } catch (e) {
      return r.interpretHostProbe({ exitCode: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' });
    }
  };
  assert.deepEqual(await run('comline-lsp'), { ok: true, found: config.hostLspUsr });
  assert.deepEqual(await run(config.hostLspHome), { ok: true, found: config.hostLspHome });
  assert.deepEqual(await run('comline-no-such-program'), { ok: false, reason: 'missing' });
  assert.deepEqual(await run('/no/such/dir/comline-lsp'), { ok: false, reason: 'missing' });
  // No session bus to talk to: flatpak-spawn fails, and says why.
  const failed = await run('comline-lsp', {
    ...process.env,
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent/bus',
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'failed', JSON.stringify(failed));
  assert.notEqual(failed.detail, '');

  // And what the extension shows for them.
  const missing = await r.verifyPlan(
    'server',
    r.planProgram({ tool: 'server', mode: 'host', customPath: '/no/such/dir/comline-lsp', bundled: null }, probe)
  );
  assert.equal(missing.kind, 'error');
  assert.match(missing.message, /was not found on the host/);
  assert.match(missing.message, /comline\.server\.customPath/);
});

scenario('4. path inside the sandbox is the host', async () => {
  for (const [tool, program] of [
    ['server', 'comline-lsp'],
    ['cli', 'comline'],
  ]) {
    const plan = r.planProgram({ tool, mode: 'path', customPath: '', bundled: null }, probe);
    assert.deepEqual(plan, { kind: 'host', spawn: spawnPath, program });
    const verified = await r.verifyPlan(tool, plan);
    assert.equal(verified.kind, 'host', `${program} is not on the host: ${verified.message}`);
    assert.deepEqual({ ...verified, found: undefined }, { ...plan, found: undefined });
    assert.ok(path.isAbsolute(verified.found), `found ${verified.found}`);
  }
});

scenario('5. custom path in the host-only /usr: an error that points at host mode', async () => {
  const plan = r.planProgram(
    { tool: 'server', mode: 'custom', customPath: config.hostLspUsr, bundled: null },
    probe
  );
  assert.equal(plan.kind, 'error');
  assert.match(plan.message, /comline\.server\.mode to 'host'/);
  assert.match(plan.message, /\/usr/);
  // The same file, by host mode, works (2b); here it is just out of reach.
  const cli = r.planProgram({ tool: 'cli', mode: 'custom', customPath: '/usr/bin/comline', bundled: null }, probe);
  assert.equal(cli.kind, 'error');
  assert.match(cli.message, /comline\.cli\.mode to 'host'/);
});

scenario('6. CLI in host mode: generation writes code on disk, generation clean removes it', async () => {
  const pkg = config.package;
  const generated = path.join(pkg, 'generated');
  fs.rmSync(generated, { recursive: true, force: true });

  for (const mode of ['path', 'host']) {
    const planned = r.planProgram({ tool: 'cli', mode, customPath: '', bundled: null }, probe);
    const plan = await r.verifyPlan('cli', planned);
    assert.equal(plan.kind, 'host', plan.message);

    // The launches runCliCommand and the status bar menu build.
    const run = (subcommand) => {
      const launch = r.launchFor(plan, ['--path', pkg, ...subcommand], { CLICOLOR_FORCE: '1' }, process.env);
      assert.equal(launch.env, undefined);
      return execFileAsync(launch.command, launch.args, { timeout: 120000 });
    };

    const listing = r.launchFor(plan, ['targets'], {}, process.env);
    const targets = await execFileAsync(listing.command, listing.args, { timeout: 60000 });
    assert.match(targets.stdout, /^\s*rust#/m, `comline targets: ${targets.stdout}`);

    await run(['generation']);
    const files = fs.existsSync(generated) ? walk(generated) : [];
    assert.ok(files.length > 0, `generation wrote nothing under ${generated}`);
    assert.ok(files.every((f) => fs.statSync(f).size > 0), 'a generated file is empty');

    await run(['generation', 'clean']);
    assert.equal(fs.existsSync(generated), false, 'generation clean left the output behind');
  }

  // The old names are gone: what #30 was about.
  const plan = r.planProgram({ tool: 'cli', mode: 'host', customPath: '', bundled: null }, probe);
  const old = r.launchFor(plan, ['--path', pkg, 'generate'], {}, process.env);
  await assert.rejects(execFileAsync(old.command, old.args, { timeout: 60000 }));
});

// -- Run ----------------------------------------------------------------

(async () => {
  let failed = 0;
  for (const { name, fn } of scenarios) {
    const started = Date.now();
    try {
      await withTimeout(fn(), 180000, `end of "${name}"`);
      console.log(`ok   ${name} (${Date.now() - started} ms)`);
    } catch (e) {
      failed += 1;
      console.log(`FAIL ${name}`);
      console.log(String(e && e.stack ? e.stack : e).replace(/^/gm, '     '));
      console.log(`::error title=Flatpak scenario failed::${name}: ${String(e && e.message).split('\n')[0]}`);
    }
  }
  const total = scenarios.length;
  console.log(`\n${total - failed}/${total} scenarios passed`);
  process.exit(failed === 0 ? 0 : 1);
})();
