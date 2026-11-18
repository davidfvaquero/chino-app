/**
 * Radicals module: loader/parser + search helpers.
 * Browser-free on purpose — `render()` is exercised in the browser check,
 * the data path and search are pure and tested here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_RADICAL_BASE,
  configure,
  createRadicalLoader,
  getDecomposition,
  loadRadicalIndex,
  loadReverse,
  normalizeCharacter,
  normalizePinyinForSearch,
  searchRadicals,
  searchRadicalsAsync,
} from '../src/learn/radicals.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');

/** fetchImpl that reads the real committed files, so the loader is tested as wired. */
async function fileFetch(url) {
  // Extract the path after 'radicals/' from file:// URLs
  const match = url.match(/radicals\/(.+)$/);
  if (!match) throw new Error(`Unexpected radicals URL: ${url}`);
  const rel = match[1];
  const text = await fs.readFile(path.join(DATA, 'radicals', rel), 'utf8');
  return JSON.parse(text);
}

// Configure the module's fetcher for tests
configure({ fetch: fileFetch });

const loader = createRadicalLoader({ base: new URL('file://' + path.join(DATA, 'radicals') + '/'), fetchImpl: fileFetch });

test('normalizeCharacter takes the first CJK char and survives junk', () => {
  assert.equal(normalizeCharacter('你'), '你');
  assert.equal(normalizeCharacter('  你好 '), '你');
  assert.equal(normalizeCharacter('%E4%BD%A0'), '你');
  assert.equal(normalizeCharacter('ni hao'), '');
  assert.equal(normalizeCharacter(''), '');
  assert.equal(normalizeCharacter(undefined), '');
  assert.equal(normalizeCharacter('%E4'), '');
});

test('loadRadicalIndex returns 214 Kangxi radicals with required fields', async () => {
  const radicals = await loader.loadRadicalIndex();
  assert.equal(radicals.length, 214, 'exactly 214 radicals');
  for (const r of radicals) {
    assert.ok(typeof r.number === 'number' && r.number >= 1 && r.number <= 214, `${r.symbol} has valid number`);
    assert.ok(typeof r.symbol === 'string' && r.symbol.length >= 1, `${r.number} has symbol`);
    assert.ok(typeof r.pinyin === 'string' && r.pinyin.length >= 1, `${r.symbol} has pinyin`);
    assert.ok(typeof r.meaning === 'string' && r.meaning.length >= 1, `${r.symbol} has meaning`);
    assert.ok(typeof r.strokes === 'number' && r.strokes >= 1, `${r.symbol} has stroke count`);
  }
  // Check a few known radicals
  const byNum = Object.fromEntries(radicals.map(r => [r.number, r]));
  assert.equal(byNum[1].symbol, '一', 'radical 1 is 一');
  assert.equal(byNum[38].symbol, '女', 'radical 38 is 女');
  assert.equal(byNum[72].symbol, '日', 'radical 72 is 日');
  assert.equal(byNum[74].symbol, '月', 'radical 74 is 月');
  assert.equal(byNum[214].symbol, '龠', 'radical 214 is 龠');
});

test('radicals are ordered by stroke count in the source data', async () => {
  const radicals = await loader.loadRadicalIndex();
  // Verify they're sorted by stroke count (the source data is already ordered this way)
  for (let i = 1; i < radicals.length; i++) {
    assert.ok(radicals[i].strokes >= radicals[i - 1].strokes, `radical ${radicals[i].number} (${radicals[i].strokes} strokes) should not come before ${radicals[i-1].number} (${radicals[i-1].strokes} strokes)`);
  }
});

test('searchRadicals finds by symbol, pinyin, and meaning', async () => {
  const radicals = await loader.loadRadicalIndex();
  // By symbol
  let hits = searchRadicals('女', radicals, { limit: 10 });
  assert.equal(hits[0].symbol, '女', 'exact symbol match comes first');
  assert.ok(hits.some(r => r.symbol === '女'), 'finds 女 by symbol');
  // By pinyin
  hits = searchRadicals('nǚ', radicals, { limit: 10 });
  assert.ok(hits.some(r => r.symbol === '女'), 'finds 女 by pinyin with tone marks');
  hits = searchRadicals('nv', radicals, { limit: 10 });
  assert.ok(hits.some(r => r.symbol === '女'), 'finds 女 by pinyin without tone marks');
  // By meaning
  hits = searchRadicals('woman', radicals, { limit: 10 });
  assert.ok(hits.some(r => r.symbol === '女'), 'finds 女 by English meaning');
  hits = searchRadicals('sun', radicals, { limit: 10 });
  assert.ok(hits.some(r => r.symbol === '日'), 'finds 日 by English meaning');
  hits = searchRadicals('water', radicals, { limit: 10 });
  assert.ok(hits.some(r => r.symbol === '水'), 'finds 水 by English meaning');
  // Limit respected
  hits = searchRadicals('一', radicals, { limit: 2 });
  assert.ok(hits.length <= 2);
  // Empty query
  assert.deepEqual(searchRadicals('', radicals), []);
  assert.deepEqual(searchRadicals(null, radicals), []);
});

test('searchRadicalsAsync uses the loader and returns results', async () => {
  const hits = await searchRadicalsAsync('火', { limit: 5 });
  assert.ok(hits.length > 0);
  assert.ok(hits.some(r => r.symbol === '火'));
});

test('getDecomposition returns parts, radical, and kangxiNumber for 好', async () => {
  const d = await getDecomposition('好');
  assert.ok(d, '好 has decomposition entry');
  assert.deepEqual(d.parts, ['女', '子'], '好 parts are 女 and 子');
  assert.equal(d.radical, '女', '好 radical is 女');
  assert.equal(d.kangxiNumber, 38, '好 kangxiNumber is 38 (女)');
});

