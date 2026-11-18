// Review screen (browser-free parts): interval previews, interval labels and
// locale-shard coverage. The DOM flow itself is checked in headless Chrome.
// Run with `node --test tests/review-screen.test.mjs` or `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { previewIntervals, intervalText, titleKey, render } from '../src/screens/review.js';
import { grade, DAY_MS, newCardState, DEFAULT_EASE } from '../src/srs.js';

const T0 = 1_700_000_000_000;
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));

const flatKeys = (obj, parents = []) =>
  Object.entries(obj ?? {}).flatMap(([key, value]) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? flatKeys(value, [...parents, key])
      : [[...parents, key].join('.')],
  );

const shard = readJson(new URL('../src/locales/en.d/review.json', import.meta.url));
const filterShard = readJson(new URL('../src/locales/en.d/review-filter.json', import.meta.url));
const shell = readJson(new URL('../src/locales/en.json', import.meta.url));

test('module keeps the screen contract', () => {
  assert.equal(titleKey, 'screens.review.title');
  assert.equal(typeof render, 'function');
});

test('a brand new card shows the same 1-day interval for every rating', () => {
  const card = {
    id: 'x你|ni',
    hanzi: '你',
    pinyin: 'nǐ',
    english: ['you'],
    ...newCardState(T0),
  };
  assert.deepEqual(previewIntervals(card, T0), { again: 1, hard: 1, good: 1, easy: 1 });
});

test('a mature card previews Again < Hard < Good < Easy', () => {
  const card = { id: 'd1', hanzi: '学', ease: DEFAULT_EASE, reps: 2, interval: 6, due: T0 };
  const preview = previewIntervals(card, T0);
  for (const rating of ['again', 'hard', 'good', 'easy']) {
    assert.equal(preview[rating], grade(card, rating, T0).interval, `${rating} matches the scheduler`);
  }
  assert.ok(preview.again < preview.hard, 'again restarts the ladder');
  assert.ok(preview.hard < preview.good, 'hard is shorter than good');
  assert.ok(preview.good < preview.easy, 'easy is longer than good');
});

test('previewIntervals does not mutate the card', () => {
  const card = { id: 'd2', hanzi: '好', ease: DEFAULT_EASE, reps: 3, interval: 15, due: T0 };
  const before = structuredClone(card);
  previewIntervals(card, T0 + 5 * DAY_MS);
  assert.deepEqual(card, before);
});

test('intervalText picks days / months / years and never goes below 1', () => {
  assert.deepEqual(intervalText(1), { key: 'review.interval.days', params: { n: 1 } });
  assert.deepEqual(intervalText(29), { key: 'review.interval.days', params: { n: 29 } });
  assert.deepEqual(intervalText(30), { key: 'review.interval.months', params: { n: 1 } });
  assert.deepEqual(intervalText(45), { key: 'review.interval.months', params: { n: 2 } });
  assert.deepEqual(intervalText(365), { key: 'review.interval.years', params: { n: 1 } });
  assert.deepEqual(intervalText(730), { key: 'review.interval.years', params: { n: 2 } });
  assert.deepEqual(intervalText(0), { key: 'review.interval.days', params: { n: 1 } });
  assert.deepEqual(intervalText(undefined), { key: 'review.interval.days', params: { n: 1 } });
});

test('every static text key used by the screen exists in the shard', () => {
  const source = readFileSync(new URL('../src/screens/review.js', import.meta.url), 'utf8');
  const staticKeys = [...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1]);
  assert.ok(staticKeys.length > 0, 'the screen reads its texts from i18n');
  const available = new Set(flatKeys(shard).concat(flatKeys(filterShard)).concat(flatKeys(shell)));
  for (const key of staticKeys) {
    assert.ok(available.has(key), `missing locale key: ${key}`);
  }
  // the rating labels are built from a template, so check all four by hand
  for (const rating of ['again', 'hard', 'good', 'easy']) {
    assert.ok(available.has(`review.ratings.${rating}`), `missing rating label: ${rating}`);
  }
});

test('the review shard only owns review.* keys and collides with nothing', () => {
  const own = flatKeys(shard);
  assert.ok(own.length > 0);
  for (const key of own) {
    assert.ok(key.startsWith('review.'), `key outside the review.* prefix: ${key}`);
  }
  const shellKeys = new Set(flatKeys(shell));
  for (const key of own) {
    assert.ok(!shellKeys.has(key), `duplicate locale key also in en.json: ${key}`);
  }
});