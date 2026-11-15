// Run with `yarn test` (node's built-in runner, on the compiled output).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Probe,
  effectiveMode,
  hostProbeArgs,
  hostProbeMessage,
  insideFlatpak,
  interpretHostProbe,
  launchFor,
  pathDirectories,
  planLocation,
  planProgram,
  resolveExecutable,
} from './resolve';

/** A machine with these files (all executable) and this environment. */
function machine(
  platform: NodeJS.Platform,
  files: string[],
  env: NodeJS.ProcessEnv = {}
): Probe {
  const set = new Set(files);
  return {
    platform,
    env,
    exists: (file) => set.has(file),
    isExecutable: (file) => set.has(file),
  };
}

const linux = (files: string[], env: NodeJS.ProcessEnv = {}): Probe =>
  machine('linux', files, { PATH: '/usr/local/bin:/usr/bin', ...env });

// A Flatpak sandbox: the runtime's PATH, FLATPAK_ID, flatpak-spawn present.
const flatpak = (files: string[] = ['/usr/bin/flatpak-spawn'], env: NodeJS.ProcessEnv = {}): Probe =>
  machine('linux', files, { PATH: '/app/bin:/usr/bin', FLATPAK_ID: 'com.vscodium.codium', ...env });

// -- PATH ---------------------------------------------------------------

test('a name is found in the first PATH directory that has it', () => {
  const probe = linux(['/usr/bin/comline-lsp', '/usr/local/bin/comline-lsp']);
  assert.deepEqual(resolveExecutable('comline-lsp', probe), {
    found: '/usr/local/bin/comline-lsp',
    searched: ['/usr/local/bin', '/usr/bin'],
  });
});

test('a name that is nowhere reports the directories searched', () => {
  assert.deepEqual(resolveExecutable('comline-lsp', linux([])), {
    found: undefined,
    searched: ['/usr/local/bin', '/usr/bin'],
  });
});

test('the current directory is not on PATH just because a file is there', () => {
  // The old check was `fs.existsSync('comline-lsp')`, which reads the cwd.
  const probe = linux(['comline-lsp', './comline-lsp']);
  assert.equal(resolveExecutable('comline-lsp', probe).found, undefined);
});

test('empty PATH entries are dropped; an unset PATH is empty', () => {
  assert.deepEqual(pathDirectories({ PATH: '/a::/b:' }, 'linux'), ['/a', '/b']);
  assert.deepEqual(pathDirectories({}, 'linux'), []);
});

test('a name with a directory in it is a path: checked as written, not searched', () => {
  const probe = linux(['/opt/comline/comline-lsp']);
  assert.deepEqual(resolveExecutable('/opt/comline/comline-lsp', probe), {
    found: '/opt/comline/comline-lsp',
    searched: [],
  });
  assert.equal(resolveExecutable('/opt/missing/comline-lsp', probe).found, undefined);
});

test('Windows: PATHEXT supplies the extension, Path is case-insensitive', () => {
  const probe = machine('win32', ['C:\\tools\\comline-lsp.exe'], {
    Path: 'C:\\Windows;"C:\\tools"',
    PATHEXT: '.com;.exe;.bat',
  });
  assert.deepEqual(resolveExecutable('comline-lsp', probe), {
    found: 'C:\\tools\\comline-lsp.exe',
    searched: ['C:\\Windows', 'C:\\tools'],
  });
});

test('Windows: extensions are tried in PATHEXT order, a bare file without one is not a program', () => {
  const both = machine('win32', ['C:\\t\\comline.bat', 'C:\\t\\comline.exe'], {
    PATH: 'C:\\t',
    PATHEXT: '.exe;.bat',
  });
  assert.equal(resolveExecutable('comline', both).found, 'C:\\t\\comline.exe');
  const bare = machine('win32', ['C:\\t\\comline'], { PATH: 'C:\\t' });
  assert.equal(resolveExecutable('comline', bare).found, undefined);
});

test('Windows: a name that already has a PATHEXT extension is tried as it is', () => {
  const probe = machine('win32', ['C:\\t\\comline-lsp.exe'], { PATH: 'C:\\t' });
  assert.equal(resolveExecutable('comline-lsp.exe', probe).found, 'C:\\t\\comline-lsp.exe');
});

