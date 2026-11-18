// Sanity tests for the generated data in public/data/.
// Run with `npm test` (node --test tests/) or `node --test tests/data-sanity.test.mjs`.
//
// These are pure Node tests: no network, no browser. They assert the data is
// valid JSON, the shards stay small (mobile-friendliness), and that the lookup
// indices actually find things — e.g. searching 你好 and "hello".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tonelessKey } from '../scripts/lib/pinyin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const read = (p) => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'));
const dictShard = (i) => read(path.join('dict', 'shards', String(i).padStart(3, '0') + '.json'));

// --- helpers that mimic what the app's dictionary module will do -------------

function searchHanzi(q) {
  const idx = read('dict/index-hanzi.json').chars;
  const shards = new Set([...(idx[q[0]] || []), ...(read('dict/index-hanzi-trad.json').chars[q[0]] || [])]);
  const out = [];
  for (const s of shards) for (const e of dictShard(s)) if (e.simp.startsWith(q) || e.trad.startsWith(q)) out.push(e);
  return out;
}

function searchPinyin(q) {
  const letters = read('dict/index-pinyin/' + (tonelessKey(q)[0] || '_') + '.json');
  const keys = [tonelessKey(q)];
  const shards = new Set();
  for (const k of keys) for (const s of letters[k] || []) shards.add(s);
  const out = [];
  for (const s of shards) for (const e of dictShard(s)) if (tonelessKey(e.pinyinNumeric) === keys[0]) out.push(e);
  return out;
}

function searchEnglish(word) {
  const letters = read('dict/index-english/' + (word[0] || '_') + '.json');
  const shards = new Set(letters[word.toLowerCase()] || []);
  const out = [];
  for (const s of shards) {
    for (const e of dictShard(s)) {
      if (e.defs.some((d) => new RegExp(`\\b${word}\\b`, 'i').test(d))) out.push(e);
    }
  }
  return out;
}

// --- tests -------------------------------------------------------------------

test('manifest and every shard are valid JSON', () => {
  const m = read('manifest.json');
  assert.equal(m.generator, 'scripts/build-data.mjs');
  assert.ok(m.sections.dict.entries > 100000, 'dictionary has >100k entries');
  assert.ok(m.totalBytes > 0);

  const files = read('files.json');
  assert.ok(files.length > 100);
  let checked = 0;
  for (const f of files) {
    if (!f.file.endsWith('.json')) continue;
    JSON.parse(fs.readFileSync(path.join(DATA, f.file), 'utf8')); // throws if invalid
    checked++;
  }
  assert.equal(checked, files.filter((f) => f.file.endsWith('.json')).length);
});

test('dictionary shards stay small enough for lazy mobile loading', () => {
  const dictManifest = read('dict/manifest.json');
  for (const f of dictManifest.shardFiles) {
    const size = fs.statSync(path.join(DATA, 'dict', f)).size;
    assert.ok(size < 200 * 1024, `${f} is ${size} bytes (< 200KB)`);
  }
  const strokes = read('strokes/index.json');
  for (const f of strokes.shardFiles) {
    const size = fs.statSync(path.join(DATA, 'strokes', f)).size;
    assert.ok(size < 200 * 1024, `${f} is ${size} bytes (< 200KB)`);
  }
});

test("search 你好 by hanzi returns the entry", () => {
  const hits = searchHanzi('你好');
  assert.ok(hits.length >= 1, 'found at least one 你好 entry');
  const e = hits.find((x) => x.simp === '你好');
  assert.ok(e, 'exact 你好 entry present');
  assert.equal(e.trad, '你好');
  assert.equal(e.pinyin, 'nǐ hǎo');
  assert.equal(e.pinyinNumeric, 'ni3 hao3');
  assert.ok(e.defs.some((d) => /hello/i.test(d) || /\bhi\b/i.test(d)), 'def mentions hello/hi');
});

test('search "hello" in the English index returns 你好', () => {
  const hits = searchEnglish('hello');
  assert.ok(hits.length > 0, 'english search returns results');
  assert.ok(hits.some((e) => e.simp === '你好'), '你好 is among the "hello" results');
});

test('search by pinyin (with and without tones) returns 你好', () => {
  for (const q of ['ni hao', 'nihao', 'ni3 hao3', 'nǐ hǎo', 'Ni Hao']) {
    const hits = searchPinyin(q);
    assert.ok(hits.some((e) => e.simp === '你好'), `pinyin "${q}" finds 你好`);
  }
});

test('stroke data is present for 你好 and hanzi-writer compatible', () => {
  const idx = read('strokes/index.json');
  assert.ok(idx.characters > 9000);
  for (const ch of ['你', '好', '我']) {
    assert.ok(ch in idx.lookup, `${ch} has stroke data`);
    const shard = read(path.join('strokes', 'shards', String(idx.lookup[ch]).padStart(3, '0') + '.json'));
    const entry = shard.find((c) => c.character === ch);
    assert.ok(entry, `${ch} entry in shard`);
    assert.ok(Array.isArray(entry.strokes) && entry.strokes.length > 0, `${ch} has SVG strokes`);
    assert.ok(Array.isArray(entry.medians) && entry.medians.length > 0, `${ch} has medians (drawing recognition)`);
    assert.ok(entry.medians.every((m) => Array.isArray(m) && m.length && Array.isArray(m[0])));
  }
});

test('HSK levels 1-6 are present with the expected shape', () => {
  const idx = read('hsk/index.json');
  assert.equal(idx.levels.length, 6);
  assert.equal(read('hsk/1.json').items.length, 150, 'HSK1 has 150 words');
  for (let lv = 1; lv <= 6; lv++) {
    const level = read(`hsk/${lv}.json`);
    assert.equal(level.level, lv);
    assert.ok(level.items.length > 100);
    for (const it of level.items.slice(0, 20)) {
      assert.ok(it.hanzi && it.pinyin && it.english, `HSK${lv} item has hanzi/pinyin/english`);
    }
  }
});

test('HSK 2 has ~150 valid new words and no duplicates with HSK 1', () => {
  const hsk1 = read('hsk/1.json');
  const hsk2 = read('hsk/2.json');
  assert.equal(hsk2.level, 2);
  assert.ok(hsk2.items.length >= 145 && hsk2.items.length <= 155, `HSK2 has ~150 words (got ${hsk2.items.length})`);
  const hsk1Words = new Set(hsk1.items.map((it) => it.hanzi));
  const seen = new Set();
  for (const it of hsk2.items) {
    assert.equal(it.level, 2, `${it.hanzi} has level 2`);
    assert.ok(it.hanzi && it.pinyin && it.english, `${it.hanzi} has hanzi/pinyin/english`);
    assert.ok(!seen.has(it.hanzi), `${it.hanzi} is not repeated inside HSK2`);
    assert.ok(!hsk1Words.has(it.hanzi), `${it.hanzi} is not duplicated from HSK1`);
    seen.add(it.hanzi);
  }
});


test('short Tatoeba sentences have zh/pinyin/en and are <= 12 chars', () => {
  const idx = read('sentences/index.json');
  assert.ok(idx.count > 1000, 'a few thousand sentences');
  let total = 0;
  for (const sh of idx.shards) {
    const shard = read(path.join('sentences', sh.file));
    total += shard.length;
    for (const s of shard.slice(0, 50)) {
      assert.ok(s.zh && s.en, 'sentence has zh and en');
      assert.ok([...s.zh].length <= 12, `"${s.zh}" is <= 12 chars`);
      assert.equal(typeof s.pinyin, 'string');
    }
  }
  assert.equal(total, idx.count);
});
