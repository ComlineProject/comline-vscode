// Run with `yarn test` (node's built-in runner, on the compiled output).
//
// The schema's contents are core's (`idpSchema.generated.json`), so these
// don't list its keys: they hold the engine to the shapes core writes, and
// pin what comline-vscode#31 found missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDP_ROOT_FIELDS,
  IdpFieldSchema,
  IdpValueKind,
  idpValueKindLabel,
  keyPathAt,
  loadIdpSchema,
  resolveFieldByPathAndWord,
  resolveSchemaAtPath,
  stripNonCode,
} from './idpSchema';

const keys = (fields: IdpFieldSchema[]): string[] => fields.map((f) => f.key);

const fieldsAt = (path: string[]): IdpFieldSchema[] => {
  const resolved = resolveSchemaAtPath(path);
  assert.ok(resolved && 'fields' in resolved, `fields at ${path.join('.')}`);
  return resolved.fields;
};

/** The path of the cursor at `|` in `source`. */
const pathAtBar = (source: string): string[] => {
  const offset = source.indexOf('|');
  const text = source.slice(0, offset) + source.slice(offset + 1);
  return keyPathAt(stripNonCode(text), offset);
};

const walk = (field: IdpFieldSchema, visit: (f: IdpFieldSchema) => void): void => {
  visit(field);
  const nested = (value: IdpValueKind): void => {
    switch (value.kind) {
      case 'dictionary':
        value.fields.forEach((f) => walk(f, visit));
        break;
      case 'map':
        walk(value.entry, visit);
        break;
      case 'oneOf':
        value.alternatives.forEach(nested);
        break;
      case 'list':
        nested(value.item);
        break;
    }
  };
  nested(field.value);
};

test('every field core describes has a one-line summary and a description', () => {
  let seen = 0;
  for (const root of IDP_ROOT_FIELDS) {
    walk(root, (f) => {
      seen++;
      assert.ok(f.summary.length > 0 && !f.summary.includes('\n'), `${f.key}: summary`);
      assert.ok(f.description.length > 0, `${f.key}: description`);
    });
  }
  assert.ok(seen > 20, `only ${seen} fields`);
});

test('the root keys include what the schema had missed (#31)', () => {
  const root = keys(IDP_ROOT_FIELDS);
  for (const key of ['specification_version', 'id', 'handshake', 'settings', 'unverified', 'encodings']) {
    assert.ok(root.includes(key), `${key} in ${root.join(', ')}`);
  }
});

test('specification_version is the edition, not a schema format version', () => {
  const field = IDP_ROOT_FIELDS.find((f) => f.key === 'specification_version');
  assert.ok(field);
  assert.match(field.description, /edition/);
  assert.doesNotMatch(field.description, /schema format version/);
});

test('wire lists the formats and framings core declares, with their defaults', () => {
  const wire = Object.fromEntries(fieldsAt(['wire']).map((f) => [f.key, f.value]));
  const format = wire.format;
  const framing = wire.framing;
  assert.equal(format.kind, 'choice');
  assert.equal(framing.kind, 'choice');
  if (format.kind === 'choice' && framing.kind === 'choice') {
    assert.equal(format.default, 'packed@1');
    assert.ok(format.values.includes('json@1') && format.values.includes('msgpack@1'));
    assert.equal(framing.default, 'datagram@3');
    assert.ok(framing.values.includes('datagram@2'));
  }
  const text = IDP_ROOT_FIELDS.find((f) => f.key === 'wire')?.description ?? '';
  assert.doesNotMatch(text, /framing = "datagram@2"/);
});

