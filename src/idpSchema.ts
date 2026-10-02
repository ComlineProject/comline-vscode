// A hand-authored schema for `.idp` ("congregation" package config) plus the
// text-heuristic engine that resolves "what key-path is the cursor inside"
// against it. No `.idp` parser exists client-side (or in the language server
// at all — confirmed, see extension.ts), so this works off plain text
// scanning, in the same spirit as the language server's
// `completion.rs::determine_context` for `.ids`. That function only strips
// `//` line comments, which is correct only for `.ids` — `.idp` has `/* */`
// block comments too (confirmed in
// `core/core/src/package/config/idl/grammar.rs`), so this independently
// strips both, plus string contents, before any brace-depth counting or key
// search runs.
//
// The schema itself is authoritative against
// `core/core/src/package/config/ir/interpreter/freezing.rs` and
// `core/core/src/package/config/dependency.rs` — there is no serde/typed
// schema on the Rust side to introspect (it's a hand-written, string-key-
// switching interpreter that `panic!`s on anything it doesn't recognize), so
// this is a manual mirror, kept in sync by hand. `code_generation.languages`
// is the one dynamic exception: its keys are open `name#version` tokens
// validated only at `comline generate` time against the compiled-in
// generator registry — see `comline.cli.*` / `ensureTargetsLoaded` in
// extension.ts for how that list is fetched live instead of guessed here.

export type IdpValueKind =
  | { kind: 'integer' }
  | { kind: 'string' }
  | { kind: 'dictionary'; fields: IdpFieldSchema[] }
  // `code_generation.languages` specifically — dynamic `name#version` keys,
  // validated live against the configured `comline` CLI, not this schema.
  | { kind: 'registry' }
  // A dictionary whose keys are user-chosen names (a dependency name, a
  // publish-registry name) — `entry` describes the shape of each value.
  | { kind: 'map'; entry: IdpFieldSchema };

export interface IdpFieldSchema {
  key: string;
  /** One line, plain text (no markdown/backticks — rendered as a `//`
   * comment inside a colored code block) — shown when this field is listed
   * under its *parent's* hover, where the full `description` would be too
   * long to read at a glance. */
  summary: string;
  /** The full explanation, shown when this field is hovered directly. */
  description: string;
  value: IdpValueKind;
}

const DEPENDENCY_ENTRY_FIELDS: IdpFieldSchema[] = [
  {
    key: 'path',
    summary: 'Local path — makes this a Path dependency',
    description:
      'Local filesystem path to a sibling package — makes this a Path dependency (no declared ' +
      "version; its version is read from the sibling's own last build).",
    value: { kind: 'string' },
  },
  {
    key: 'version',
    summary: 'Declared version (Git/Registry dependencies)',
    description: 'Declared version. Required for Git and Registry dependencies (omit for Path dependencies).',
    value: { kind: 'string' },
  },
  {
    key: 'uri',
    summary: 'Source URI (Git/Registry dependencies)',
    description: 'Source URI. Required for Git and Registry dependencies.',
    value: { kind: 'string' },
  },
  {
    key: 'commit',
    summary: 'Pinned commit — makes this a Git dependency',
    description:
      'Pinned commit hash — presence of this key makes this a Git dependency (needs `version` ' +
      'and `uri` too).',
    value: { kind: 'string' },
  },
  {
    key: 'hash',
    summary: 'Optional integrity hash',
    description: 'Optional integrity hash (e.g. `blake3:...`). Valid on any dependency kind.',
    value: { kind: 'string' },
  },
  {
    key: 'signature',
    summary: 'Optional signature (Registry dependencies only)',
    description: 'Optional signature. Registry dependencies only.',
    value: { kind: 'string' },
  },
];

const PUBLISH_REGISTRY_ENTRY_FIELDS: IdpFieldSchema[] = [
  {
    key: 'uri',
    summary: 'The registry URI',
    description: 'The registry URI.',
    value: { kind: 'string' },
  },
];

