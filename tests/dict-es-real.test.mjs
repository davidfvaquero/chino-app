// Spanish search against the REAL dictionary data (public/data): the fixes for
// REVIEW-2 C2 (accented words and pinyin-like words must search Spanish), C3
// (a search downloads a handful of shards, not ~25 MB) and I8 (ranking).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { search, configure, resetCache } from '../src/dictionary.js';
import { buildSearchIndex } from '../scripts/build-dict-es-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');

let calls = [];
let bytes = 0;

async function fetchData(url) {
  calls.push(url);
  const rel = String(url).replace(/^\/data\//, '');
  const file = path.join(DATA, rel);
  if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
  const text = fs.readFileSync(file, 'utf8');
  bytes += Buffer.byteLength(text);
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
}

before(() => configure({ fetch: fetchData }));
beforeEach(() => {
  calls = [];
  bytes = 0;
  resetCache();
});

const simpTop = (results, n = 5) => results.slice(0, n).map((r) => r.simp);

test('C3: a Spanish search is a few requests, not the whole dictionary', async () => {
  const results = await search('comer', { spanish: true });
  assert.ok(calls.length <= 10, `only a few requests, got ${calls.length}`);
  assert.ok(bytes < 2 * 1024 * 1024, `under 2 MB, got ${(bytes / 1048576).toFixed(2)} MB`);
  assert.ok(simpTop(results).includes('吃'), '吃 is in the top 5 of "comer"');
});

test('C3: "agua" (appears in 104 shards) stays small and finds 水', async () => {
  const results = await search('agua', { spanish: true });
  assert.ok(calls.length <= 10, `only a few requests, got ${calls.length}`);
  assert.ok(bytes < 2 * 1024 * 1024);
  assert.ok(simpTop(results, 5).includes('水'));
});

test('C2: accented Spanish words search Spanish, not pinyin', async () => {
  assert.ok(simpTop(await search('árbol', { spanish: true })).includes('树'));
  assert.ok(simpTop(await search('año', { spanish: true })).includes('年'));
  assert.ok(simpTop(await search('café', { spanish: true })).includes('咖啡'));
});

test('C2: pinyin-like Spanish words still find their word', async () => {
  assert.ok(simpTop(await search('pan', { spanish: true })).includes('面包'));
});

test('I8: ranking prefers the common (HSK) entry', async () => {
  const results = await search('comer', { spanish: true });
  assert.equal(results[0].simp, '吃');
  const hogar = await search('hogar', { spanish: true });
  assert.ok(simpTop(hogar, 3).includes('家'));
});

test('I8: a hyphenated Spanish word is still found', async () => {
  const results = await search('italiano', { spanish: true });
  assert.ok(results.some((r) => r.id === 3544), 'chino-italiano -> 3544');
});

test('I8 + C3: pinyin search is capped too (no ~30 MB syllable lookup)', async () => {
  const results = await search('ni3', { spanish: true });
  assert.ok(calls.length <= 20, `capped shards, got ${calls.length} requests`);
  assert.ok(results.some((r) => r.simp === '你'));
});

test('buildSearchIndex: postings are [id, shard] pairs, best first', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chino-es-search-'));
  try {
    // Same layout as the app: <data>/es/dict, <data>/dict, <data>/es/search.
    const esDir = path.join(dir, 'es', 'dict');
    const enShards = path.join(dir, 'dict', 'shards');
    const hskDir = path.join(dir, 'hsk');
    fs.mkdirSync(path.join(esDir, 'shards'), { recursive: true });
    fs.mkdirSync(enShards, { recursive: true });
    fs.mkdirSync(hskDir, { recursive: true });
    fs.writeFileSync(path.join(hskDir, '1.json'), JSON.stringify({ items: [{ hanzi: '吃' }] }));
    fs.writeFileSync(
      path.join(enShards, '007.json'),
      JSON.stringify([{ id: 1, simp: '吃' }, { id: 2, simp: '食' }]),
    );
    fs.writeFileSync(
      path.join(esDir, 'shards', '007.json'),
      JSON.stringify([{ id: 1, defs: ['comer'] }, { id: 2, defs: ['comer'] }]),
    );
    const out = buildSearchIndex(esDir, { hskDir });
    assert.equal(out.words, 1);
    const postings = JSON.parse(fs.readFileSync(path.join(dir, 'es', 'search', 'c.json'), 'utf8'));
    assert.deepEqual(postings.comer, [[1, 7], [2, 7]], 'HSK entry first, then by id');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});