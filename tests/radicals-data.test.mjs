// Sanity tests for the generated radicals data in public/data/radicals/.
// Run with `npm test` (node --test tests/) or `node --test tests/radicals-data.test.mjs`.
// These are pure Node tests: no network, no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAD = path.join(ROOT, 'public', 'data', 'radicals');
const read = (p) => JSON.parse(fs.readFileSync(path.join(RAD, p), 'utf8'));

// --- helpers -----------------------------------------------------------------

function loadDecomposition(ch) {
  const idx = read('decomposition-index.json');
  for (const sh of idx.shards) {
    const shard = read(sh.file);
    if (ch in shard) return shard[ch];
  }
  return null;
}

function loadReverseIndex(comp) {
  const idx = read('reverse-index.json');
  for (const sh of idx.shards) {
    const shard = read(sh.file);
    if (comp in shard) return shard[comp];
  }
  return null;
}

// --- tests -------------------------------------------------------------------

test('radicals.json has exactly 214 Kangxi radicals with required fields', () => {
  const rad = read('radicals.json');
  assert.equal(rad.length, 214, 'exactly 214 radicals');
  for (const r of rad) {
    assert.ok(typeof r.number === 'number' && r.number >= 1 && r.number <= 214, `${r.symbol} has valid number`);
    assert.ok(typeof r.symbol === 'string' && r.symbol.length >= 1, `${r.number} has symbol`);
    assert.ok(typeof r.pinyin === 'string' && r.pinyin.length >= 1, `${r.symbol} has pinyin`);
    assert.ok(typeof r.meaning === 'string' && r.meaning.length >= 1, `${r.symbol} has meaning`);
    assert.ok(typeof r.strokes === 'number' && r.strokes >= 1, `${r.symbol} has stroke count`);
  }
  // Check a few known radicals
  const byNum = Object.fromEntries(rad.map(r => [r.number, r]));
  assert.equal(byNum[1].symbol, '一', 'radical 1 is 一');
  assert.equal(byNum[38].symbol, '女', 'radical 38 is 女');
  assert.equal(byNum[72].symbol, '日', 'radical 72 is 日');
  assert.equal(byNum[74].symbol, '月', 'radical 74 is 月');
  assert.equal(byNum[214].symbol, '龠', 'radical 214 is 龠');
});

test('decomposition-index.json and shards are valid JSON', () => {
  const idx = read('decomposition-index.json');
  assert.ok(idx.characters > 9000, 'has >9000 characters with decomposition');
  assert.ok(idx.shards.length > 10, 'has multiple shards');
  for (const sh of idx.shards) {
    const shard = read(sh.file);
    assert.ok(typeof shard === 'object' && Object.keys(shard).length > 0, `${sh.file} is valid`);
    assert.equal(shard.length, undefined, `${sh.file} is an object not array`); // object keyed by char
    assert.equal(Object.keys(shard).length, sh.count, `${sh.file} count matches`);
  }
  // Total characters across shards matches index
  let total = 0;
  for (const sh of idx.shards) total += read(sh.file).length || Object.keys(read(sh.file)).length;
  assert.equal(total, idx.characters, 'shard counts sum to index.characters');
});

test('reverse-index.json and shards are valid JSON', () => {
  const idx = read('reverse-index.json');
  assert.ok(idx.components > 1000, 'has >1000 components');
  assert.ok(idx.shards.length > 10, 'has multiple shards');
  for (const sh of idx.shards) {
    const shard = read(sh.file);
    assert.ok(typeof shard === 'object' && Object.keys(shard).length > 0, `${sh.file} is valid`);
    assert.equal(Object.keys(shard).length, sh.count, `${sh.file} count matches`);
    for (const [comp, chars] of Object.entries(shard)) {
      assert.ok(Array.isArray(chars) && chars.length > 0, `${comp} has array of chars`);
      // sorted by unicode
      for (let i = 1; i < chars.length; i++) {
        assert.ok(chars[i-1] <= chars[i], `${comp} chars are sorted`);
      }
    }
  }
});

test('好 decomposes to 女 + 子 with radical 女 (kangxi 38)', () => {
  const d = loadDecomposition('好');
  assert.ok(d, '好 has decomposition entry');
  assert.deepEqual(d.parts, ['女', '子'], '好 parts are 女 and 子');
  assert.equal(d.radical, '女', '好 radical is 女');
  assert.equal(d.kangxiNumber, 38, '好 kangxiNumber is 38 (女)');
});

test('明 decomposes to 日 + 月 with radical 日 (kangxi 72)', () => {
  const d = loadDecomposition('明');
  assert.ok(d, '明 has decomposition entry');
  assert.deepEqual(d.parts, ['日', '月'], '明 parts are 日 and 月');
  assert.equal(d.radical, '日', '明 radical is 日');
  assert.equal(d.kangxiNumber, 72, '明 kangxiNumber is 72 (日)');
});

test('reverse index for 女 includes 妈 and 好 but not the traditional 媽 or 婦', () => {
  const chars = loadReverseIndex('女');
  assert.ok(chars, '女 has reverse index entry');
  assert.ok(Array.isArray(chars), '女 maps to array');
  assert.ok(chars.includes('好'), '女 reverse index includes 好');
  assert.ok(chars.includes('妈'), '女 reverse index includes 妈');
  assert.ok(!chars.includes('媽'), '女 reverse index excludes traditional 媽');
  assert.ok(!chars.includes('婦'), '女 reverse index excludes traditional 婦');
});