test('handshake is a name or a dictionary of comline@2 parameters, default first', () => {
  const handshake = IDP_ROOT_FIELDS.find((f) => f.key === 'handshake');
  assert.ok(handshake);
  assert.equal(handshake.value.kind, 'oneOf');

  const fields = fieldsAt(['handshake']);
  assert.deepEqual(keys(fields), ['name', 'scope', 'newer_consumer', 'same_version_differs', 'exchange']);
  const values = (key: string): string[] | undefined => {
    const value = fields.find((f) => f.key === key)?.value;
    return value?.kind === 'choice' ? value.values : undefined;
  };
  assert.deepEqual(values('scope'), ['protocol', 'package']);
  assert.deepEqual(values('newer_consumer'), ['degrade', 'refuse']);
  assert.deepEqual(values('same_version_differs'), ['refuse', 'warn']);
  assert.deepEqual(values('exchange'), ['offer', 'symmetric']);
  assert.equal(fields.find((f) => f.key === 'name')?.required, true);
});

test('a dependency takes accept_unverified', () => {
  const dependency = keys(fieldsAt(['dependencies', 'shared']));
  for (const key of ['path', 'version', 'uri', 'commit', 'hash', 'signature', 'accept_unverified']) {
    assert.ok(dependency.includes(key), `${key} in ${dependency.join(', ')}`);
  }
});

test('code_generation.languages is the CLI registry, not core’s entries', () => {
  assert.deepEqual(keys(fieldsAt(['code_generation'])), ['languages']);
  assert.deepEqual(resolveSchemaAtPath(['code_generation', 'languages']), { isRegistry: true });
  const languages = resolveFieldByPathAndWord(['code_generation'], 'languages');
  assert.equal(languages?.value.kind, 'registry');
  assert.match(languages?.description ?? '', /currently configured/);
});

test('the walk follows a name or a dictionary, and a map’s entry names', () => {
  assert.deepEqual(keys(fieldsAt(['publish_registries', 'mine'])), ['uri']);
  // `encodings = { "com.acme.x@1" = { map = { rust = { | } } } }`
  assert.deepEqual(keys(fieldsAt(['encodings', '', 'map', ''])), ['type', 'package', 'version']);
  assert.deepEqual(keys(fieldsAt(['encodings', ''])), ['kind', 'profile', 'map']);
  // Inside `settings` the language server answers, and the schema says nothing.
  assert.deepEqual(fieldsAt(['settings']), []);
  assert.equal(resolveSchemaAtPath(['nonsense']), undefined);
  // At a map itself the names are the user's.
  assert.deepEqual(fieldsAt(['dependencies']), []);
});

test('the cursor’s path is found in text', () => {
  assert.deepEqual(pathAtBar('handshake = { name = "comline@2" | }'), ['handshake']);
  assert.deepEqual(pathAtBar('dependencies = { a = { | } }'), ['dependencies', 'a']);
  assert.deepEqual(pathAtBar('/* wire = { */ id = "x"\nwire = { | }'), ['wire']);
  assert.deepEqual(pathAtBar('id = "{" |'), []);
});

test('hover finds a key by the block it is in', () => {
  assert.equal(resolveFieldByPathAndWord(['handshake'], 'exchange')?.key, 'exchange');
  assert.equal(resolveFieldByPathAndWord([], 'handshake')?.key, 'handshake');
  assert.equal(resolveFieldByPathAndWord(['handshake'], 'nope'), undefined);
});

test('labels show a choice’s values and an either-or', () => {
  assert.equal(idpValueKindLabel({ kind: 'choice', values: ['a', 'b'] }), '"a" | "b"');
  assert.equal(idpValueKindLabel({ kind: 'integer', values: [1] }), '1');
  assert.equal(idpValueKindLabel({ kind: 'integer' }), 'integer');
  assert.equal(
    idpValueKindLabel({ kind: 'oneOf', alternatives: [{ kind: 'string' }, { kind: 'dictionary', fields: [] }] }),
    'string | dictionary'
  );
  assert.equal(idpValueKindLabel({ kind: 'list', item: { kind: 'string' } }), '[string]');
});

test('a file in a version this extension does not read is refused', () => {
  assert.throws(() => loadIdpSchema({ version: 99, keys: [] }), /version 99/);
});
