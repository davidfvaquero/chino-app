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

test('I5: pinyin without tones finds the common word in the top 3 of Spanish', async () => {
  // The ES index used to index the pinyin inside [wo3]/[jia1] references, so
  // "wo" returned 与/word/word姐 and 我 was pushed out. The tokenizer now drops
  // that markup, the HSK level ranks the common word first and the pinyin search
  // runs alongside the Spanish one.
  const wo = await search('wo', { spanish: true });
  assert.ok(simpTop(wo, 3).includes('我'), `wo -> ${wo.slice(0, 8).map((r) => r.simp).join(',')}`);
  assert.ok(!wo.some((r) => r.simp === '与'), 'the pinyin leak entry is gone');
  const hao = await search('hao', { spanish: true });
  assert.ok(simpTop(hao, 3).includes('好'), `hao -> ${hao.slice(0, 8).map((r) => r.simp).join(',')}`);
  const ren = await search('ren', { spanish: true });
  assert.ok(simpTop(ren, 3).includes('人'), `ren -> ${ren.slice(0, 8).map((r) => r.simp).join(',')}`);
});

test('I1: pinyin without tones finds the common word in the top 3 without Spanish too', async () => {
  for (const [q, ch] of [['wo', '我'], ['hao', '好'], ['ren', '人']]) {
    const results = await search(q, { spanish: false });
    assert.ok(simpTop(results, 3).includes(ch), `${q} -> ${results.slice(0, 8).map((r) => r.simp).join(',')}`);
  }
});

test('I1: the mixed Spanish+pinyin path stays inside the request budget', async () => {
  // Both searches run at once, so the pinyin side is capped to 2 shards: without
  // it "pan" downloaded 26 shards / 3.1 MB (REVIEW-4 I1, the C3 regression).
  for (const q of ['pan', 'wo', 'hao', 'mi']) {
    calls = [];
    bytes = 0;
    resetCache();
    await search(q, { spanish: true });
    assert.ok(calls.length <= 14, `${q}: ${calls.length} requests`);
    assert.ok(bytes < 2 * 1024 * 1024, `${q}: ${(bytes / 1048576).toFixed(2)} MB`);
  }
});

test('I2: casa finds 家, not just 宾馆', async () => {
  const results = await search('casa', { spanish: true });
  assert.ok(simpTop(results, 3).includes('家'), `casa -> ${results.slice(0, 5).map((r) => r.simp).join(',')}`);
  // The neighbours REVIEW-3 I6 fixed must not regress.
  assert.equal((await search('agua', { spanish: true }))[0].simp, '水');
  assert.equal((await search('pan', { spanish: true }))[0].simp, '面包');
  assert.ok(simpTop(await search('árbol', { spanish: true })).includes('树'));
  assert.ok(simpTop(await search('año', { spanish: true })).includes('年'));
  assert.ok(simpTop(await search('café', { spanish: true }), 3).includes('咖啡'));
});

test('M2: a proper name with a comma does not beat the common reading', async () => {
  // CC-CEDICT writes many names as "Shi, name of a river". Cutting exactDef on
  // the comma made that name an exact hit in es (shi -> 浉, guo -> 虢), ahead of
  // the HSK pinyin tier. Splitting on `;` only leaves 是/十 and 过 on top.
  const shi = await search('shi', { spanish: true });
  assert.ok(['是', '十'].includes(shi[0].simp), `shi -> ${shi.slice(0, 5).map((r) => r.simp).join(',')}`);
  const guo = await search('guo', { spanish: true });
  assert.ok(['过', '锅'].includes(guo[0].simp), `guo -> ${guo.slice(0, 5).map((r) => r.simp).join(',')}`);
});

test('I6: agua ranks 水 first and pan ranks 面包 first', async () => {
  const agua = await search('agua', { spanish: true });
  assert.equal(agua[0].simp, '水');
  const pan = await search('pan', { spanish: true });
  assert.equal(pan[0].simp, '面包');
});

test('I6: the Spanish path stays within the request budget', async () => {
  // The Spanish path is 1 index + up to 4 shards + the same ES shards again to
  // attach the translations. The pinyin/English fallback paths (ni/dog/c) still
  // load both the English and the Spanish shard for every hit; capping that
  // needs the postings preview (see the task handoff), so they are not asserted
  // here beyond the existing ni3 bound.
  for (const q of ['comer', 'agua']) {
    calls = [];
    resetCache();
    await search(q, { spanish: true });
    assert.ok(calls.length <= 10, `${q}: ${calls.length} requests`);
  }
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
    const postings = JSON.parse(fs.readFileSync(path.join(dir, 'search-es', 'c.json'), 'utf8'));
    assert.deepEqual(postings.comer, [[1, 7], [2, 7]], 'HSK entry first, then by id');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('I5: offline first search fails loudly, then recovers in the same session', async () => {
  const realFetch = fetchData;
  let offline = true;
  configure({
    fetch: async (url) => {
      if (offline) throw new TypeError('Failed to fetch');
      return realFetch(url);
    },
  });
  resetCache();
  await assert.rejects(() => search('comer', { spanish: true }), 'a network failure is not "no results"');
  offline = false;
  const results = await search('comer', { spanish: true });
  assert.ok(results.length > 0, 'the failed shard was not cached as missing');
});