test('getDecomposition returns parts, radical, and kangxiNumber for 明', async () => {
  const d = await getDecomposition('明');
  assert.ok(d, '明 has decomposition entry');
  assert.deepEqual(d.parts, ['日', '月'], '明 parts are 日 and 月');
  assert.equal(d.radical, '日', '明 radical is 日');
  assert.equal(d.kangxiNumber, 72, '明 kangxiNumber is 72 (日)');
});

test('getDecomposition returns null for unknown character', async () => {
  assert.equal(await getDecomposition('龘'), null, 'unknown character returns null');
  assert.equal(await getDecomposition('abc'), null, 'non-hanzi returns null');
  assert.equal(await getDecomposition(''), null, 'empty string returns null');
});

test('loadReverse returns characters containing a component', async () => {
  const chars = await loadReverse('女');
  assert.ok(Array.isArray(chars), 'returns array');
  assert.ok(chars.includes('好'), '女 reverse index includes 好');
  assert.ok(chars.includes('妈'), '女 reverse index includes 妈');
  assert.ok(chars.includes('姐'), '女 reverse index includes 姐');
  // Simplified only: traditional-only forms must not be listed
  assert.ok(!chars.includes('媽'), '女 reverse index excludes 媽 (traditional)');
  assert.ok(!chars.includes('婦'), '女 reverse index excludes 婦 (traditional)');
  // Sorted by Unicode
  for (let i = 1; i < chars.length; i++) {
    assert.ok(chars[i - 1] <= chars[i], `chars sorted: ${chars[i-1]} <= ${chars[i]}`);
  }
});

test('loadReverse returns characters for 日 and 月', async () => {
  const ri = await loadReverse('日');
  assert.ok(ri.includes('明'), '日 reverse index includes 明');
  assert.ok(ri.includes('早'), '日 reverse index includes 早');
  const yue = await loadReverse('月');
  assert.ok(yue.includes('明'), '月 reverse index includes 明');
  assert.ok(yue.includes('有'), '月 reverse index includes 有');
});

test('loadReverse returns null for unknown component', async () => {
  assert.equal(await loadReverse('龘'), null);
  assert.equal(await loadReverse('abc'), null);
  assert.equal(await loadReverse(''), null);
});

test('loader caches: one fetch per URL even when asked twice', async () => {
  const seen = [];
  const counting = createRadicalLoader({
    base: new URL('file://' + path.join(DATA, 'radicals') + '/'),
    fetchImpl: (url) => { seen.push(url); return fileFetch(url); },
  });
  await counting.loadRadicalIndex();
  await counting.loadRadicalIndex();
  await counting.loadDecomposition('好');
  await counting.loadDecomposition('好');
  const indexUrls = seen.filter(u => u.endsWith('radicals.json')).length;
  assert.equal(indexUrls, 1, 'radicals.json fetched once');
  // Check that the decomposition shard for 好 was fetched only once
  const decompUrls = seen.filter(u => u.includes('shards/') && u.endsWith('.json'));
  const uniqueDecompUrls = new Set(decompUrls);
  assert.equal(uniqueDecompUrls.size, decompUrls.length, 'each decomposition shard fetched once');
});

test('the default loader is wired to the runtime data path', () => {
  assert.ok(DEFAULT_RADICAL_BASE.pathname.endsWith('/data/radicals/'), DEFAULT_RADICAL_BASE.href);
  assert.equal(typeof loadRadicalIndex, 'function');
  assert.equal(typeof getDecomposition, 'function');
  assert.equal(typeof loadReverse, 'function');
});

test('decomposition shards stay small enough for lazy mobile loading', async () => {
  const index = await loader.loadDecompositionIndex();
  for (const sh of index.shards) {
    const shardUrl = new URL(sh.file, 'file://' + path.join(DATA, 'radicals') + '/').href;
    const shard = await fileFetch(shardUrl);
    const size = Buffer.byteLength(JSON.stringify(shard));
    assert.ok(size < 200 * 1024, `${sh.file} is ${size} bytes (< 200KB)`);
  }
});

test('reverse index shards stay small enough', async () => {
  const index = await loader.loadReverseIndex();
  for (const sh of index.shards) {
    const shardUrl = new URL(sh.file, 'file://' + path.join(DATA, 'radicals') + '/').href;
    const shard = await fileFetch(shardUrl);
    const size = Buffer.byteLength(JSON.stringify(shard));
    assert.ok(size < 200 * 1024, `${sh.file} is ${size} bytes (< 200KB)`);
  }
});

test('all decomposition entries have valid structure', async () => {
  const index = await loader.loadDecompositionIndex();
  let checked = 0;
  for (const sh of index.shards) {
    const shardUrl = new URL(sh.file, 'file://' + path.join(DATA, 'radicals') + '/').href;
    const shard = await fileFetch(shardUrl);
    for (const [ch, entry] of Object.entries(shard)) {
      assert.ok(entry.parts && Array.isArray(entry.parts), `${ch} has parts array`);
      assert.ok(typeof entry.radical === 'string', `${ch} has radical string`);
      assert.ok(entry.kangxiNumber === null || (typeof entry.kangxiNumber === 'number' && entry.kangxiNumber >= 1 && entry.kangxiNumber <= 214),
        `${ch} kangxiNumber is null or 1-214`);
      checked++;
    }
  }
  assert.equal(checked, index.characters, 'all characters checked');
});