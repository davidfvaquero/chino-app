// Games logic tests — round generation and pair checking.
// Run with `npm test` (node --test tests/) or `node --test tests/games.test.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMatchingRound, checkMatching } from '../src/learn/games/matching.js';
import { generateMemoryRound, checkMemory } from '../src/learn/games/memory.js';

const SAMPLE_WORDS = [
  { hanzi: '你', pinyin: 'nǐ', english: 'you' },
  { hanzi: '好', pinyin: 'hǎo', english: 'good' },
  { hanzi: '谢', pinyin: 'xiè', english: 'thank' },
  { hanzi: '谢', pinyin: 'xiè', english: ['thank', 'thanks'] }, // duplicate hanzi, different entry
  { hanzi: '再', pinyin: 'zài', english: 'again' },
  { hanzi: '见', pinyin: 'jiàn', english: 'see' },
  { hanzi: '大', pinyin: 'dà', english: 'big' },
  { hanzi: '小', pinyin: 'xiǎo', english: 'small' },
  { hanzi: '吃', pinyin: 'chī', english: 'eat' },
  { hanzi: '喝', pinyin: 'hē', english: 'drink' },
  { hanzi: '去', pinyin: 'qù', english: 'go' },
  { hanzi: '来', pinyin: 'lái', english: 'come' },
];

/* -------------------------------------------------------- Matching tests -- */

test('generateMatchingRound returns correct number of pairs and options', () => {
  const round = generateMatchingRound(SAMPLE_WORDS, { count: 6, mode: 'english' });
  assert.equal(round.pairs.length, 6);
  assert.ok(round.options.length >= 6);
  for (const pair of round.pairs) {
    assert.ok(pair.hanzi);
    assert.ok(pair.target);
    assert.ok(pair.pinyin);
    assert.equal(typeof pair.target, 'string');
  }
});

test('generateMatchingRound respects count limit', () => {
  const round = generateMatchingRound(SAMPLE_WORDS, { count: 3, mode: 'english' });
  assert.equal(round.pairs.length, 3);
});

test('generateMatchingRound mode pinyin uses pinyin as target', () => {
  const round = generateMatchingRound(SAMPLE_WORDS, { count: 4, mode: 'pinyin' });
  for (const pair of round.pairs) {
    assert.equal(pair.target, pair.pinyin);
  }
});

test('generateMatchingRound handles empty word list', () => {
  const round = generateMatchingRound([], { count: 6 });
  assert.deepEqual(round.pairs, []);
  assert.deepEqual(round.options, []);
});

test('checkMatching: perfect match scores 1', () => {
  const pairs = [
    { hanzi: '你', target: 'you' },
    { hanzi: '好', target: 'good' },
    { hanzi: '大', target: 'big' },
  ];
  const response = { 你: 'you', 好: 'good', 大: 'big' };
  const result = checkMatching(pairs, response);
  assert.equal(result.correct, true);
  assert.equal(result.score, 1);
  assert.equal(result.matched, 3);
  assert.equal(result.total, 3);
});

test('checkMatching: partial match gives partial score', () => {
  const pairs = [
    { hanzi: '你', target: 'you' },
    { hanzi: '好', target: 'good' },
    { hanzi: '大', target: 'big' },
  ];
  const response = { 你: 'you', 好: 'bad', 大: 'big' };
  const result = checkMatching(pairs, response);
  assert.equal(result.correct, false);
  assert.equal(result.score, 2 / 3);
  assert.equal(result.matched, 2);
  assert.equal(result.total, 3);
});

test('checkMatching: empty response scores 0', () => {
  const pairs = [{ hanzi: '你', target: 'you' }];
  const result = checkMatching(pairs, {});
  assert.equal(result.correct, false);
  assert.equal(result.score, 0);
  assert.equal(result.matched, 0);
  assert.equal(result.total, 1);
});

test('checkMatching: extra keys in response are ignored', () => {
  const pairs = [{ hanzi: '你', target: 'you' }];
  const response = { 你: 'you', 好: 'good' };
  const result = checkMatching(pairs, response);
  assert.equal(result.correct, true);
  assert.equal(result.matched, 1);
});

/* --------------------------------------------------------- Memory tests -- */

test('generateMemoryRound creates 2 cards per word (hanzi + meaning)', () => {
  const round = generateMemoryRound(SAMPLE_WORDS, { count: 3 });
  assert.equal(round.cards.length, 6);
  const types = round.cards.map((c) => c.type).sort();
  assert.deepEqual(types, ['hanzi', 'hanzi', 'hanzi', 'meaning', 'meaning', 'meaning']);
});

test('generateMemoryRound cards have correct structure', () => {
  const round = generateMemoryRound(SAMPLE_WORDS, { count: 2 });
  for (const card of round.cards) {
    assert.ok(card.id);
    assert.ok(card.hanzi);
    assert.ok(card.pinyin);
    assert.ok(card.meaning);
    assert.ok(['hanzi', 'meaning'].includes(card.type));
    assert.equal(card.flipped, false);
    assert.equal(card.matched, false);
  }
});