test('Windows: PATHEXT defaults when unset', () => {
  const probe = machine('win32', ['C:\\t\\comline.CMD'], { PATH: 'C:\\t' });
  assert.equal(resolveExecutable('comline', probe).found, 'C:\\t\\comline.CMD');
});

// -- Flatpak ------------------------------------------------------------

test('Flatpak is detected by FLATPAK_ID or by /.flatpak-info, on Linux only', () => {
  assert.equal(insideFlatpak(linux([], { FLATPAK_ID: 'com.vscodium.codium' })), true);
  assert.equal(insideFlatpak(linux(['/.flatpak-info'])), true);
  assert.equal(insideFlatpak(linux([])), false);
  assert.equal(insideFlatpak(linux([], { FLATPAK_ID: '' })), false);
  assert.equal(insideFlatpak(machine('win32', ['/.flatpak-info'], { FLATPAK_ID: 'x' })), false);
  assert.equal(insideFlatpak(machine('darwin', [], { FLATPAK_ID: 'x' })), false);
});

// -- The mode -----------------------------------------------------------

test('an unknown mode is the tool\'s default; the CLI has no bundled mode', () => {
  assert.equal(effectiveMode('server', 'nonsense', '').mode, 'bundled');
  assert.equal(effectiveMode('cli', 'nonsense', '').mode, 'path');
  assert.equal(effectiveMode('cli', 'bundled', '').mode, 'path');
  assert.equal(effectiveMode('server', 'host', '').mode, 'host');
  assert.equal(effectiveMode('cli', 'host', '').mode, 'host');
});

test('custom without a path falls back: bundled for the server (with a notice), path for the CLI', () => {
  const server = effectiveMode('server', 'custom', '  ');
  assert.equal(server.mode, 'bundled');
  assert.match(server.notice ?? '', /Custom server path is not configured/);
  assert.deepEqual(effectiveMode('cli', 'custom', ''), { mode: 'path' });
});

// -- Plans --------------------------------------------------------------

const server = (mode: string, customPath = '', bundled: string | null = '/ext/bin/comline-lsp') => ({
  tool: 'server' as const,
  mode,
  customPath,
  bundled,
});
const cli = (mode: string, customPath = '') => ({ tool: 'cli' as const, mode, customPath });

test('bundled runs the bundled binary, and says so when there is none', () => {
  assert.deepEqual(planProgram(server('bundled'), linux([])), {
    kind: 'direct',
    command: '/ext/bin/comline-lsp',
  });
  const plan = planProgram(server('bundled', '', null), linux([]));
  assert.equal(plan.kind, 'error');
});

test('bundled stays bundled inside a Flatpak: the static binary runs in the sandbox', () => {
  assert.deepEqual(planProgram(server('bundled'), flatpak()), {
    kind: 'direct',
    command: '/ext/bin/comline-lsp',
  });
});

test('path finds the server on PATH (#29)', () => {
  assert.deepEqual(planProgram(server('path'), linux(['/usr/bin/comline-lsp'])), {
    kind: 'direct',
    command: '/usr/bin/comline-lsp',
  });
});

test('path that finds nothing names the PATH it searched', () => {
  const plan = planProgram(server('path'), linux([]));
  assert.equal(plan.kind, 'error');
  assert.match((plan as { message: string }).message, /'comline-lsp' was not found on PATH/);
  assert.match((plan as { message: string }).message, /\/usr\/local\/bin:\/usr\/bin/);
});

test('path for the CLI looks for comline', () => {
  assert.deepEqual(planProgram(cli('path'), linux(['/usr/local/bin/comline'])), {
    kind: 'direct',
    command: '/usr/local/bin/comline',
  });
});

test('path inside a Flatpak runs on the host through flatpak-spawn', () => {
  assert.deepEqual(planProgram(server('path'), flatpak()), {
    kind: 'host',
    spawn: '/usr/bin/flatpak-spawn',
    program: 'comline-lsp',
  });
  assert.deepEqual(planProgram(cli('path'), flatpak()), {
    kind: 'host',
    spawn: '/usr/bin/flatpak-spawn',
    program: 'comline',
  });
});

test('path inside a Flatpak without flatpak-spawn says so, and what to set instead', () => {
  const plan = planProgram(server('path'), flatpak([]));
  assert.equal(plan.kind, 'error');
  const message = (plan as { message: string }).message;
  assert.match(message, /flatpak-spawn/);
  assert.match(message, /comline\.server\.mode/);
});

