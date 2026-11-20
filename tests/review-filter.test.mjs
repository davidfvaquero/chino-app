// Review filter tests — grouping, counts, and filtered queue behavior.
// Run with `node --test tests/review-filter.test.mjs` or `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createDeck } from '../src/srs.js';
import { memoryDriver, createStorage } from '../src/storage.js';
import { previewIntervals, intervalText, titleKey, render, queryFor, loadFilter } from '../src/screens/review.js';
import { grade, DAY_MS, newCardState, DEFAULT_EASE } from '../src/srs.js';

const T0 = 1_700_000_000_000;
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));

const flatKeys = (obj, parents = []) =>
  Object.entries(obj ?? {}).flatMap(([key, value]) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? flatKeys(value, [...parents, key])
      : [[...parents, key].join('.')],
  );

const filterShard = readJson(new URL('../src/locales/en.d/review-filter.json', import.meta.url));
const reviewShard = readJson(new URL('../src/locales/en.d/review.json', import.meta.url));
const shell = readJson(new URL('../src/locales/en.json', import.meta.url));

test('review filter shard has correct prefix and no collisions', () => {
  const own = flatKeys(filterShard);
  assert.ok(own.length > 0, 'filter shard is not empty');
  for (const key of own) {
    assert.ok(key.startsWith('reviewFilter.'), `key outside reviewFilter.* prefix: ${key}`);
  }
  const allKeys = new Set([...flatKeys(reviewShard), ...flatKeys(shell)]);
  for (const key of own) {
    assert.ok(!allKeys.has(key), `duplicate locale key: ${key}`);
  }
});

test('countDueBySource groups by source, sourceless as "unknown"', async () => {
  const deck = createDeck(createStorage(memoryDriver()));
  await deck.addToReview({ id: 'd1', simp: '一', pinyin: 'yī', english: ['one'], source: 'dictionary' }, { now: T0 });
  await deck.addToReview({ id: 'l1', simp: '二', pinyin: 'èr', english: ['two'], source: 'lesson', sourceDetail: 'lesson-01' }, { now: T0 });
  await deck.addToReview({ id: 'l2', simp: '三', pinyin: 'sān', english: ['three'], source: 'lesson', sourceDetail: 'lesson-02' }, { now: T0 });
  await deck.addToReview({ id: 'r1', simp: '四', pinyin: 'sì', english: ['four'], source: 'reading' }, { now: T0 });
  // legacy card without source
  const store = createStorage(memoryDriver());
  const deck2 = createDeck(store);
  await deck2.addToReview({ id: 'x1', simp: '五', pinyin: 'wǔ', english: ['five'], source: 'dictation' }, { now: T0 });
  await store.set('srs', 'legacy', { id: 'legacy', hanzi: '六', due: T0, source: undefined });

  const counts = await deck.countDueBySource(T0);
  assert.deepEqual(counts, { dictionary: 1, lesson: 2, reading: 1 });
});

test('getDueCards filters by source only', async () => {
  const deck = createDeck(createStorage(memoryDriver()));
  await deck.addToReview({ id: 'd1', simp: '一', pinyin: 'yī', english: ['one'], source: 'dictionary' }, { now: T0 });
  await deck.addToReview({ id: 'l1', simp: '二', pinyin: 'èr', english: ['two'], source: 'lesson', sourceDetail: 'lesson-01' }, { now: T0 });
  await deck.addToReview({ id: 'l2', simp: '三', pinyin: 'sān', english: ['three'], source: 'lesson', sourceDetail: 'lesson-02' }, { now: T0 });
  await deck.addToReview({ id: 'r1', simp: '四', pinyin: 'sì', english: ['four'], source: 'reading' }, { now: T0 });

  const dict = await deck.getDueCards({ now: T0, source: 'dictionary' });
  assert.deepEqual(dict.map(c => c.id), ['dd1'], 'only dictionary cards');

  const lessons = await deck.getDueCards({ now: T0, source: 'lesson' });
  assert.deepEqual(lessons.map(c => c.id).sort(), ['dl1', 'dl2'], 'only lesson cards');
});

