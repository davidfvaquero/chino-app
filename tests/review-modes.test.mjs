// Review card modes: pinyin answer grading, the "only my mistakes" filter and
// the mode shard. Browser-free (the DOM flow is checked in headless Chrome).
// Run with `node --test tests/review-modes.test.mjs` or `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  REVIEW_MODES,
  DEFAULT_REVIEW_MODE,
  MODE_KEY,
  LOW_EASE,
  normalizeMode,
  comparePinyin,
  isMistakeCard,
  filterMistakes,
  titleKey,
  render,
} from '../src/screens/review.js';
import { createDeck, newCardState, DEFAULT_EASE, DAY_MS } from '../src/srs.js';
import { memoryDriver, createStorage } from '../src/storage.js';

const T0 = 1_700_000_000_000;
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));

const flatKeys = (obj, parents = []) =>
  Object.entries(obj ?? {}).flatMap(([key, value]) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? flatKeys(value, [...parents, key])
      : [[...parents, key].join('.')],
  );

const en = readJson(new URL('../src/locales/en.d/review-modes.json', import.meta.url));
const es = readJson(new URL('../src/locales/es.d/review-modes.json', import.meta.url));
const reviewShard = readJson(new URL('../src/locales/en.d/review.json', import.meta.url));
const filterShard = readJson(new URL('../src/locales/en.d/review-filter.json', import.meta.url));
const shell = readJson(new URL('../src/locales/en.json', import.meta.url));

test('module keeps the screen contract', () => {
  assert.equal(titleKey, 'screens.review.title');
  assert.equal(typeof render, 'function');
});

test('mode constants: classic is the default, four modes, one settings key', () => {
  assert.equal(DEFAULT_REVIEW_MODE, 'classic');
  assert.deepEqual(REVIEW_MODES, ['classic', 'reverse', 'pinyin', 'mistakes']);
  assert.equal(MODE_KEY, 'reviewMode');
});

test('normalizeMode accepts the four modes and falls back to classic', () => {
  for (const mode of REVIEW_MODES) assert.equal(normalizeMode(mode), mode);
  assert.equal(normalizeMode('bogus'), 'classic');
  assert.equal(normalizeMode(undefined), 'classic');
  assert.equal(normalizeMode(null), 'classic');
  assert.equal(normalizeMode(''), 'classic');
});

test('comparePinyin: tone numbers, tone marks and plain all match', () => {
  for (const input of ['ni3', 'nǐ', 'ni', 'NI', ' Nǐ ', 'ni3 '.trim()]) {
    const { match } = comparePinyin(input, 'nǐ');
    assert.equal(match, true, `"${input}" should match "nǐ"`);
  }
  // marks vs numbers compare tone-for-tone
  assert.deepEqual(comparePinyin('ni3', 'nǐ'), { match: true, toneMatch: true });
  assert.deepEqual(comparePinyin('nǐ', 'ni3'), { match: true, toneMatch: true });
  assert.deepEqual(comparePinyin('NI3', 'nǐ'), { match: true, toneMatch: true });
});

test('comparePinyin: plain letters match but flag the missing tone', () => {
  assert.deepEqual(comparePinyin('ni', 'nǐ'), { match: true, toneMatch: false });
  assert.deepEqual(comparePinyin('nihao', 'nǐ hǎo'), { match: true, toneMatch: false });
});

test('comparePinyin: spaces and capitals are ignored, order is not', () => {
  assert.equal(comparePinyin('  ni   hao  ', 'nǐ hǎo').match, true);
  assert.equal(comparePinyin('Ni Hao', 'nǐ hǎo').match, true);
  assert.equal(comparePinyin('hao ni', 'nǐ hǎo').match, false, 'word order matters');
});

test('comparePinyin: wrong letters and empty input never match', () => {
  assert.equal(comparePinyin('ma', 'nǐ').match, false);
  assert.equal(comparePinyin('nihao', 'nǐ').match, false);
  assert.equal(comparePinyin('', 'nǐ').match, false);
  assert.equal(comparePinyin('ni', '').match, false, 'a card with no reading cannot match');
  assert.equal(comparePinyin(undefined, 'nǐ').match, false);
});

test('comparePinyin: multi-syllable tone numbers line up', () => {
  assert.deepEqual(comparePinyin('ni3 hao3', 'nǐ hǎo'), { match: true, toneMatch: true });
  assert.deepEqual(comparePinyin('ni3 hao4', 'nǐ hǎo'), { match: true, toneMatch: false });
});

