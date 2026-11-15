// Where the language server and the CLI are, and how to run them.
//
// Pure on purpose: nothing here imports `vscode` or touches the disk except
// through the `Probe` it is handed, so `resolve.test.ts` can run it under
// `node --test` with a fake file system, environment and platform.
//
// The modes (`comline.server.mode`, `comline.cli.mode`):
//
//   bundled  the server shipped in the extension (server only)
//   path     the program's name, looked up on PATH (the editor's own PATH:
//            inside a Flatpak that is the sandbox's, which cannot see the
//            host's programs, so there it runs on the host instead)
//   custom   the path in `<tool>.customPath`
//   host     the program on the host system, through `flatpak-spawn --host`
//            when the editor runs in a Flatpak; outside one, the host is
//            this machine and it is `path`/`custom` resolution

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type Tool = 'server' | 'cli';
export type Mode = 'bundled' | 'path' | 'custom' | 'host';

interface ToolInfo {
  /** What the messages call it. */
  label: string;
  /** The program's name. */
  name: string;
  /** The settings' prefix: `<prefix>.mode`, `<prefix>.customPath`. */
  prefix: string;
  install: string;
  modes: Mode[];
  defaultMode: Mode;
}

export const TOOLS: Record<Tool, ToolInfo> = {
  server: {
    label: 'language server',
    name: 'comline-lsp',
    prefix: 'comline.server',
    install: 'cargo install --git https://github.com/ComlineProject/language-server',
    modes: ['bundled', 'path', 'custom', 'host'],
    defaultMode: 'bundled',
  },
  cli: {
    label: 'CLI',
    name: 'comline',
    prefix: 'comline.cli',
    install: 'cargo install --git https://github.com/ComlineProject/cli',
    modes: ['path', 'custom', 'host'],
    defaultMode: 'path',
  },
};

export const FLATPAK_SPAWN = 'flatpak-spawn';

/** What the resolution reads from the outside world. */
export interface Probe {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** A file that exists and can be run: executable on POSIX, a file on Windows. */
  isExecutable(file: string): boolean;
  /** Anything exists at this path. */
  exists(file: string): boolean;
}

/** What the resolution reads from this machine: the real file system and
 * environment. The extension and the Flatpak end-to-end test
 * (`scripts/flatpak-e2e.cjs`) both use this one. */