test('generateMemoryRound pairs share same hanzi and meaning', () => {
  const round = generateMemoryRound(SAMPLE_WORDS, { count: 2 });
  const hanziCards = round.cards.filter((c) => c.type === 'hanzi');
  const meaningCards = round.cards.filter((c) => c.type === 'meaning');
  for (const hCard of hanziCards) {
    const match = meaningCards.find((m) => m.hanzi === hCard.hanzi && m.meaning === hCard.meaning);
    assert.ok(match, `Found meaning pair for ${hCard.hanzi}`);
  }
});

test('generateMemoryRound respects count limit', () => {
  const round = generateMemoryRound(SAMPLE_WORDS, { count: 4 });
  assert.equal(round.cards.length, 8); // 4 pairs * 2
});

test('generateMemoryRound handles empty word list', () => {
  const round = generateMemoryRound([], { count: 6 });
  assert.deepEqual(round.cards, []);
});

test('checkMemory: no flips returns incomplete', () => {
  const round = generateMemoryRound(SAMPLE_WORDS, { count: 2 });
  const result = checkMemory(round.cards, []);
  assert.equal(result.correct, false);
  assert.equal(result.matched, 0);
  assert.equal(result.total, 2);
  assert.equal(result.complete, false);
  assert.equal(result.pairComplete, null);
});

test('checkMemory: single flip returns incomplete', () => {
  const round = generateMemoryRound(SAMPLE_WORDS, { count: 2 });
  const result = checkMemory(round.cards, [round.cards[0].id]);
  assert.equal(result.pairComplete, null);
  assert.equal(result.complete, false);
});

test('checkMemory: matching pair returns pairComplete true', () => {
  const round = generateMemoryRound(SAMPLE_WORDS, { count: 2 });
  const hanziCard = round.cards.find((c) => c.type === 'hanzi');
  const meaningCard = round.cards.find((c) => c.type === 'meaning' && c.hanzi === hanziCard.hanzi);
  const result = checkMemory(round.cards, [hanziCard.id, meaningCard.id]);
  assert.equal(result.pairComplete, true);
  assert.equal(result.correct, true);
});

test('checkMemory: non-matching pair returns pairComplete false', () => {
  const round = generateMemoryRound(SAMPLE_WORDS, { count: 3 });
  const hanziCard = round.cards.find((c) => c.type === 'hanzi');
  const otherMeaning = round.cards.find((c) => c.type === 'meaning' && c.hanzi !== hanziCard.hanzi);
  const result = checkMemory(round.cards, [hanziCard.id, otherMeaning.id]);
  assert.equal(result.pairComplete, false);
  assert.equal(result.correct, false);
});

test('checkMemory: matched cards counted correctly', () => {
  const round = generateMemoryRound(SAMPLE_WORDS, { count: 3 });
  // Simulate two matched pairs
  const pair1Hanzi = round.cards.find((c) => c.type === 'hanzi');
  const pair1Meaning = round.cards.find((c) => c.type === 'meaning' && c.hanzi === pair1Hanzi.hanzi);
  const pair2Hanzi = round.cards.find((c) => c.type === 'hanzi' && c.hanzi !== pair1Hanzi.hanzi);
  const pair2Meaning = round.cards.find((c) => c.type === 'meaning' && c.hanzi === pair2Hanzi.hanzi);

  pair1Hanzi.matched = pair1Meaning.matched = true;
  pair2Hanzi.matched = pair2Meaning.matched = true;

  const result = checkMemory(round.cards, []);
  assert.equal(result.matched, 2);
  assert.equal(result.total, 3);
  assert.equal(result.score, 2 / 3);
  assert.equal(result.complete, false);
});

test('checkMemory: complete when all pairs matched', () => {
  const round = generateMemoryRound(SAMPLE_WORDS, { count: 2 });
  for (const card of round.cards) card.matched = true;
  const result = checkMemory(round.cards, []);
  assert.equal(result.matched, 2);
  assert.equal(result.total, 2);
  assert.equal(result.score, 1);
  assert.equal(result.complete, true);
});

test('checkMemory: two hanzi cards of same word is not a pair', () => {
  const round = generateMemoryRound(SAMPLE_WORDS, { count: 2 });
  const hanziCards = round.cards.filter((c) => c.type === 'hanzi');
  if (hanziCards.length >= 2) {
    const result = checkMemory(round.cards, [hanziCards[0].id, hanziCards[1].id]);
    assert.equal(result.pairComplete, false);
  }
});

test('checkMemory: two meaning cards of same word is not a pair', () => {
  const round = generateMemoryRound(SAMPLE_WORDS, { count: 2 });
  const meaningCards = round.cards.filter((c) => c.type === 'meaning');
  if (meaningCards.length >= 2) {
    const result = checkMemory(round.cards, [meaningCards[0].id, meaningCards[1].id]);
    assert.equal(result.pairComplete, false);
  }
});