// Which `comline-core` the language server and the CLI were built with.
//
// The server's checks and grammar come from the core it links, and so do the
// CLI's: when they are different commits, a file can be fine for one and an
// error for the other (a bundled server that predates a grammar change says
// "unexpected token" about a file `comline generation` builds). Both report
// the commit, the server in `serverInfo.version` of its `initialize` result
// and `comline-lsp --version`, the CLI in `comline --version`.
//
// Pure on purpose, like `resolve.ts`: `coreRev.test.ts` runs it under
// `node --test`.

const SHA = '[0-9a-f]{40}';

/** The core commit in a server's `serverInfo.version`, `0.1.0 (core <sha>)`.
 * Undefined for a server that doesn't say, or says `unknown`. */
export function serverCoreRev(version: string | undefined): string | undefined {
  return new RegExp(`\\(core (${SHA})\\)\\s*$`).exec(version ?? '')?.[1];
}

/** The core commit in `comline --version`, its `core-rev: <sha>` line.
 * Undefined for a CLI that predates the line, or says `unknown`. */
export function cliCoreRev(output: string): string | undefined {
  return new RegExp(`^core-rev: (${SHA})\\s*$`, 'm').exec(output)?.[1];
}

export interface CoreRevs {
  server: string;
  cli: string;
}

/** The two commits when both are known and differ; undefined otherwise, which
 * is also what an unknown one is: with half the answer there is nothing to
 * warn about. */
export function coreRevMismatch(
  serverVersion: string | undefined,
  cliVersionOutput: string | undefined
): CoreRevs | undefined {
  const server = serverCoreRev(serverVersion);
  const cli = cliCoreRev(cliVersionOutput ?? '');
  return server !== undefined && cli !== undefined && server !== cli ? { server, cli } : undefined;
}

const short = (rev: string): string => rev.slice(0, 7);

export function mismatchMessage({ server, cli }: CoreRevs): string {
  return (
    `Comline: the language server was built with core ${short(server)}, the CLI with core ` +
    `${short(cli)}; diagnostics may differ from what \`comline generation\` reports.`
  );
}