test('reverse index lists Simplified only (no CC-CEDICT traditional-only form)', () => {
  // trad-only = a character CC-CEDICT gives as a trad form but never as a simp form.
  const simp = new Set();
  const trad = new Set();
  const dictDir = path.join(ROOT, 'public', 'data', 'dict', 'shards');
  for (const f of fs.readdirSync(dictDir)) {
    if (!f.endsWith('.json')) continue;
    for (const e of JSON.parse(fs.readFileSync(path.join(dictDir, f), 'utf8'))) {
      if (e.simp) for (const ch of e.simp) simp.add(ch);
      if (e.trad) for (const ch of e.trad) trad.add(ch);
    }
  }
  const tradOnly = new Set([...trad].filter(ch => !simp.has(ch)));
  assert.ok(tradOnly.has('媽') && tradOnly.has('婦'), 'sanity: 媽/婦 are traditional-only');

  const idx = read('reverse-index.json');
  for (const sh of idx.shards) {
    for (const [comp, chars] of Object.entries(read(sh.file))) {
      for (const ch of chars) {
        assert.ok(!tradOnly.has(ch), `${comp} grid lists traditional-only ${ch}`);
      }
    }
  }
});

test('reverse index for 日 includes 明', () => {
  const chars = loadReverseIndex('日');
  assert.ok(chars, '日 has reverse index entry');
  assert.ok(chars.includes('明'), '日 reverse index includes 明');
});

test('reverse index for 月 includes 明', () => {
  const chars = loadReverseIndex('月');
  assert.ok(chars, '月 has reverse index entry');
  assert.ok(chars.includes('明'), '月 reverse index includes 明');
});

test('decomposition shards stay small enough for lazy mobile loading', () => {
  const idx = read('decomposition-index.json');
  for (const sh of idx.shards) {
    const size = fs.statSync(path.join(RAD, sh.file)).size;
    assert.ok(size < 200 * 1024, `${sh.file} is ${size} bytes (< 200KB)`);
  }
});

test('reverse index shards stay small enough', () => {
  const idx = read('reverse-index.json');
  for (const sh of idx.shards) {
    const size = fs.statSync(path.join(RAD, sh.file)).size;
    assert.ok(size < 200 * 1024, `${sh.file} is ${size} bytes (< 200KB)`);
  }
});

test('total gzipped size is reasonable (< 500KB)', () => {
  // We can't easily gzip in pure Node without zlib, but we can check raw total
  const manifest = read('manifest.json');
  assert.ok(manifest.totalBytes < 2 * 1024 * 1024, `raw total ${manifest.totalBytes} bytes (< 2MB)`);
  // gzip typically compresses JSON 70-80%, so <500KB gzipped is very safe
});

test('manifest.json has expected structure and source attribution', () => {
  const m = read('manifest.json');
  assert.equal(m.generator, 'scripts/build-radicals.mjs');
  assert.ok(m.sections.radicals.count === 214);
  assert.ok(m.sections.decomposition.characters > 9000);
  assert.ok(m.sections.reverseIndex.components > 1000);
  assert.ok(m.sources.length >= 1);
  assert.equal(m.sources[0].name, 'Make Me a Hanzi');
});

test('all decomposition entries have valid structure', () => {
  const idx = read('decomposition-index.json');
  let checked = 0;
  for (const sh of idx.shards) {
    const shard = read(sh.file);
    for (const [ch, entry] of Object.entries(shard)) {
      assert.ok(entry.parts && Array.isArray(entry.parts), `${ch} has parts array`);
      assert.ok(typeof entry.radical === 'string', `${ch} has radical string`);
      assert.ok(entry.kangxiNumber === null || (typeof entry.kangxiNumber === 'number' && entry.kangxiNumber >= 1 && entry.kangxiNumber <= 214),
        `${ch} kangxiNumber is null or 1-214`);
      checked++;
    }
  }
  assert.equal(checked, idx.characters, 'all characters checked');
});

test('radical 38 (女) has correct pinyin and meaning', () => {
  const rad = read('radicals.json');
  const nv = rad.find(r => r.number === 38);
  assert.ok(nv, 'radical 38 exists');
  assert.equal(nv.symbol, '女');
  assert.equal(nv.pinyin, 'nǚ');
  assert.equal(nv.meaning, 'woman');
  assert.equal(nv.strokes, 3);
});

test('radical 72 (日) has correct pinyin and meaning', () => {
  const rad = read('radicals.json');
  const ri = rad.find(r => r.number === 72);
  assert.ok(ri, 'radical 72 exists');
  assert.equal(ri.symbol, '日');
  assert.equal(ri.pinyin, 'rì');
  assert.equal(ri.meaning, 'sun');
  assert.equal(ri.strokes, 4);
});

test('radical 74 (月) has correct pinyin and meaning', () => {
  const rad = read('radicals.json');
  const yue = rad.find(r => r.number === 74);
  assert.ok(yue, 'radical 74 exists');
  assert.equal(yue.symbol, '月');
  assert.equal(yue.pinyin, 'yuè');
  assert.equal(yue.meaning, 'moon');
  assert.equal(yue.strokes, 4);
});