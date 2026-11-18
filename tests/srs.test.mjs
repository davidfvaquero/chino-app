// SM-2 scheduling + review deck persistence tests.
// Run with `npm test` (node --test tests/).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  schedule,
  nextDue,
  newCardState,
  makeCard,
  cardId,
  createDeck,
  DAY_MS,
  MIN_EASE,
  DEFAULT_EASE,
} from '../src/srs.js';
import { memoryDriver, createStorage } from '../src/storage.js';

const T0 = 1_700_000_000_000;

test('good grades climb the SM-2 interval ladder', () => {
  let state = newCardState(T0);
  assert.equal(state.interval, 0);
  assert.equal(state.due, T0);

  state = schedule(state, 'good', T0);
  assert.equal(state.interval, 1, 'first good -> 1 day');
  assert.equal(state.reps, 1);
  assert.equal(state.due, T0 + DAY_MS);

  state = schedule(state, 'good', state.due);
  assert.equal(state.interval, 6, 'second good -> 6 days');
  assert.equal(state.reps, 2);

  state = schedule(state, 'good', state.due);
  assert.equal(state.interval, 15, 'third good -> round(6 * 2.5)');

  state = schedule(state, 'good', state.due);
  assert.equal(state.interval, 38, 'fourth good -> round(15 * 2.5)');
});

test('intervals grow monotonically and easy outpaces good', () => {
  let good = newCardState(T0);
  let easy = newCardState(T0);
  for (let i = 0; i < 3; i += 1) {
    good = schedule(good, 'good', T0);
    easy = schedule(easy, 'easy', T0);
  }
  assert.ok(good.interval > 6);
  assert.ok(easy.interval >= good.interval);
});

test('a failure (again) resets repetitions and bumps lapses', () => {
  let state = newCardState(T0);
  state = schedule(state, 'good', T0);
  state = schedule(state, 'good', T0);
  state = schedule(state, 'good', T0);
  assert.equal(state.reps, 3);
  assert.ok(state.interval > 1);

  const failed = schedule(state, 'again', T0);
  assert.equal(failed.reps, 0, 'repetitions reset');
  assert.equal(failed.lapses, state.lapses + 1, 'lapse counted');
  assert.equal(failed.interval, 1, 'back to a 1-day interval');
  assert.equal(failed.due, T0 + DAY_MS);
});

test('ease never drops below the SM-2 floor', () => {
  let state = newCardState(T0);
  for (let i = 0; i < 10; i += 1) state = schedule(state, 'again', T0);
  assert.equal(state.ease, MIN_EASE);
  assert.ok(state.ease >= 1.3);
});

test('hard lowers ease but still advances the card', () => {
  let state = newCardState(T0);
  state = schedule(state, 'good', T0);
  state = schedule(state, 'good', T0);
  const afterHard = schedule(state, 'hard', T0);
  assert.equal(afterHard.reps, 3);
  assert.ok(afterHard.ease < DEFAULT_EASE);
  assert.ok(afterHard.interval >= 1);
});

test('an unknown rating is rejected', () => {
  assert.throws(() => schedule(newCardState(T0), 'meh', T0), RangeError);
});

test('cardId uses the entry id, or word + reading when absent', () => {
  assert.equal(cardId({ id: 7, simp: '你好' }), 'd7');
  assert.equal(cardId({ simp: '你好', pinyinNumeric: 'ni3 hao3' }), 'x你好|ni3 hao3');
});