test('comparePinyin: ü and v are the same letter', () => {
  assert.equal(comparePinyin('lv4', 'lǜ').match, true);
  assert.equal(comparePinyin('lü', 'lǜ').match, true);
});

test('isMistakeCard: a lapse or a low ease counts, a healthy card does not', () => {
  assert.equal(LOW_EASE, 2);
  assert.equal(isMistakeCard({ lapses: 1, ease: 2.5 }), true, 'lapsed card');
  assert.equal(isMistakeCard({ lapses: 0, ease: 1.7 }), true, 'ease below the floor');
  assert.equal(isMistakeCard({ lapses: 0, ease: 1.99 }), true, 'just below the floor');
  assert.equal(isMistakeCard({ lapses: 0, ease: 2 }), false, 'at the floor is fine');
  assert.equal(isMistakeCard({ lapses: 0, ease: DEFAULT_EASE }), false, 'a brand-new card is not a mistake');
  assert.equal(isMistakeCard({ ...newCardState(T0) }), false, 'the default state is not a mistake');
  assert.equal(isMistakeCard({ lapses: 0 }), false, 'missing ease falls back to the default');
  assert.equal(isMistakeCard(null), false);
});

test('filterMistakes keeps only the lapsed / low-ease cards, in order', () => {
  const cards = [
    { id: 'a', lapses: 0, ease: 2.5 },
    { id: 'b', lapses: 2, ease: 1.6 },
    { id: 'c', lapses: 0, ease: 2.4 },
    { id: 'd', lapses: 1, ease: 2.5 },
  ];
  assert.deepEqual(filterMistakes(cards).map((c) => c.id), ['b', 'd']);
  assert.deepEqual(filterMistakes([]), []);
  assert.deepEqual(filterMistakes(undefined), []);
});

test('mistakes mode composes with the deck: seed, grade, then filter', async () => {
  const deck = createDeck(createStorage(memoryDriver()));
  await deck.addToReview({ id: 'n1', simp: '你', pinyin: 'nǐ', english: ['you'], source: 'dictionary' }, { now: T0 });
  await deck.addToReview({ id: 'n2', simp: '好', pinyin: 'hǎo', english: ['good'], source: 'dictionary' }, { now: T0 });
  await deck.addToReview({ id: 'n3', simp: '学', pinyin: 'xué', english: ['study'], source: 'lesson' }, { now: T0 });

  // Fail one card twice -> lapses > 0; keep one healthy; grade one "hard" twice.
  await deck.answer('dn1', 'again', T0);
  await deck.answer('dn1', 'again', T0 + DAY_MS);
  await deck.answer('dn2', 'hard', T0);
  await deck.answer('dn2', 'hard', T0 + DAY_MS);

  const due = await deck.getDueCards({ now: T0 + 10 * DAY_MS });
  const mistakes = filterMistakes(due).map((c) => c.id);
  assert.ok(mistakes.includes('dn1'), 'the lapsed card is a mistake');
  assert.ok(!mistakes.includes('dn3'), 'the untouched card is not');
  for (const card of filterMistakes(due)) {
    assert.ok(card.lapses > 0 || card.ease < LOW_EASE, `${card.id} qualifies`);
  }
});

test('review-modes shards (en + es): same keys, reviewMode.* prefix, no collisions', () => {
  const enKeys = flatKeys(en).sort();
  const esKeys = flatKeys(es).sort();
  assert.deepEqual(esKeys, enKeys, 'es mirrors en exactly');
  assert.ok(enKeys.length > 0);
  for (const key of enKeys) assert.ok(key.startsWith('reviewMode.'), `key outside reviewMode.*: ${key}`);
  const others = new Set([...flatKeys(reviewShard), ...flatKeys(filterShard), ...flatKeys(shell)]);
  for (const key of enKeys) assert.ok(!others.has(key), `duplicate locale key: ${key}`);
});

test('every key the screen reads exists in the shard (label, modes, feedback)', () => {
  const available = new Set(flatKeys(en));
  const keys = [
    'reviewMode.label',
    'reviewMode.answerLabel',
    'reviewMode.answerPlaceholder',
    'reviewMode.check',
    'reviewMode.correct',
    'reviewMode.close',
    'reviewMode.wrong',
    'reviewMode.suggested',
    ...REVIEW_MODES.map((mode) => `reviewMode.mode.${mode}`),
  ];
  for (const key of keys) assert.ok(available.has(key), `missing locale key: ${key}`);
});

test('suggested label keeps its {rating} placeholder in both languages', () => {
  assert.match(en.reviewMode.suggested, /\{rating\}/);
  assert.match(es.reviewMode.suggested, /\{rating\}/);
});
