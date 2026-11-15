// The schema of `.idp` ("congregation" package config) plus the text-heuristic
// engine that resolves "what key-path is the cursor inside" against it. No
// `.idp` parser exists client-side (or in the language server at all —
// confirmed, see extension.ts), so this works off plain text scanning, in the
// same spirit as the language server's `completion.rs::determine_context` for
// `.ids`. That function only strips `//` line comments, which is correct only
// for `.ids` — `.idp` has `/* */` block comments too (confirmed in
// `core/core/src/package/config/idl/grammar.rs`), so this independently
// strips both, plus string contents, before any brace-depth counting or key
// search runs.
//
// The schema itself is not written here. Core's reader is a hand-written,
// string-key-switching interpreter, so core keeps a table of the keys it reads
// (`comline_core::package::config::keys`, held to the reader by its tests) and
// commits it as `schemas/config-idp.json`. `idpSchema.generated.json` is that
// file at the core commit `comline.idpSchema.rev` in package.json pins, and
// `scripts/sync-idp-schema.mjs` keeps it so (CI fails when it differs):
// a key core reads shows up here by bumping the pin, not by editing this file.
// Only `code_generation.languages` is overridden below: its keys are open
// `name#version` tokens validated at `comline generation` time against the
// generators the CLI has, so the extension offers the CLI's live list (see
// `comline.cli.*` / `ensureTargetsLoaded` in extension.ts) instead of
// guessing.

import generated from './idpSchema.generated.json';

/** The shape of a value, as core's table writes it
 * (`comline_core::package::config::keys::ConfigShape`). */
export type IdpValueKind =
  | { kind: 'integer'; values?: number[] }
  | { kind: 'string' }
  // A string from a closed set; `default` is what applies where it's left out,
  // `namespaced` whether a name declared under `encodings` is allowed too.
  | { kind: 'choice'; values: string[]; default?: string; namespaced?: boolean }
  | { kind: 'list'; item: IdpValueKind }
  | { kind: 'dictionary'; fields: IdpFieldSchema[] }
  // A dictionary whose keys are user-chosen names (a dependency name, a
  // publish-registry name) — `entry` describes the shape of each value.
  | { kind: 'map'; entry: IdpFieldSchema }
  // Any one of these (`handshake`: a name, or a dictionary).
  | { kind: 'oneOf'; alternatives: IdpValueKind[] }
  // The settings registry's keys, which the language server serves.
  | { kind: 'settings' }
  // `code_generation.languages` specifically — dynamic `name#version` keys,
  // validated live against the configured `comline` CLI, not this schema.
  | { kind: 'registry' };

export interface IdpFieldSchema {
  key: string;
  /** One line, plain text (no markdown/backticks — rendered as a `//`
   * comment inside a colored code block) — shown when this field is listed
   * under its *parent's* hover, where the full `description` would be too
   * long to read at a glance. */
  summary: string;
  /** The full explanation, shown when this field is hovered directly. */
  description: string;
  /** Whether the dictionary it is in is wrong without it. */
  required?: boolean;
  value: IdpValueKind;
}

/** The file's own version, which core bumps when it changes the shape. */
const SUPPORTED_SCHEMA_VERSION = 1;

const REGISTRY_NOTE =
  'Completion offers the targets the *currently configured* `comline` CLI can generate.';

/** `code_generation.languages` as the extension serves it: core's field, its
 * entries replaced by the CLI's live list. */
function withRegistry(fields: IdpFieldSchema[]): IdpFieldSchema[] {
  return fields.map((field) => {
    if (field.key !== 'code_generation' || field.value.kind !== 'dictionary') {
      return field;
    }
    const languages = field.value.fields.map((f) =>
      f.key === 'languages'
        ? { ...f, description: `${f.description} ${REGISTRY_NOTE}`, value: { kind: 'registry' } as IdpValueKind }
        : f
    );
    return { ...field, value: { kind: 'dictionary', fields: languages } as IdpValueKind };
  });
}

/** The root keys of `config.idp`, from core's table. */
export function loadIdpSchema(file: { version: number; keys: unknown }): IdpFieldSchema[] {
  if (file.version !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `idpSchema.generated.json is version ${file.version}, this extension reads ${SUPPORTED_SCHEMA_VERSION}`
    );
  }
  return withRegistry(file.keys as IdpFieldSchema[]);
}

export const IDP_ROOT_FIELDS: IdpFieldSchema[] = loadIdpSchema(generated);

export function idpValueKindLabel(value: IdpValueKind): string {
  switch (value.kind) {
    case 'integer':
      return value.values && value.values.length > 0 ? value.values.join(' | ') : 'integer';
    case 'string':
      return 'string';
    case 'choice':
      return value.values.map((v) => `"${v}"`).join(' | ');
    case 'list':
      return `[${idpValueKindLabel(value.item)}]`;
    case 'dictionary':
      return 'dictionary';
    case 'registry':
      return 'languages registry';
    case 'map':
      return 'dictionary (named entries)';
    case 'oneOf':
      return value.alternatives.map(idpValueKindLabel).join(' | ');
    case 'settings':
      return 'dictionary (settings)';
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

/** The fields of the dictionary a value is, or one of its alternatives is. */
export function dictionaryFieldsOf(value: IdpValueKind): IdpFieldSchema[] | undefined {
  if (value.kind === 'dictionary') {
    return value.fields;
  }
  if (value.kind === 'oneOf') {
    for (const alternative of value.alternatives) {
      const fields = dictionaryFieldsOf(alternative);
      if (fields) {
        return fields;
      }
    }
  }
  return undefined;
}

/** The entry of the map a value is, or one of its alternatives is. */
export function mapEntryOf(value: IdpValueKind): IdpFieldSchema | undefined {
  if (value.kind === 'map') {
    return value.entry;
  }
  if (value.kind === 'oneOf') {
    for (const alternative of value.alternatives) {
      const entry = mapEntryOf(alternative);
      if (entry) {
        return entry;
      }
    }
  }
  return undefined;
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
 * name), since dependency/registry names are never fixed. A value that is one
 * of several (`handshake`: a name or a dictionary) is walked by its
 * dictionary. */
export function resolveSchemaAtPath(path: string[]): SchemaAtPath {
  let fields: IdpFieldSchema[] | undefined = IDP_ROOT_FIELDS;
  let pendingMapEntry: IdpFieldSchema | undefined;

  for (const key of path) {
    if (pendingMapEntry) {
      const value: IdpValueKind = pendingMapEntry.value;
      pendingMapEntry = undefined;
      const entry = mapEntryOf(value);
      if (entry) {
        // A map of maps: this segment names an entry, the next is inside it.
        pendingMapEntry = entry;
        fields = undefined;
      } else {
        fields = dictionaryFieldsOf(value) ?? [];
      }
      continue;
    }

    if (!fields) {
      return undefined;
    }
    const field: IdpFieldSchema | undefined = fields.find((f) => f.key === key);
    if (!field) {
      return undefined;
    }

    if (field.value.kind === 'registry') {
      return { isRegistry: true };
    }
    const entry = mapEntryOf(field.value);
    if (entry) {
      pendingMapEntry = entry;
      fields = undefined;
    } else {
      fields = dictionaryFieldsOf(field.value) ?? [];
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