test('host inside a Flatpak runs the name, or the custom path, on the host', () => {
  assert.deepEqual(planProgram(server('host'), flatpak()), {
    kind: 'host',
    spawn: '/usr/bin/flatpak-spawn',
    program: 'comline-lsp',
  });
  assert.deepEqual(planProgram(server('host', '/home/me/.cargo/bin/comline-lsp'), flatpak()), {
    kind: 'host',
    spawn: '/usr/bin/flatpak-spawn',
    program: '/home/me/.cargo/bin/comline-lsp',
  });
});

test('host outside a Flatpak is this machine: PATH, or the custom path', () => {
  assert.deepEqual(planProgram(cli('host'), linux(['/usr/bin/comline'])), {
    kind: 'direct',
    command: '/usr/bin/comline',
  });
  assert.deepEqual(planProgram(cli('host', '/opt/c/comline'), linux(['/opt/c/comline'])), {
    kind: 'direct',
    command: '/opt/c/comline',
  });
  assert.equal(planProgram(cli('host', '/opt/c/comline'), linux([])).kind, 'error');
});

test('custom runs the path as written', () => {
  assert.deepEqual(planProgram(server('custom', '/opt/c/comline-lsp'), linux(['/opt/c/comline-lsp'])), {
    kind: 'direct',
    command: '/opt/c/comline-lsp',
  });
});

test('custom that is not there says so; in a Flatpak it points at the reserved paths and host mode', () => {
  const outside = planProgram(server('custom', '/opt/c/comline-lsp'), linux([]));
  assert.equal(outside.kind, 'error');
  assert.doesNotMatch((outside as { message: string }).message, /host mode|'host'/);

  const inside = planProgram(server('custom', '/usr/bin/comline-lsp'), flatpak());
  assert.equal(inside.kind, 'error');
  const message = (inside as { message: string }).message;
  assert.match(message, /\/usr/);
  assert.match(message, /comline\.server\.mode to 'host'/);
});

test('custom with a bare name is looked up on PATH', () => {
  assert.deepEqual(planProgram(cli('custom', 'comline-dev'), linux(['/usr/bin/comline-dev'])), {
    kind: 'direct',
    command: '/usr/bin/comline-dev',
  });
});

test('custom with no path falls back to bundled (server) or path (CLI)', () => {
  assert.deepEqual(planProgram(server('custom'), linux([])), {
    kind: 'direct',
    command: '/ext/bin/comline-lsp',
  });
  assert.deepEqual(planProgram(cli('custom'), linux(['/usr/bin/comline'])), {
    kind: 'direct',
    command: '/usr/bin/comline',
  });
});

// -- Command lines ------------------------------------------------------

test('a direct launch is the command, with the environment extended only when asked', () => {
  const plan = { kind: 'direct' as const, command: '/usr/bin/comline-lsp' };
  assert.deepEqual(launchFor(plan, [], {}, { A: '1' }), {
    command: '/usr/bin/comline-lsp',
    args: [],
    env: undefined,
  });
  assert.deepEqual(launchFor(plan, [], { RUST_LOG: 'debug' }, { A: '1', B: undefined }), {
    command: '/usr/bin/comline-lsp',
    args: [],
    env: { A: '1', RUST_LOG: 'debug' },
  });
});

test('a host launch for the server: stdio stays piped, RUST_LOG goes through --env', () => {
  const plan = { kind: 'host' as const, spawn: '/usr/bin/flatpak-spawn', program: 'comline-lsp' };
  assert.deepEqual(launchFor(plan, [], { RUST_LOG: 'debug' }, { PATH: '/app/bin' }, { watchBus: true }), {
    command: '/usr/bin/flatpak-spawn',
    args: ['--host', '--watch-bus', '--env=RUST_LOG=debug', 'comline-lsp'],
    env: undefined,
  });
  assert.deepEqual(launchFor(plan, [], {}, {}, { watchBus: true }).args, [
    '--host',
    '--watch-bus',
    'comline-lsp',
  ]);
});

