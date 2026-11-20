// dict-es integration: the Spanish shard loading + merge, the per-entry English
// fallback, the Spanish search index and the "no Spanish fetch in locale en"
// guarantee. Offline: English data is the real public/data/dict via fs, Spanish
// data is synthetic (there is no public/data/es/dict yet).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { search, lookup, configure, resetCache } from '../src/dictionary.js';
import { buildIndex, esTokens, ES_STOPWORDS } from '../scripts/build-dict-es-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const ES = '/data/es/dict/';
const ES_SEARCH = '/data/es/search/';

/** Synthetic Spanish files for the test at hand: 'shards/003.json' -> value.
 *  A url missing from here answers 404 (the normal "not translated" case). */
let esFiles = {};
let calls = [];

async function testFetch(url) {
  calls.push(url);
  for (const [prefix, key] of [[ES_SEARCH, 'search/'], [ES, '']]) {
    if (!url.startsWith(prefix)) continue;
    const rel = key + url.slice(prefix.length);
    const value = Object.prototype.hasOwnProperty.call(esFiles, rel) ? esFiles[rel] : undefined;
    if (value === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => value };
  }
  const rel = url.replace(/^\/data\//, '');
  const text = await fs.promises.readFile(path.join(DATA, rel), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
}

const esCalls = () => calls.filter((url) => url.startsWith(ES) || url.startsWith(ES_SEARCH));
const pad3 = (n) => String(n).padStart(3, '0');

before(() => configure({ fetch: testFetch }));

/** The real shard number + id of 你好, discovered from the English data. */
async function helloEntry() {
  resetCache();
  esFiles = {};
  const results = await search('你好', { limit: 5 });
  const hit = results.find((r) => r.simp === '你好');
  assert.ok(hit, '你好 is in the English dictionary');
  assert.equal(typeof hit.shard, 'number', 'a result carries its shard number');
  return hit;
}

test('locale en: a search never touches the Spanish data', async () => {
  resetCache();
  esFiles = {};
  calls = [];
  const results = await search('hello');
  assert.ok(results.length > 0);
  assert.equal(esCalls().length, 0, 'no /data/es/ request without spanish');
  for (const r of results) assert.equal(r.defsEs, undefined);
});

test('merge by id: only the translated entry gets defsEs', async () => {
  const hit = await helloEntry();
  esFiles = {
    [`shards/${pad3(hit.shard)}.json`]: [
      { id: hit.id, defs: ['hola', 'saludo'] },
      { id: -1, defs: ['no coincide'] }, // different id: must be ignored
    ],
  };
  calls = [];
  const results = await search('你好', { spanish: true });
  const r = results.find((x) => x.id === hit.id);
  assert.deepEqual(r.defsEs, ['hola', 'saludo']);
  assert.ok(Array.isArray(r.defs) && r.defs.length, 'English defs are kept');
  assert.ok(esCalls().some((url) => url.endsWith(`shards/${pad3(hit.shard)}.json`)));
});

test('fallback per entry: a 404 shard keeps English and never throws', async () => {
  resetCache();
  esFiles = {}; // every Spanish shard 404s
  calls = [];
  const results = await search('你好', { spanish: true });
  const r = results.find((x) => x.simp === '你好');
  assert.ok(r, 'the entry still resolves');
  assert.equal(r.defsEs, undefined, 'no translation -> only English');
  assert.ok(Array.isArray(r.defs) && r.defs.length);
  assert.ok(esCalls().length > 0, 'it did probe the Spanish shard');

  // The miss is cached: a second search does not hit the network again.
  calls = [];
  await search('你好', { spanish: true });
  assert.equal(esCalls().length, 0, 'a cached 404 is not re-fetched');
});

test('lookup(word, {spanish:true}) returns defsEs; lookup(word) does not', async () => {
  const hit = await helloEntry();
  esFiles = { [`shards/${pad3(hit.shard)}.json`]: [{ id: hit.id, defs: ['hola'] }] };
  const es = await lookup('你好', { spanish: true });
  assert.equal(es.simp, '你好');
  assert.deepEqual(es.defsEs, ['hola']);

  const en = await lookup('你好');
  assert.equal(en.defsEs, undefined);
});

test('Spanish index: a Spanish word finds its entry, and ranks first', async () => {
  const hit = await helloEntry();
  esFiles = {
    [`shards/${pad3(hit.shard)}.json`]: [{ id: hit.id, defs: ['hola', 'saludo'] }],
    'search/h.json': { hola: [[hit.id, hit.shard]], saludo: [[hit.id, hit.shard]] },
  };
  calls = [];
  const results = await search('hola', { spanish: true });
  assert.ok(results.length > 0, 'the Spanish index found something');
  assert.equal(results[0].simp, '你好');
  assert.deepEqual(results[0].defsEs, ['hola', 'saludo']);
  assert.ok(esCalls().some((url) => url.endsWith('search/h.json')));
});

test('Spanish index missing: a Latin query behaves as before (English only)', async () => {
  resetCache();
  esFiles = {};
  const results = await search('hello', { spanish: true });
  assert.ok(results.length > 0);
  assert.ok(results.some((r) => r.simp === '你好'));
  assert.ok(esCalls().some((url) => url.endsWith('search/h.json')), 'it tried the es index');
});

test('buildIndex: word -> shards, accents stripped, stop-words dropped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chino-es-idx-'));
  try {
    fs.mkdirSync(path.join(dir, 'shards'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'shards', '007.json'),
      JSON.stringify([{ id: 1, defs: ['saludo', 'ir al mercado', 'el árbol'] }]),
    );
    const out = buildIndex(dir);
    assert.equal(out.shards, 1);
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index-spanish', 'i.json'), 'utf8'));
    assert.deepEqual(index.ir, [7], 'infinitives are indexed');
    assert.ok(!('al' in JSON.parse(fs.readFileSync(path.join(dir, 'index-spanish', 'a.json'), 'utf8'))), 'stop-word dropped');
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'index-spanish', 'm.json'), 'utf8'));
    assert.deepEqual(m.mercado, [7]);
    const a = JSON.parse(fs.readFileSync(path.join(dir, 'index-spanish', 'a.json'), 'utf8'));
    assert.deepEqual(a.arbol, [7], 'accents stripped (árbol -> arbol)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildIndex: no shards dir is a no-op', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chino-es-empty-'));
  try {
    assert.deepEqual(buildIndex(dir), { shards: 0, words: 0, letters: 0 });
    assert.ok(!fs.existsSync(path.join(dir, 'index-spanish')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('esTokens / ES_STOPWORDS sanity', () => {
  assert.deepEqual(esTokens('El árbol de la vida'), ['el', 'arbol', 'de', 'la', 'vida']);
  assert.ok(ES_STOPWORDS.has('el') && ES_STOPWORDS.has('de'));
  assert.ok(!ES_STOPWORDS.has('arbol'));
});

test('the dictionary screen opts into Spanish only for locale es', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/screens/dictionary.js'), 'utf8');
  assert.match(src, /spanish: getLocale\(\) === 'es'/);
  assert.match(src, /'data-action': 'toggle-english'/);
  assert.match(src, /dict\.machineTranslation/);
});