export const IDP_ROOT_FIELDS: IdpFieldSchema[] = [
  {
    key: 'specification_version',
    summary: 'The .idp schema format version',
    description: 'The `.idp` schema format version this file is written against.',
    value: { kind: 'integer' },
  },
  {
    key: 'code_generation',
    summary: 'What this package can be compiled to',
    description:
      'Declares what this package can be compiled to. Its only key is `languages`. ' +
      "Per-target output (directory, layout, package versions) lives in `comline.toml`'s " +
      '`[generate]` table, not here.',
    value: {
      kind: 'dictionary',
      fields: [
        {
          key: 'languages',
          summary: 'Targets this package can generate, CLI-validated',
          description:
            'The `language#version` targets this package declares it can generate. ' +
            "Each entry's value must be an empty dict (`lang#ver = {}` — it takes no options). " +
            'Completion offers targets the *currently configured* `comline` CLI can generate.',
          value: { kind: 'registry' },
        },
      ],
    },
  },
  {
    key: 'publish_registries',
    summary: 'Named publish destinations, keyed by name you choose',
    description: 'Named publish destinations for this package, keyed by a name you choose.',
    value: {
      kind: 'map',
      entry: {
        key: '<registry name>',
        summary: 'A publish registry reference',
        description:
          'A string, identifier, or namespaced reference to a registry, or a dictionary ' +
          'with a `uri`.',
        value: { kind: 'dictionary', fields: PUBLISH_REGISTRY_ENTRY_FIELDS },
      },
    },
  },
  {
    key: 'dependencies',
    summary: "This package's dependencies, keyed by name you choose",
    description: "This package's dependencies, keyed by a name you choose.",
    value: {
      kind: 'map',
      entry: {
        key: '<dependency name>',
        summary: 'A Path, Git, or Registry dependency',
        description:
          'A Path dependency (`path`), a Git dependency (`version` + `uri` + `commit`), or a ' +
          'Registry dependency (`version` + `uri`) — which fields are present determines the kind.',
        value: { kind: 'dictionary', fields: DEPENDENCY_ENTRY_FIELDS },
      },
    },
  },
];

export function idpValueKindLabel(value: IdpValueKind): string {
  switch (value.kind) {
    case 'integer':
      return 'integer';
    case 'string':
      return 'string';
    case 'dictionary':
      return 'dictionary';
    case 'registry':
      return 'languages registry';
    case 'map':
      return 'dictionary (named entries)';
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

export interface BlockSpan {
  start: number;
  end: number;
}

/**
 * Blanks `//` line comments, `/* *\/` block comments, and `"..."` string
 * contents to spaces — preserving length, offsets, and newlines — so brace
 * counting and key search downstream never trip over a `{`, `}`, or `#`
 * that only appears inside non-code text.
 */
export function stripNonCode(text: string): string {
  const out: string[] = new Array(text.length);
  type State = 'normal' | 'lineComment' | 'blockComment' | 'string';
  let state: State = 'normal';
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';

    if (state === 'normal') {
      if (ch === '/' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        state = 'lineComment';
        i += 2;
      } else if (ch === '/' && next === '*') {
        out[i] = ' ';
        out[i + 1] = ' ';
        state = 'blockComment';
        i += 2;
      } else if (ch === '"') {
        out[i] = ' ';
        state = 'string';
        i += 1;
      } else {
        out[i] = ch;
        i += 1;
      }
      continue;
    }

    if (state === 'lineComment') {
      if (ch === '\n') {
        out[i] = '\n';
        state = 'normal';
      } else {
        out[i] = ' ';
      }
      i += 1;
      continue;
    }

    if (state === 'blockComment') {
      if (ch === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        state = 'normal';
        i += 2;
      } else {
        out[i] = ch === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }

    // state === 'string'
    if (ch === '\\' && i + 1 < text.length) {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
    } else if (ch === '"') {
      out[i] = ' ';
      state = 'normal';
      i += 1;
    } else {
      out[i] = ch === '\n' ? '\n' : ' ';
      i += 1;
    }
  }

  return out.join('');
}

interface ScannedBlock {
  path: string[];
  start: number; // index right after the opening '{'
  end: number; // index of the matching '}'
}

/** The key immediately before `braceIndex` — i.e. the `key` in `key = {` —
 * by walking backward over whitespace, `=`, whitespace, then the key's own
 * characters. Every `{` in `.idp` is grammatically a `Dictionary` value, and
 * every `Dictionary` value is grammatically preceded by exactly this shape
 * (the root `congregation <name>` itself uses no braces), so this is a sound
 * assumption for this grammar specifically — not a general-purpose parser. */
function keyBeforeBrace(cleanText: string, braceIndex: number): string | undefined {
  let j = braceIndex - 1;
  while (j >= 0 && /\s/.test(cleanText[j])) {
    j--;
  }
  if (cleanText[j] !== '=') {
    return undefined;
  }
  j--;
  while (j >= 0 && /\s/.test(cleanText[j])) {
    j--;
  }
  const end = j + 1;
  while (j >= 0 && /[a-zA-Z0-9_:.#@]/.test(cleanText[j])) {
    j--;
  }
  const start = j + 1;
  return start < end ? cleanText.slice(start, end) : undefined;
}

/** Every `{...}` block in the document, each tagged with its full key-path
 * (e.g. `['code_generation', 'languages']`), via a single brace-tracking
 * pass. */
function scanBlocks(cleanText: string): ScannedBlock[] {
  const blocks: ScannedBlock[] = [];
  const stack: { key: string; start: number }[] = [];

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    if (ch === '{') {
      stack.push({ key: keyBeforeBrace(cleanText, i) ?? '', start: i + 1 });
    } else if (ch === '}') {
      const top = stack.pop();
      if (top) {
        blocks.push({
          path: [...stack.map((s) => s.key), top.key],
          start: top.start,
          end: i,
        });
      }
    }
  }

  return blocks;
}

/** The key-path of whichever block contains `offset`, deepest first — `[]`
 * at the top level (outside every block). */
export function keyPathAt(cleanText: string, offset: number): string[] {
  let best: ScannedBlock | undefined;
  for (const block of scanBlocks(cleanText)) {
    if (offset >= block.start && offset <= block.end) {
      if (!best || block.path.length > best.path.length) {
        best = block;
      }
    }
  }
  return best ? best.path : [];
}

/** The span of the block whose key-path exactly matches `path` — used to
 * locate `code_generation.languages`'s block for decoration/entry scanning. */
export function findBlockSpan(cleanText: string, path: string[]): BlockSpan | undefined {
  const match = scanBlocks(cleanText).find(
    (b) => b.path.length === path.length && b.path.every((k, i) => k === path[i])
  );
  return match ? { start: match.start, end: match.end } : undefined;
}

export interface EntryKey {
  token: string;
  start: number;
  end: number;
}

const ENTRY_KEY_PATTERN = '([a-zA-Z0-9_]+(?:::[a-zA-Z0-9_]+)*#[a-zA-Z0-9_.]+)(?=\\s*=\\s*\\{)';

/** Entry keys (`name#version`) inside a span, each immediately followed by
 * `= {` — matches `.idp`'s `ItemVersionMeta` leaf pattern. */
export function findEntryKeys(cleanText: string, span: BlockSpan): EntryKey[] {
  const re = new RegExp(ENTRY_KEY_PATTERN, 'g');
  const slice = cleanText.slice(span.start, span.end);
  const results: EntryKey[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice))) {
    const start = span.start + m.index;
    results.push({ token: m[1], start, end: start + m[1].length });
  }
  return results;
}