test('a host launch for the CLI passes its arguments after the program', () => {
  const plan = { kind: 'host' as const, spawn: 'flatpak-spawn', program: '/home/me/.cargo/bin/comline' };
  assert.deepEqual(
    launchFor(plan, ['--path', '/work/pkg', 'generation', 'clean'], { CLICOLOR_FORCE: '1' }, {}),
    {
      command: 'flatpak-spawn',
      args: [
        '--host',
        '--env=CLICOLOR_FORCE=1',
        '/home/me/.cargo/bin/comline',
        '--path',
        '/work/pkg',
        'generation',
        'clean',
      ],
      env: undefined,
    }
  );
});

// -- Checking the host --------------------------------------------------

test('the host probe asks the host\'s shell, with the program as a plain argument', () => {
  assert.deepEqual(hostProbeArgs('comline-lsp'), [
    '--host',
    'sh',
    '-c',
    'command -v "$1"',
    'sh',
    'comline-lsp',
  ]);
  // Never spliced into the script, so a path with spaces or quotes is inert.
  assert.equal(hostProbeArgs('/a b/"c"')[3], 'command -v "$1"');
});

test('the host probe: found, missing, or flatpak-spawn itself failing', () => {
  assert.deepEqual(interpretHostProbe({ exitCode: 0, stdout: '/usr/bin/comline-lsp\n', stderr: '' }), {
    ok: true,
    found: '/usr/bin/comline-lsp',
  });
  assert.deepEqual(interpretHostProbe({ exitCode: 1, stdout: '', stderr: '' }), {
    ok: false,
    reason: 'missing',
  });
  assert.deepEqual(interpretHostProbe({ exitCode: 127, stdout: '', stderr: '\n' }), {
    ok: false,
    reason: 'missing',
  });
  assert.deepEqual(interpretHostProbe({ exitCode: 0, stdout: '', stderr: '' }), {
    ok: false,
    reason: 'missing',
  });
  assert.deepEqual(
    interpretHostProbe({
      exitCode: 1,
      stdout: '',
      stderr: 'Portal call failed: org.freedesktop.DBus.Error.ServiceUnknown\n',
    }),
    {
      ok: false,
      reason: 'failed',
      detail: 'Portal call failed: org.freedesktop.DBus.Error.ServiceUnknown',
    }
  );
  assert.deepEqual(interpretHostProbe({ exitCode: 'ENOENT', stdout: '', stderr: '' }), {
    ok: false,
    reason: 'failed',
    detail: 'ENOENT',
  });
});

test('the host messages say what to install and which setting to change', () => {
  const missing = hostProbeMessage('server', 'comline-lsp', { ok: false, reason: 'missing' });
  assert.match(missing, /not found on the host/);
  assert.match(missing, /cargo install --git https:\/\/github\.com\/ComlineProject\/language-server/);
  assert.match(missing, /comline\.server\.customPath/);
  assert.match(missing, /comline\.server\.mode to 'bundled'/);

  const cliMissing = hostProbeMessage('cli', 'comline', { ok: false, reason: 'missing' });
  assert.match(cliMissing, /ComlineProject\/cli/);
  assert.doesNotMatch(cliMissing, /bundled/);

  const failed = hostProbeMessage(
    'server',
    'comline-lsp',
    { ok: false, reason: 'failed', detail: 'denied' },
    'com.vscodium.codium'
  );
  assert.match(failed, /denied/);
  assert.match(failed, /--talk-name=org\.freedesktop\.Flatpak com\.vscodium\.codium/);
});

test('where a plan runs, for the status bar', () => {
  assert.equal(
    planLocation({ kind: 'direct', command: '/ext/bin/linux-x64/comline-lsp' }, 'bundled'),
    '/ext/bin/linux-x64/comline-lsp (bundled)'
  );
  assert.equal(planLocation({ kind: 'direct', command: '/usr/bin/comline-lsp' }, 'path'), '/usr/bin/comline-lsp (PATH)');
  assert.equal(planLocation({ kind: 'direct', command: '/opt/comline-lsp' }, 'custom'), '/opt/comline-lsp (custom path)');
  const host = { kind: 'host' as const, spawn: '/usr/bin/flatpak-spawn', program: 'comline-lsp' };
  assert.equal(planLocation(host, 'path'), 'comline-lsp (on the host)');
  assert.equal(planLocation({ ...host, found: '/usr/bin/comline-lsp' }, 'path'), '/usr/bin/comline-lsp (on the host)');
  assert.equal(planLocation({ kind: 'error', message: 'no' }, 'path'), undefined);
});