test('addToReview is idempotent, reschedules and persists through storage', async () => {
  const store = createStorage(memoryDriver());
  const deck = createDeck(store);
  const entry = {
    id: 42,
    simp: '你好',
    trad: '你好',
    pinyin: 'nǐ hǎo',
    pinyinNumeric: 'ni3 hao3',
    defs: ['hello', 'hi'],
  };

  const first = await deck.addToReview(entry, { now: T0 });
  assert.equal(first.created, true);
  assert.equal(first.card.interval, 0);
  assert.equal(first.card.due, T0);

  const again = await deck.addToReview(entry, { now: T0 });
  assert.equal(again.created, false, 'adding the same word twice does not duplicate');
  assert.equal((await deck.listCards()).length, 1);

  assert.equal(await deck.countDue(T0), 1, 'a new card is due right away');

  const graded = await deck.gradeCard(first.card.id, 'good', T0);
  assert.equal(graded.interval, 1);
  assert.equal(graded.reviews, 1);
  assert.equal(graded.due, T0 + DAY_MS);
  assert.equal(await deck.countDue(T0), 0, 'graded card leaves today\'s queue');
  assert.equal(await deck.countDue(T0 + DAY_MS), 1, '...and comes back tomorrow');
  assert.deepEqual(await deck.deckStats(T0), { total: 1, due: 0 });

  // Persistence: a fresh deck over the same storage sees the updated schedule.
  const reloaded = await createDeck(store).getCard(first.card.id);
  assert.equal(reloaded.interval, 1);
  assert.equal(reloaded.reviews, 1);
  assert.equal(reloaded.lastRating, 'good');

  await deck.removeCard(first.card.id);
  assert.equal((await deck.listCards()).length, 0);
});

test('gradeCard rejects an unknown card', async () => {
  const deck = createDeck(createStorage(memoryDriver()));
  await assert.rejects(() => deck.gradeCard('nope', 'good'), /unknown card/);
});

test('makeCard snapshots the entry for the review front/back', () => {
  const card = makeCard({ id: 1, simp: '水', pinyin: 'shuǐ', defs: ['water'] }, T0);
  assert.equal(card.simp, '水');
  assert.equal(card.trad, '水', 'trad defaults to simp');
  assert.deepEqual(card.defs, ['water']);
  assert.equal(card.ease, DEFAULT_EASE);
});

test('getDueCards filters by date and orders soonest first', async () => {
  const deck = createDeck(createStorage(memoryDriver()));
  await deck.addToReview({ id: 'late', simp: '晚', pinyin: 'wǎn', defs: ['late'] }, { now: T0 });
  await deck.addToReview({ id: 'mid', simp: '中', pinyin: 'zhōng', defs: ['middle'] }, { now: T0 });
  await deck.addToReview({ id: 'early', simp: '早', pinyin: 'zǎo', defs: ['early'] }, { now: T0 });
  await deck.answer('dlate', 'good', T0);
  await deck.answer('dlate', 'good', T0); // reps 2 -> 6 days
  await deck.answer('dmid', 'good', T0); // 1 day
  // 'dearly' stays due at T0.

  assert.deepEqual((await deck.getDueCards(T0)).map((c) => c.id), ['dearly']);
  assert.deepEqual((await deck.getDueCards(T0 + 2 * DAY_MS)).map((c) => c.id), ['dearly', 'dmid']);
  const all = await deck.getDueCards(T0 + 7 * DAY_MS);
  assert.deepEqual(all.map((c) => c.id), ['dearly', 'dmid', 'dlate']);
  const dues = all.map((c) => c.due);
  assert.deepEqual(dues, [...dues].sort((a, b) => a - b), 'ascending by due date');
});

test('getDueCards/answer are the primary names; dueCards/gradeCard are aliases', async () => {
  const deck = createDeck(createStorage(memoryDriver()));
  assert.equal(deck.gradeCard, deck.answer);
  const { card } = await deck.addToReview({ hanzi: '好', pinyin: 'hǎo', english: 'good' }, { now: T0 });
  assert.equal(card.source, 'dict', 'source defaults when not given');
  assert.deepEqual(card.english, ['good'], 'a plain string meaning becomes a list');
  assert.equal(await nextDue(card, 'good', T0), T0 + DAY_MS);
  await deck.answer(card.id, 'good', T0);
  assert.equal(await deck.countDue(T0), 0);
});