test('getDueCards filters by source + sourceDetail', async () => {
  const deck = createDeck(createStorage(memoryDriver()));
  await deck.addToReview({ id: 'l1', simp: '二', pinyin: 'èr', english: ['two'], source: 'lesson', sourceDetail: 'lesson-01' }, { now: T0 });
  await deck.addToReview({ id: 'l2', simp: '三', pinyin: 'sān', english: ['three'], source: 'lesson', sourceDetail: 'lesson-02' }, { now: T0 });
  await deck.addToReview({ id: 'r1', simp: '四', pinyin: 'sì', english: ['four'], source: 'reading', sourceDetail: 'reading-01' }, { now: T0 });

  const l1 = await deck.getDueCards({ now: T0, source: 'lesson', sourceDetail: 'lesson-01' });
  assert.deepEqual(l1.map(c => c.id), ['dl1'], 'detail narrows to lesson-01');

  const r1 = await deck.getDueCards({ now: T0, source: 'reading', sourceDetail: 'reading-01' });
  assert.deepEqual(r1.map(c => c.id), ['dr1'], 'detail narrows to reading-01');
});

test('getDueCards with no source filter (default) returns all due cards', async () => {
  const deck = createDeck(createStorage(memoryDriver()));
  await deck.addToReview({ id: 'd1', simp: '一', pinyin: 'yī', english: ['one'], source: 'dictionary' }, { now: T0 });
  await deck.addToReview({ id: 'l1', simp: '二', pinyin: 'èr', english: ['two'], source: 'lesson' }, { now: T0 });
  await deck.addToReview({ id: 'r1', simp: '三', pinyin: 'sān', english: ['three'], source: 'reading' }, { now: T0 });

  const all = await deck.getDueCards(T0); // legacy call
  assert.deepEqual(all.map(c => c.id).sort(), ['dd1', 'dl1', 'dr1'], 'legacy call returns all');

  const all2 = await deck.getDueCards({ now: T0 }); // no source = all
  assert.deepEqual(all2.map(c => c.id).sort(), ['dd1', 'dl1', 'dr1'], 'no source filter returns all');
});

test('filter: seed 3 sources, filter by one, only those appear', async () => {
  const deck = createDeck(createStorage(memoryDriver()));
  // dictionary
  await deck.addToReview({ id: 'd1', simp: '一', pinyin: 'yī', english: ['one'], source: 'dictionary' }, { now: T0 });
  await deck.addToReview({ id: 'd2', simp: '二', pinyin: 'èr', english: ['two'], source: 'dictionary' }, { now: T0 });
  // lesson
  await deck.addToReview({ id: 'l1', simp: '三', pinyin: 'sān', english: ['three'], source: 'lesson', sourceDetail: 'lesson-01' }, { now: T0 });
  // reading
  await deck.addToReview({ id: 'r1', simp: '四', pinyin: 'sì', english: ['four'], source: 'reading', sourceDetail: 'reading-01' }, { now: T0 });

  // filter by lesson
  const lessonCards = await deck.getDueCards({ now: T0, source: 'lesson' });
  assert.equal(lessonCards.length, 1, 'only 1 lesson card');
  assert.equal(lessonCards[0].id, 'dl1');

  // filter by reading
  const readingCards = await deck.getDueCards({ now: T0, source: 'reading' });
  assert.equal(readingCards.length, 1, 'only 1 reading card');
  assert.equal(readingCards[0].id, 'dr1');

  // filter by dictionary
  const dictCards = await deck.getDueCards({ now: T0, source: 'dictionary' });
  assert.equal(dictCards.length, 2, '2 dictionary cards');
  assert.deepEqual(dictCards.map(c => c.id).sort(), ['dd1', 'dd2']);
});

test('filter: "all" still returns everything', async () => {
  const deck = createDeck(createStorage(memoryDriver()));
  await deck.addToReview({ id: 'd1', simp: '一', pinyin: 'yī', english: ['one'], source: 'dictionary' }, { now: T0 });
  await deck.addToReview({ id: 'l1', simp: '二', pinyin: 'èr', english: ['two'], source: 'lesson' }, { now: T0 });
  await deck.addToReview({ id: 'r1', simp: '三', pinyin: 'sān', english: ['three'], source: 'reading' }, { now: T0 });

  const all = await deck.getDueCards({ now: T0 }); // no filter = all
  assert.equal(all.length, 3, 'all returns 3 cards');
});

