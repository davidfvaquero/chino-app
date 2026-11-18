// Timed quiz game logic tests — round generation and answer checking.
// Run with `npm test` (node --test tests/) or `node --test tests/games-timed.test.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTimedRound, checkTimedAnswer } from '../src/learn/games/timed.js';

const SAMPLE_WORDS = [
  { hanzi: '你', pinyin: 'nǐ', english: 'you' },
  { hanzi: '好', pinyin: 'hǎo', english: 'good' },
  { hanzi: '谢', pinyin: 'xiè', english: 'thank' },
  { hanzi: '再', pinyin: 'zài', english: 'again' },
  { hanzi: '见', pinyin: 'jiàn', english: 'see' },
  { hanzi: '大', pinyin: 'dà', english: 'big' },
  { hanzi: '小', pinyin: 'xiǎo', english: 'small' },
  { hanzi: '吃', pinyin: 'chī', english: 'eat' },
  { hanzi: '喝', pinyin: 'hē', english: 'drink' },
  { hanzi: '去', pinyin: 'qù', english: 'go' },
  { hanzi: '来', pinyin: 'lái', english: 'come' },
];

/* -------------------------------------------------------- Timed round tests -- */

test('generateTimedRound returns correct number of questions', () => {
  const round = generateTimedRound(SAMPLE_WORDS, { count: 5, mode: 'english' });
  assert.equal(round.questions.length, 5);
});

test('generateTimedRound respects count limit', () => {
  const round = generateTimedRound(SAMPLE_WORDS, { count: 3, mode: 'english' });
  assert.equal(round.questions.length, 3);
});

test('generateTimedRound handles empty word list', () => {
  const round = generateTimedRound([], { count: 5 });
  assert.deepEqual(round.questions, []);
});

test('generateTimedRound english mode: questions have hanzi, pinyin, english, options, correctIndex', () => {
  const round = generateTimedRound(SAMPLE_WORDS, { count: 4, mode: 'english' });
  for (const q of round.questions) {
    assert.ok(q.hanzi);
    assert.ok(q.pinyin);
    assert.ok(q.english);
    assert.ok(Array.isArray(q.options));
    assert.equal(q.options.length, 4);
    assert.ok(typeof q.correctIndex === 'number');
    assert.ok(q.correctIndex >= 0 && q.correctIndex < 4);
    assert.equal(q.mode, 'english');
    // Correct answer should be in options
    assert.equal(q.options[q.correctIndex], q.english);
  }
});

test('generateTimedRound audio mode: questions have hanzi options', () => {
  const round = generateTimedRound(SAMPLE_WORDS, { count: 4, mode: 'audio' });
  for (const q of round.questions) {
    assert.ok(q.hanzi);
    assert.ok(q.pinyin);
    assert.ok(q.english);
    assert.ok(Array.isArray(q.options));
    assert.equal(q.options.length, 4);
    assert.ok(typeof q.correctIndex === 'number');
    assert.ok(q.correctIndex >= 0 && q.correctIndex < 4);
    assert.equal(q.mode, 'audio');
    // Correct answer should be hanzi
    assert.equal(q.options[q.correctIndex], q.hanzi);
  }
});

test('generateTimedRound all options are unique per question', () => {
  const round = generateTimedRound(SAMPLE_WORDS, { count: 5, mode: 'english' });
  for (const q of round.questions) {
    const unique = new Set(q.options);
    assert.equal(unique.size, 4, 'Options should be unique');
  }
});

/* -------------------------------------------------------- checkTimedAnswer tests -- */

test('checkTimedAnswer: correct answer returns correct=true, streak=1, score=1', () => {
  const question = { correctIndex: 2 };
  const result = checkTimedAnswer(question, 2);
  assert.equal(result.correct, true);
  assert.equal(result.streak, 1);
  assert.equal(result.score, 1);
});

test('checkTimedAnswer: wrong answer returns correct=false, streak=0, score=0', () => {
  const question = { correctIndex: 2 };
  const result = checkTimedAnswer(question, 0);
  assert.equal(result.correct, false);
  assert.equal(result.streak, 0);
  assert.equal(result.score, 0);
});

test('checkTimedAnswer: out of bounds answer returns correct=false', () => {
  const question = { correctIndex: 2 };
  const result = checkTimedAnswer(question, 5);
  assert.equal(result.correct, false);
  assert.equal(result.streak, 0);
  assert.equal(result.score, 0);
});

test('checkTimedAnswer: negative answer returns correct=false', () => {
  const question = { correctIndex: 2 };
  const result = checkTimedAnswer(question, -1);
  assert.equal(result.correct, false);
});