test('lapses: legacy card without the field counts as 0; only again adds one', async () => {
  const store = createStorage(memoryDriver());
  const deck = createDeck(store);
  const { card } = await deck.addToReview({ id: 99, simp: '难', pinyin: 'nán', english: ['hard'] }, { now: T0 });
  const { lapses, ...legacy } = card;
  await store.set('srs', card.id, legacy);
  assert.equal((await deck.answer(card.id, 'good', T0)).lapses, 0, 'good keeps 0');
  assert.equal((await deck.answer(card.id, 'again', T0)).lapses, 1);
  assert.equal((await deck.answer(card.id, 'hard', T0)).lapses, 1, 'hard is not a lapse');
  assert.equal((await deck.answer(card.id, 'again', T0)).lapses, 2);
  assert.equal((await store.get('srs', card.id)).lapses, 2, 'persisted');
});

test('getDueCards: legacy number call keeps returning every due card', async () => {
  const deck = createDeck(createStorage(memoryDriver()));
  await deck.addToReview({ id: 'a', simp: '一', pinyin: 'yī', english: ['one'], source: 'lesson' }, { now: T0 });
  await deck.addToReview({ id: 'b', simp: '二', pinyin: 'èr', english: ['two'], source: 'dict' }, { now: T0 });
  assert.deepEqual((await deck.getDueCards(T0)).map((c) => c.id), ['da', 'db']);
  assert.deepEqual((await deck.getDueCards()).map((c) => c.id), ['da', 'db'], 'no-arg call still uses now');
});

test('getDueCards: filters by source, then by source + sourceDetail', async () => {
  const deck = createDeck(createStorage(memoryDriver()));
  await deck.addToReview({ id: 'l1', simp: '三', pinyin: 'sān', english: ['three'], source: 'lesson', sourceDetail: 'lesson-01' }, { now: T0 });
  await deck.addToReview({ id: 'l2', simp: '四', pinyin: 'sì', english: ['four'], source: 'lesson', sourceDetail: 'lesson-02' }, { now: T0 });
  await deck.addToReview({ id: 'r1', simp: '五', pinyin: 'wǔ', english: ['five'], source: 'reading' }, { now: T0 });

  const lessons = await deck.getDueCards({ now: T0, source: 'lesson' });
  assert.deepEqual(lessons.map((c) => c.id), ['dl1', 'dl2'], 'only lesson cards');

  const l1 = await deck.getDueCards({ now: T0, source: 'lesson', sourceDetail: 'lesson-01' });
  assert.deepEqual(l1.map((c) => c.id), ['dl1'], 'detail narrows the source');

  assert.deepEqual((await deck.getDueCards({ source: 'reading' })).map((c) => c.id), ['dr1'], 'now defaults to Date.now()');
});

test('getDueCards: a card without a source counts as "unknown"', async () => {
  const store = createStorage(memoryDriver());
  const deck = createDeck(store);
  await store.set('srs', 'legacy', { id: 'legacy', hanzi: '六', due: T0, source: undefined });
  assert.deepEqual((await deck.getDueCards({ now: T0, source: 'unknown' })).map((c) => c.id), ['legacy']);
});

test('countDueBySource groups due cards by source, sourceless as "unknown"', async () => {
  const store = createStorage(memoryDriver());
  const deck = createDeck(store);
  await deck.addToReview({ id: 'x1', simp: '七', pinyin: 'qī', english: ['seven'], source: 'lesson' }, { now: T0 });
  await deck.addToReview({ id: 'x2', simp: '八', pinyin: 'bā', english: ['eight'], source: 'lesson' }, { now: T0 });
  await deck.addToReview({ id: 'x3', simp: '九', pinyin: 'jiǔ', english: ['nine'], source: 'reading' }, { now: T0 });
  await deck.addToReview({ id: 'x4', simp: '十', pinyin: 'shí', english: ['ten'], source: 'reading' }, { now: T0 + 10 * DAY_MS });
  await store.set('srs', 'legacy', { id: 'legacy', hanzi: '零', due: T0, source: undefined });

  assert.deepEqual(await deck.countDueBySource(T0), { lesson: 2, reading: 1, unknown: 1 });
  assert.deepEqual(await deck.countDueBySource(T0 + 10 * DAY_MS), { lesson: 2, reading: 2, unknown: 1 });
  assert.deepEqual(await deck.countDueBySource(-1), {});
});