export function systemProbe(): Probe {
  return {
    platform: process.platform,
    env: process.env,
    exists: (file) => fs.existsSync(file),
    isExecutable: (file) => {
      try {
        if (!fs.statSync(file).isFile()) {
          return false;
        }
        if (process.platform !== 'win32') {
          fs.accessSync(file, fs.constants.X_OK);
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}

// -- PATH ---------------------------------------------------------------

function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** A variable by name; Windows environment names are case-insensitive (`Path`). */
function envVar(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') {
    return env[name];
  }
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/** The directories of PATH, in order. Empty entries are dropped: POSIX reads
 * one as the current directory, which is not where a program should be
 * found from. */
export function pathDirectories(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const raw = envVar(env, 'PATH', platform) ?? '';
  const separator = platform === 'win32' ? ';' : ':';
  return raw
    .split(separator)
    .map((dir) => (platform === 'win32' ? dir.trim().replace(/^"(.*)"$/, '$1') : dir))
    .filter((dir) => dir !== '');
}

/** The suffixes that make a Windows file runnable (`PATHEXT`); POSIX has none. */
export function pathExtensions(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') {
    return [''];
  }
  const raw = envVar(env, 'PATHEXT', platform);
  const list = raw && raw.trim() !== '' ? raw : '.COM;.EXE;.BAT;.CMD';
  return list
    .split(';')
    .map((ext) => ext.trim())
    .filter((ext) => ext !== '');
}

function hasSeparator(name: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? /[\\/]/.test(name) : name.includes('/');
}

export interface Found {
  /** The program's path, or undefined when it isn't there. */
  found: string | undefined;
  /** The directories looked in (empty for a name that is already a path). */
  searched: string[];
}

/** A bare name against PATH (with `PATHEXT` on Windows); a name with a
 * directory in it is a path and is only checked to exist. */
export function resolveExecutable(name: string, probe: Probe): Found {
  const { platform, env } = probe;
  if (hasSeparator(name, platform)) {
    return { found: probe.exists(name) ? name : undefined, searched: [] };
  }
  const api = pathApi(platform);
  const extensions = pathExtensions(env, platform);
  const lower = name.toLowerCase();
  const candidates =
    platform === 'win32'
      ? [
          ...(extensions.some((ext) => lower.endsWith(ext.toLowerCase())) ? [name] : []),
          ...extensions.map((ext) => name + ext),
        ]
      : [name];
  const searched = pathDirectories(env, platform);
  for (const dir of searched) {
    for (const candidate of candidates) {
      const file = api.join(dir, candidate);
      if (probe.isExecutable(file)) {
        return { found: file, searched };
      }
    }
  }
  return { found: undefined, searched };
}

// -- Flatpak ------------------------------------------------------------

/** Whether this process runs in a Flatpak sandbox. Flatpak sets `FLATPAK_ID`
 * to the app's id and mounts the instance's metadata at `/.flatpak-info`
 * (https://docs.flatpak.org/en/latest/flatpak-command-reference.html#flatpak-run,
 * https://docs.flatpak.org/en/latest/flatpak-command-reference.html#flatpak-metadata);
 * either one says so. */
export function insideFlatpak(probe: Probe): boolean {
  if (probe.platform !== 'linux') {
    return false;
  }
  return (probe.env.FLATPAK_ID ?? '') !== '' || probe.exists('/.flatpak-info');
}

// -- The mode -----------------------------------------------------------

export interface EffectiveMode {
  mode: Mode;
  /** Something to tell the user about how the setting was read. */
  notice?: string;
}

/** The mode a setting asks for: an unknown value is the default; `custom`
 * with no path falls back (the bundled server, or `path` for the CLI). */
export function effectiveMode(tool: Tool, mode: string, customPath: string): EffectiveMode {
  const info = TOOLS[tool];
  const asked = (info.modes as string[]).includes(mode) ? (mode as Mode) : info.defaultMode;
  if (asked === 'custom' && customPath.trim() === '') {
    return tool === 'server'
      ? { mode: 'bundled', notice: 'Comline: Custom server path is not configured. Fallback to bundled server.' }
      : { mode: 'path' };
  }
  return { mode: asked };
}

// -- The plan -----------------------------------------------------------

export type Plan =
  /** Run this file as it is. */
  | { kind: 'direct'; command: string }
  /** Run `program` on the host: `spawn` (flatpak-spawn) with `--host`.
   * `found` is where the host check (`verifyPlan`) found it. */
  | { kind: 'host'; spawn: string; program: string; found?: string }
  | { kind: 'error'; message: string };

export interface PlanInput {
  tool: Tool;
  /** `<prefix>.mode` as read. */
  mode: string;
  /** `<prefix>.customPath` as read. */
  customPath: string;
  /** The bundled server's path, null when it isn't in the extension. */
  bundled?: string | null;
}

const RESERVED = '/usr, /etc, /bin and /lib';

function delimiterFor(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':';
}

function notOnPath(tool: Tool, searched: string[], platform: NodeJS.Platform): string {
  const { label, name, prefix, install } = TOOLS[tool];
  const where = searched.length > 0 ? searched.join(delimiterFor(platform)) : '(PATH is empty)';
  const alternatives =
    tool === 'server'
      ? `set ${prefix}.mode to 'bundled', or 'custom' with ${prefix}.customPath`
      : `set ${prefix}.mode to 'custom' with ${prefix}.customPath`;
  return (
    `Comline: the ${label} '${name}' was not found on PATH. Searched: ${where}. ` +
    `Install it (${install}) and make sure the editor sees it: an editor started from ` +
    `a launcher has a different PATH than your shell. Or ${alternatives}.`
  );
}

function notAtCustomPath(tool: Tool, customPath: string, inFlatpak: boolean): string {
  const { label, prefix } = TOOLS[tool];
  return (
    `Comline: the ${label} was not found at '${customPath}' (${prefix}.customPath). ` +
    'Check the setting: it is used as written, so `~` is not expanded.' +
    (inFlatpak
      ? ` The editor runs in a Flatpak sandbox, which cannot see the host's ${RESERVED} ` +
        `(a --filesystem permission for them has no effect): a program installed there ` +
        `cannot be reached by a path. Set ${prefix}.mode to 'host' to run it on the host.`
      : '')
  );
}

function noFlatpakSpawn(tool: Tool, searched: string[], platform: NodeJS.Platform): string {
  const { label, prefix } = TOOLS[tool];
  const alternatives =
    tool === 'server'
      ? `'bundled', or 'custom' with a path the sandbox can read`
      : `'custom' with a path the sandbox can read`;
  return (
    `Comline: running the ${label} on the host needs '${FLATPAK_SPAWN}', and it was not found ` +
    `in the sandbox (searched: ${searched.join(delimiterFor(platform)) || '(PATH is empty)'}). ` +
    `Set ${prefix}.mode to ${alternatives}.`
  );
}

/** What to run for a tool, given its settings and the world around it. Does
 * not run anything: a `host` plan still has to be checked against the host
 * (`hostProbeArgs`, `interpretHostProbe`). */
export function planProgram(input: PlanInput, probe: Probe): Plan {
  const info = TOOLS[input.tool];
  const customPath = input.customPath.trim();
  const { mode } = effectiveMode(input.tool, input.mode, customPath);
  const inFlatpak = insideFlatpak(probe);

  const onHost = (program: string): Plan => {
    if (!inFlatpak) {
      // No sandbox in the way: the host is where the editor is.
      const { found, searched } = resolveExecutable(program, probe);
      if (found) {
        return { kind: 'direct', command: found };
      }
      return {
        kind: 'error',
        message:
          searched.length > 0 || !hasSeparator(program, probe.platform)
            ? notOnPath(input.tool, searched, probe.platform)
            : notAtCustomPath(input.tool, program, false),
      };
    }
    const spawn = resolveExecutable(FLATPAK_SPAWN, probe);
    if (!spawn.found) {
      return { kind: 'error', message: noFlatpakSpawn(input.tool, spawn.searched, probe.platform) };
    }
    return { kind: 'host', spawn: spawn.found, program };
  };

  switch (mode) {
    case 'bundled':
      return input.bundled
        ? { kind: 'direct', command: input.bundled }
        : {
            kind: 'error',
            message:
              `Comline: the bundled ${info.label} is not in this installation. Set ` +
              `${info.prefix}.mode to 'path', 'custom' or 'host', or install the extension ` +
              `package for your platform.`,
          };

    case 'custom': {
      const { found, searched } = resolveExecutable(customPath, probe);
      if (found) {
        return { kind: 'direct', command: found };
      }
      return {
        kind: 'error',
        message: hasSeparator(customPath, probe.platform)
          ? notAtCustomPath(input.tool, customPath, inFlatpak)
          : notOnPath(input.tool, searched, probe.platform),
      };
    }

    case 'host':
      // `customPath`, when set, is the program's path on the host: the host's
      // PATH is the session's, not a shell's, so `~/.cargo/bin` is often not
      // on it.
      return onHost(customPath || info.name);

    case 'path':
    default:
      // In a Flatpak the sandbox's PATH is not the host's, so a name can only
      // mean the host's; elsewhere `onHost` is the PATH lookup.
      return onHost(info.name);
  }
}

// -- Running a plan -----------------------------------------------------

export interface Launch {
  command: string;
  args: string[];
  /** The environment for the process, when it isn't the editor's own. */
  env: Record<string, string> | undefined;
}

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/** The command line for a plan. `extraEnv` is what the program needs on top
 * of the editor's environment (`RUST_LOG`, `CLICOLOR_FORCE`): set on the
 * process when it runs here, and as `--env=` for the host, which does not get
 * the sandbox's environment. `watchBus` makes the host process exit when
 * `flatpak-spawn` does, so a long-running server doesn't outlive the editor. */
export function launchFor(
  plan: Exclude<Plan, { kind: 'error' }>,
  args: string[],
  extraEnv: Record<string, string>,
  baseEnv: NodeJS.ProcessEnv,
  options: { watchBus?: boolean } = {}
): Launch {
  if (plan.kind === 'direct') {
    return {
      command: plan.command,
      args,
      env: Object.keys(extraEnv).length > 0 ? { ...definedEnv(baseEnv), ...extraEnv } : undefined,
    };
  }
  return {
    command: plan.spawn,
    args: [
      '--host',
      ...(options.watchBus ? ['--watch-bus'] : []),
      ...Object.entries(extraEnv).map(([key, value]) => `--env=${key}=${value}`),
      plan.program,
      ...args,
    ],
    env: undefined,
  };
}

// -- Checking the host --------------------------------------------------

/** `flatpak-spawn` arguments that ask the host's shell where `program` is:
 * `command -v` prints the path of an executable, by name or by path, and
 * nothing when there is none. */
export function hostProbeArgs(program: string): string[] {
  return ['--host', 'sh', '-c', 'command -v "$1"', 'sh', program];
}

export type HostProbe =
  /** `found`: the program's path on the host, as `command -v` printed it. */
  | { ok: true; found: string }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'failed'; detail: string };

/** What `hostProbeArgs`' run says. A nonzero exit with nothing on stderr is
 * `command -v` finding nothing; anything on stderr is `flatpak-spawn` itself
 * failing (no permission to talk to `org.freedesktop.Flatpak`, no session
 * helper), and is passed on. */
export function interpretHostProbe(result: {
  exitCode: number | string | null | undefined;
  stdout: string;
  stderr: string;
}): HostProbe {
  const stderr = result.stderr.trim();
  if (result.exitCode === 0) {
    const found = result.stdout.trim().split('\n')[0];
    return found !== '' ? { ok: true, found } : { ok: false, reason: 'missing' };
  }
  if (typeof result.exitCode === 'number' && stderr === '') {
    return { ok: false, reason: 'missing' };
  }
  return { ok: false, reason: 'failed', detail: stderr || String(result.exitCode ?? 'no exit status') };
}

export function hostProbeMessage(tool: Tool, program: string, probe: HostProbe, appId?: string): string {
  const { label, prefix, install } = TOOLS[tool];
  if (probe.ok) {
    return '';
  }
  if (probe.reason === 'missing') {
    return (
      `Comline: '${program}' was not found on the host. Install the ${label} there (${install}) ` +
      `so it is on the host's PATH, or set ${prefix}.customPath to its absolute path on the host ` +
      `(the host command runs with your session's PATH, which may not include ~/.cargo/bin).` +
      (tool === 'server' ? ` Or set ${prefix}.mode to 'bundled'.` : '')
    );
  }
  return (
    `Comline: '${FLATPAK_SPAWN} --host' failed: ${probe.detail}. Running on the host needs the ` +
    `editor to be allowed to talk to org.freedesktop.Flatpak (Flatpak's own VSCodium and VS Code ` +
    `have it; \`flatpak override --user --talk-name=org.freedesktop.Flatpak ${appId ?? '<app id>'}\` ` +
    `grants it).`
  );
}

/** A plan, checked against the world: a `host` plan has to find the program
 * on the host (and `flatpak-spawn` has to be allowed to reach it) before it is
 * worth running; any other plan is returned as it is. Never throws: what went
 * wrong is the `error` plan's message. */
export async function verifyPlan(
  tool: Tool,
  plan: Plan,
  env: NodeJS.ProcessEnv = process.env
): Promise<Plan> {
  if (plan.kind !== 'host') {
    return plan;
  }
  let result: HostProbe;
  try {
    const { stdout, stderr } = await execFileAsync(plan.spawn, hostProbeArgs(plan.program), {
      timeout: 10000,
      env,
    });
    result = interpretHostProbe({ exitCode: 0, stdout, stderr });
  } catch (err) {
    const e = err as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string; message?: string };
    result = interpretHostProbe({
      exitCode: e.killed ? 'timed out' : e.code,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? (e.code === undefined ? String(e.message ?? err) : ''),
    });
  }
  if (result.ok) {
    return { ...plan, found: result.found };
  }
  return { kind: 'error', message: hostProbeMessage(tool, plan.program, result, env.FLATPAK_ID) };
}

// -- Saying where it runs -----------------------------------------------

/** Where a plan runs the program, for the status bar's tooltip:
 * `/path/to/comline-lsp (bundled)`, `... (PATH)`, `... (custom path)`, or
 * `... (on the host)` for a host plan, with the path the host check found.
 * Undefined for an error plan. */
export function planLocation(plan: Plan, mode: Mode): string | undefined {
  switch (plan.kind) {
    case 'direct':
      return `${plan.command} (${mode === 'path' ? 'PATH' : mode === 'custom' ? 'custom path' : mode})`;
    case 'host':
      return `${plan.found ?? plan.program} (on the host)`;
    case 'error':
      return undefined;
  }
}
