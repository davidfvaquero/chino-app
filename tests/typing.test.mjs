/**
 * Typing practice — pure logic tests (no browser).
 * Tests: normalizePinyin, compareLetterByLetter, wordsPerMinute.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePinyin,
  compareLetterByLetter,
  wordsPerMinute,
} from '../src/learn/typing.js';

test('normalizePinyin strips tones, spaces, punctuation, lowercases', () => {
  assert.equal(normalizePinyin('ni3 hao3'), 'nihao');
  assert.equal(normalizePinyin('Nǐ hǎo'), 'nihao');
  assert.equal(normalizePinyin('  NI HAO  '), 'nihao');
  assert.equal(normalizePinyin('wǒ ài nǐ'), 'woaini');
  assert.equal(normalizePinyin('lǜ'), 'lu');
  assert.equal(normalizePinyin('lv4'), 'lu');
  assert.equal(normalizePinyin('ü'), 'u');
  assert.equal(normalizePinyin('v'), 'u');
  assert.equal(normalizePinyin(''), '');
  assert.equal(normalizePinyin(null), '');
  assert.equal(normalizePinyin(undefined), '');
});

test('normalizePinyin handles numbers and mixed input', () => {
  assert.equal(normalizePinyin('ni3hao3'), 'nihao');
  assert.equal(normalizePinyin('ni3 hao3 ma5'), 'nihaoma');
  assert.equal(normalizePinyin('Ni3 Hao3'), 'nihao');
});

test('compareLetterByLetter marks correct letters green (ok=true)', () => {
  const result = compareLetterByLetter('nihao', 'nihao');
  assert.equal(result.length, 5);
  assert.deepEqual(result, [
    { char: 'n', ok: true },
    { char: 'i', ok: true },
    { char: 'h', ok: true },
    { char: 'a', ok: true },
    { char: 'o', ok: true },
  ]);
});

test('compareLetterByLetter marks wrong letters red (ok=false)', () => {
  const result = compareLetterByLetter('nihao', 'nihaa');
  assert.deepEqual(result, [
    { char: 'n', ok: true },
    { char: 'i', ok: true },
    { char: 'h', ok: true },
    { char: 'a', ok: true },
    { char: 'a', ok: false },
  ]);
});

test('compareLetterByLetter shows pending for untyped letters (ok=null)', () => {
  const result = compareLetterByLetter('ni', 'nihao');
  assert.deepEqual(result, [
    { char: 'n', ok: true },
    { char: 'i', ok: true },
    { char: 'h', ok: null },
    { char: 'a', ok: null },
    { char: 'o', ok: null },
  ]);
});

test('compareLetterByLetter handles empty input', () => {
  const result = compareLetterByLetter('', 'nihao');
  assert.deepEqual(result, [
    { char: 'n', ok: null },
    { char: 'i', ok: null },
    { char: 'h', ok: null },
    { char: 'a', ok: null },
    { char: 'o', ok: null },
  ]);
});

test('compareLetterByLetter normalizes both sides before comparing', () => {
  // User types with tones/spaces, target has tones/spaces
  const result = compareLetterByLetter('Ni3 Hao3', 'nǐ hǎo');
  assert.deepEqual(result, [
    { char: 'n', ok: true },
    { char: 'i', ok: true },
    { char: 'h', ok: true },
    { char: 'a', ok: true },
    { char: 'o', ok: true },
  ]);
});

test('compareLetterByLetter handles user input longer than target', () => {
  const result = compareLetterByLetter('nihaoo', 'nihao');
  // Extra chars are ignored (target length wins)
  assert.equal(result.length, 5);
  assert.deepEqual(result, [
    { char: 'n', ok: true },
    { char: 'i', ok: true },
    { char: 'h', ok: true },
    { char: 'a', ok: true },
    { char: 'o', ok: true },
  ]);
});

test('wordsPerMinute calculates correctly', () => {
  // 300 correct chars in 60 seconds = 60 words / 1 min = 60 WPM
  assert.equal(wordsPerMinute(300, 60000), 60);
  // 150 correct chars in 30 seconds = 30 words / 0.5 min = 60 WPM
  assert.equal(wordsPerMinute(150, 30000), 60);
  // 50 correct chars in 60 seconds = 10 words / 1 min = 10 WPM
  assert.equal(wordsPerMinute(50, 60000), 10);
  // Edge cases
  assert.equal(wordsPerMinute(0, 60000), 0);
  assert.equal(wordsPerMinute(100, 0), 0);
  assert.equal(wordsPerMinute(100, -1000), 0);
});

test('wordsPerMinute rounds to nearest integer', () => {
  // 125 chars in 60s = 25 words / 1 min = 25 WPM exactly
  assert.equal(wordsPerMinute(125, 60000), 25);
  // 127 chars in 60s = 25.4 words -> 25 WPM
  assert.equal(wordsPerMinute(127, 60000), 25);
  // 128 chars in 60s = 25.6 words -> 26 WPM
  assert.equal(wordsPerMinute(128, 60000), 26);
});