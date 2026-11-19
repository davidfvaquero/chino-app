// Tests for the reading area — pure logic (model.js) + data loading against the
// real JSON in public/data/readings/hsk1. No browser, no network: fetch is
// stubbed with fs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  hasHanzi,
  normalizeReading,
  tokenizeLine,
  wordPanel,
  reviewEntryFrom,
} from '../src/reading/model.js';
import { loadIndex, loadReading } from '../src/reading/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');

async function fileFetch(url) {
  const rel = url.replace(/^\/data\//, '');
  const text = await fs.promises.readFile(path.join(DATA, rel), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
}

const fakeSegment = async (text) => String(text).match(/[\u3400-\u9fff]+|[^\u3400-\u9fff]+/g) ?? [];

// ---------------------------------------------------------------- model

test('hasHanzi detects hanzi runs, ignores punctuation and latin', () => {
  assert.equal(hasHanzi('你好'), true);
  assert.equal(hasHanzi('！'), false);
  assert.equal(hasHanzi('abc 123'), false);
  assert.equal(hasHanzi(''), false);
});

test('normalizeReading fills defaults and keeps the line shape', () => {
  const r = normalizeReading({
    id: 'x',
    title: 'T',
    lines: [{ hanzi: '你好' }, { speaker: 'A', hanzi: '再见', pinyin: 'zàijiàn', english: 'bye' }],
  });
  assert.equal(r.type, 'text'); // missing type -> text
  assert.equal(r.topic, '');
  assert.equal(r.lines.length, 2);
  assert.deepEqual(r.lines[0], { speaker: '', hanzi: '你好', pinyin: '', english: '' });
  assert.equal(r.lines[1].speaker, 'A');
});

test('normalizeReading keeps dialogue and tolerates a missing lines array', () => {
  assert.equal(normalizeReading({ type: 'dialogue' }).type, 'dialogue');
  assert.equal(normalizeReading({ type: 'video' }).type, 'text'); // only dialogue is special
  assert.deepEqual(normalizeReading({}).lines, []);
});

test('tokenizeLine marks hanzi tokens as tappable words, punctuation as plain', async () => {
  const tokens = await tokenizeLine('你好！abc', fakeSegment);
  assert.deepEqual(tokens, [
    { text: '你好', word: true },
    { text: '！abc', word: false },
  ]);
  assert.equal(tokens.find((tk) => tk.text === '你好').word, true);
});

test('wordPanel: no entry -> not found, entry -> pinyin + defs', () => {
  assert.deepEqual(wordPanel('你好', null), { hanzi: '你好', found: false, pinyin: '', english: [] });
  const vm = wordPanel('你好', {
    id: 42,
    simp: '你好',
    trad: '你好',
    pinyinTone: 'nǐ hǎo',
    pinyinNum: 'ni3 hao3',
    defs: ['hello', 'hi'],
  });
  assert.equal(vm.found, true);
  assert.equal(vm.pinyin, 'nǐ hǎo');
  assert.deepEqual(vm.english, ['hello', 'hi']);
});

test('reviewEntryFrom maps a dictionary entry to the srs.addToReview shape', () => {
  const entry = {
    id: 7,
    simp: '再见',
    trad: '再見',
    pinyinTone: 'zàijiàn',
    pinyinNum: 'zai4 jian4',
    defs: ['goodbye'],
  };
  assert.deepEqual(reviewEntryFrom(entry, 'reading'), {
    id: 7,
    hanzi: '再见',
    trad: '再見',
    pinyin: 'zàijiàn',
    pinyinNumeric: 'zai4 jian4',
    english: ['goodbye'],
    source: 'reading',
  });
});

// ---------------------------------------------------------------- data

test('index.json lists 40 pre-defined readings with id/title/topic', async () => {
  const readings = await loadIndex({ fetch: fileFetch });
  assert.equal(readings.length, 40);
  for (const r of readings) {
    assert.match(r.id, /^reading-\d{2}$/);
    assert.ok(r.title, `missing title for ${r.id}`);
    assert.ok(r.topic, `missing topic for ${r.id}`);
  }
  // The first six are frozen: the content tasks write 07..40 around them.
  const [r1, r2, r3, r4, r5, r6] = readings;
  assert.deepEqual(
    [r1.title, r2.title, r3.title, r4.title, r5.title, r6.title],
    ['你好！', '我的家', '吃饭', '今天天气', '买东西', '我的一天'],
  );
  assert.deepEqual(
    readings.map((r) => r.id),
    Array.from({ length: 40 }, (_, i) => `reading-${String(i + 1).padStart(2, '0')}`),
  );
});

test('reading-01.json matches the schema and is a complete dialogue', async () => {
  const raw = await loadReading('reading-01', { fetch: fileFetch });
  const reading = normalizeReading(raw);
  assert.equal(reading.id, 'reading-01');
  assert.equal(reading.type, 'dialogue');
  assert.ok(reading.lines.length >= 5);
  for (const line of reading.lines) {
    assert.ok(line.speaker, 'dialogue lines carry a speaker');
    assert.ok(hasHanzi(line.hanzi), `hanzi missing: ${JSON.stringify(line)}`);
    assert.ok(line.pinyin, 'pinyin missing');
    assert.ok(line.english, 'english missing');
  }
});

test('a missing reading rejects with a clear error', async () => {
  await assert.rejects(() => loadReading('reading-99', { fetch: fileFetch }));
});