/** Manual token-range scan (`[A-Za-z0-9_:.#]`) around an offset — `#` isn't
 * a word character per `language-configuration.idp.json`'s default
 * `wordPattern`, so VS Code's own word-range lookup would only replace half
 * of a `name#version` token. */
export function tokenRangeAround(text: string, offset: number): [number, number] {
  const isTokenChar = (ch: string): boolean => /[A-Za-z0-9_:.#]/.test(ch);
  let start = offset;
  while (start > 0 && isTokenChar(text[start - 1])) {
    start--;
  }
  let end = offset;
  while (end < text.length && isTokenChar(text[end])) {
    end++;
  }
  return [start, end];
}

export type SchemaAtPath = { fields: IdpFieldSchema[] } | { isRegistry: true } | undefined;

/** Walks the schema along `path` (a `keyPathAt` result) — a path segment at
 * a `map` node is treated as a user-chosen key (looked up by shape, not by
 * name), since dependency/registry names are never fixed. */
export function resolveSchemaAtPath(path: string[]): SchemaAtPath {
  let fields: IdpFieldSchema[] | undefined = IDP_ROOT_FIELDS;
  let pendingMapEntry: IdpFieldSchema | undefined;

  for (const key of path) {
    if (pendingMapEntry) {
      const value = pendingMapEntry.value;
      pendingMapEntry = undefined;
      fields = value.kind === 'dictionary' ? value.fields : [];
      continue;
    }

    if (!fields) {
      return undefined;
    }
    const field: IdpFieldSchema | undefined = fields.find((f) => f.key === key);
    if (!field) {
      return undefined;
    }

    switch (field.value.kind) {
      case 'dictionary':
        fields = field.value.fields;
        break;
      case 'registry':
        return { isRegistry: true };
      case 'map':
        pendingMapEntry = field;
        fields = undefined;
        break;
      default:
        fields = [];
    }
  }

  if (pendingMapEntry) {
    return { fields: [] }; // at the dynamic-dict level itself — names are user-chosen
  }
  return fields ? { fields } : undefined;
}

/** The schema field named `word`, as a key directly inside the block at
 * `path` (e.g. `path = ['code_generation']`, `word = 'languages'`). Returns
 * `undefined` for a dynamic (`map`) entry's own key, like a dependency name
 * — there's no fixed schema for a name the user chose. */
export function resolveFieldByPathAndWord(path: string[], word: string): IdpFieldSchema | undefined {
  const parent = resolveSchemaAtPath(path);
  if (!parent || !('fields' in parent)) {
    return undefined;
  }
  return parent.fields.find((f) => f.key === word);
}
