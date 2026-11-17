// Tests for src/dictionary.js — runs offline in Node against the real JSON in
// public/data/dict (no browser, no network: fetch is stubbed with fs).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  search,
  lookup,
  segment,
  detectType,
  configure,
  resetCache,
} from '../src/dictionary.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');

let calls = [];
async function fileFetch(url) {
  calls.push(url);
  const rel = url.replace(/^\/data\//, '');
  const text = await fs.promises.readFile(path.join(DATA, rel), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
}

before(() => configure({ fetch: fileFetch }));

const expected = {
  simp: '你好',
  trad: '你好',
  pinyinTone: 'nǐ hǎo',
  pinyinNum: 'ni3 hao3',
};

test('detectType separates hanzi / pinyin / latin', () => {
  assert.equal(detectType('你好'), 'hanzi');
  assert.equal(detectType('謝謝'), 'hanzi');
  assert.equal(detectType('nǐ hǎo'), 'pinyin');
  assert.equal(detectType('ni3hao3'), 'pinyin');
  assert.equal(detectType('ni hao'), 'latin'); // decided against the pinyin index
  assert.equal(detectType('hello'), 'latin');
});

test('"hello" finds 你好 among the top results', async () => {
  const res = await search('hello');
  assert.ok(res.length > 0);
  const toks = res.slice(0, 5).map((r) => r.simp);
  assert.ok(toks.includes(expected.simp), `expected 你好 in ${toks.join(',')}`);
});

test('pinyin: "ni hao", "nǐ hǎo" and "ni3hao3" all return 你好 first', async () => {
  for (const q of ['ni hao', 'nǐ hǎo', 'ni3hao3', 'Ni Hao']) {
    const res = await search(q);
    assert.ok(res.length > 0, `no results for ${q}`);
    assert.equal(res[0].simp, expected.simp, `${q} -> ${res[0].simp}`);
    assert.equal(res[0].pinyinTone, expected.pinyinTone);
    assert.equal(res[0].pinyinNum, expected.pinyinNum);
    assert.ok(res[0].defs.length > 0);
  }
});

test('hanzi: 你好 returns the entry with both pinyin forms', async () => {
  const res = await search('你好');
  assert.ok(res.length > 0);
  const hit = res.find((r) => r.simp === expected.simp);
  assert.ok(hit);
  assert.equal(hit.trad, expected.trad);
  assert.equal(hit.pinyinTone, expected.pinyinTone);
  assert.equal(hit.pinyinNum, expected.pinyinNum);
  assert.ok(Array.isArray(hit.defs));
});

test('hanzi: traditional 謝謝 returns the traditional entry', async () => {
  const res = await search('謝謝');
  assert.ok(res.length > 0);
  assert.equal(res[0].trad, '謝謝');
  assert.equal(res[0].simp, '谢谢');
});

test('lookup() is exact and returns null for unknown words', async () => {
  const hit = await lookup('你好');
  assert.ok(hit);
  assert.equal(hit.simp, '你好');
  assert.equal(hit.pinyinNum, expected.pinyinNum);
  assert.equal(await lookup('你你你'), null);
});

test('limit caps the number of results', async () => {
  const all = await search('shi', { limit: 5 });
  assert.ok(all.length <= 5);
  const one = await search('shi', { limit: 1 });
  assert.equal(one.length, 1);
});

test("segment('我喜欢学习中文') splits into sensible words", async () => {
  const parts = await segment('我喜欢学习中文');
  assert.deepEqual(parts, ['我', '喜欢', '学习', '中文']);
});

test('segment keeps non-hanzi text as its own chunks', async () => {
  const parts = await segment('我ok好');
  assert.deepEqual(parts, ['我', 'ok', '好']);
});

test('a search loads only the shards it needs, and caches them', async () => {
  resetCache();
  calls = [];
  await search('hello');
  const firstCount = calls.length;
  assert.ok(firstCount > 1, 'expected index + shards');
  assert.ok(firstCount <= 10, `expected <=10 fetches, got ${firstCount} of 115 shards`);
  assert.equal(new Set(calls).size, calls.length, 'no duplicate fetches');

  calls = [];
  const again = await search('hello');
  assert.equal(calls.length, 0, 'second search hits the cache');
  assert.ok(again.length > 0);
});