test('filter: empty group shows friendly empty state (no cards)', async () => {
  const deck = createDeck(createStorage(memoryDriver()));
  await deck.addToReview({ id: 'd1', simp: '一', pinyin: 'yī', english: ['one'], source: 'dictionary' }, { now: T0 });

  const themes = await deck.getDueCards({ now: T0, source: 'theme' });
  assert.equal(themes.length, 0, 'no theme cards');
});

test('loadFilter: null until the user chooses, then the remembered choice', async () => {
  const { default: storage } = await import('../src/storage.js');
  assert.equal(await loadFilter(), null, 'unset by default -> picker is shown');
  await storage.set('settings', 'reviewFilter', { source: 'lesson' });
  assert.deepEqual(await loadFilter(), { source: 'lesson' });
  await storage.set('settings', 'reviewFilter', 'garbage');
  assert.equal(await loadFilter(), null, 'invalid value -> unset');
});

test('queryFor: chosen source feeds getDueCards, "all" does not restrict', async () => {
  const deck = createDeck(createStorage(memoryDriver()));
  await deck.addToReview({ id: 'd1', simp: '一', pinyin: 'yī', english: ['one'], source: 'dictionary' }, { now: T0 });
  const lessonWords = [['l1', '二', 'èr'], ['l2', '三', 'sān'], ['l3', '四', 'sì']];
  for (const [id, simp, pinyin] of lessonWords) {
    await deck.addToReview({ id, simp, pinyin, english: ['two'], source: 'lesson', sourceDetail: `lesson-${id}` }, { now: T0 });
  }
  assert.deepEqual(queryFor({ source: 'all' }, T0), { now: T0 });
  assert.deepEqual(queryFor({ source: 'lesson' }, T0), { now: T0, source: 'lesson' });
  assert.equal((await deck.getDueCards(queryFor({ source: 'lesson' }, T0))).length, 3);
  assert.equal((await deck.getDueCards(queryFor({ source: 'all' }, T0))).length, 4);
  assert.equal((await deck.getDueCards(queryFor({ source: 'theme' }, T0))).length, 0, 'empty group');
});

test('review-filter shards (en + es): empty body has no stale {source} placeholder, same keys', () => {
  const es = readJson(new URL('../src/locales/es.d/review-filter.json', import.meta.url));
  assert.deepEqual(flatKeys(es).sort(), flatKeys(filterShard).sort());
  for (const shard of [filterShard, es]) {
    assert.ok(!/\{source\}/.test(shard.reviewFilter.empty.body), 'no {source} left in empty body');
    assert.ok(shard.reviewFilter.empty.body.length > 10);
  }
});

test('es grammar index: every pattern has a file and matches the en index', () => {
  const en = readJson(new URL('../public/data/grammar/index.json', import.meta.url));
  const es = readJson(new URL('../public/data/es/grammar/index.json', import.meta.url));
  assert.equal(es.patterns.length, 15);
  assert.deepEqual(
    es.patterns.map((p) => [p.id, p.file]),
    en.patterns.map((p) => [p.id, p.file]),
  );
});

test('public/data/es/files.json exists (no 404 probe) and lists every es file', async () => {
  const { readdirSync } = await import('node:fs');
  const root = new URL('../public/data/es/', import.meta.url);
  const walk = (dir, prefix = '') =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(new URL(`${e.name}/`, dir), `${prefix}${e.name}/`)
        : e.name.endsWith('.json') && prefix + e.name !== 'files.json' ? [prefix + e.name] : [],
    );
  assert.deepEqual(readJson(new URL('files.json', root)), walk(root).sort());
});

test('module keeps the screen contract', () => {
  assert.equal(titleKey, 'screens.review.title');
  assert.equal(typeof render, 'function');
});

test('previewIntervals and intervalText still work (regression)', () => {
  const card = { id: 'x你|ni', hanzi: '你', pinyin: 'nǐ', english: ['you'], ...newCardState(T0) };
  assert.deepEqual(previewIntervals(card, T0), { again: 1, hard: 1, good: 1, easy: 1 });
  assert.deepEqual(intervalText(1), { key: 'review.interval.days', params: { n: 1 } });
  assert.deepEqual(intervalText(30), { key: 'review.interval.months', params: { n: 1 } });
  assert.deepEqual(intervalText(365), { key: 'review.interval.years', params: { n: 1 } });
});