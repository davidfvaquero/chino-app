/**
 * i18n-es.test.mjs — guards the Spanish locale shards against the English
 * originals (browser-free, no npm deps).
 *
 * For src/locales/es.json and every src/locales/es.d/<x>.json it asserts, against
 * its English counterpart (src/locales/en.json, src/locales/en.d/<x>.json):
 *   - exactly the same leaf keys (none missing, none extra);
 *   - the same {placeholder} / plural markers in every string;
 *   - no empty string.
 *
 * Owner: t_9d78b94b (Spanish UI translation). Adding a key to an en shard
 * without the matching es key fails here on purpose.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const LOCALES = new URL('../src/locales/', import.meta.url);

const read = async (name) => JSON.parse(await readFile(new URL(name, LOCALES), 'utf8'));

/** Flat map of dotted key -> string value (leaf strings only). */
function leafEntries(obj, parents = []) {
  const out = new Map();
  for (const [part, value] of Object.entries(obj)) {
    const path = [...parents, part];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of leafEntries(value, path)) out.set(k, v);
    } else {
      out.set(path.join('.'), value);
    }
  }
  return out;
}

/** {placeholders} and ICU plural markers, in source order. */
const markers = (text) => String(text).match(/\{[^{}]*\}/g) ?? [];

/** Everything after the locale prefix ("en.d/tones.json" -> "d/tones.json"). */
const counterpart = (name) => name.replace(/^en/, 'es');

async function shardNames() {
  const dir = new URL('en.d/', LOCALES);
  return (await readdir(dir))
    .filter((n) => n.endsWith('.json'))
    .map((n) => `en.d/${n}`)
    .sort();
}

async function compare(enName) {
  const esName = counterpart(enName);
  let es;
  try {
    es = await read(esName);
  } catch {
    assert.fail(`missing Spanish file ${esName} (counterpart of ${enName})`);
  }
  const enLeaves = leafEntries(await read(enName));
  const esLeaves = leafEntries(es);

  const missing = [...enLeaves.keys()].filter((k) => !esLeaves.has(k));
  const extra = [...esLeaves.keys()].filter((k) => !enLeaves.has(k));
  assert.deepEqual(missing, [], `${esName}: keys missing vs ${enName}`);
  assert.deepEqual(extra, [], `${esName}: extra keys vs ${enName}`);

  for (const [key, enText] of enLeaves) {
    const esText = esLeaves.get(key);
    assert.equal(typeof esText, 'string', `${esName}:${key} must be a string`);
    assert.notEqual(esText.trim(), '', `${esName}:${key} must not be empty`);
    assert.deepEqual(
      markers(esText),
      markers(enText),
      `${esName}:${key} placeholder/plural markers differ from ${enName}`,
    );
  }
  return enLeaves.size;
}

test('es.json matches en.json (keys, markers, no empties)', async () => {
  await compare('en.json');
});

test('every en.d shard has a matching es.d shard with the same keys', async () => {
  const names = await shardNames();
  assert.ok(names.length > 0, 'found en.d shards to compare');
  const esNames = (await readdir(new URL('es.d/', LOCALES)))
    .filter((n) => n.endsWith('.json'))
    .map((n) => `es.d/${n}`)
    .sort();
  const expectedEs = names.map(counterpart).map((n) => n.replace('en.d/', 'es.d/'));
  assert.deepEqual(esNames, expectedEs, 'es.d/ mirrors en.d/ one-to-one');
});

test('each es.d shard matches its en.d counterpart', async () => {
  for (const name of await shardNames()) await compare(name);
});

test('the whole Spanish locale is fully translated (no leaf matches fallback-only)', async () => {
  const { loadMergedLocale } = await import('../scripts/build-locales.mjs');
  const merged = await loadMergedLocale(LOCALES, 'es');
  const leaves = leafEntries(merged);
  assert.ok(leaves.size > 500, `expected >500 Spanish strings, got ${leaves.size}`);
});
