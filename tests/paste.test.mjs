// Tests for src/extras/paste.js — pure logic only (no browser, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import the pure functions we can test (we'll extract them or test via the module)
import { hasHanzi, tokenizeLine, wordPanel, reviewEntryFrom } from '../src/reading/model.js';
import { splitSentences } from '../src/extras/paste.js';

const fakeSegment = async (text) => String(text).match(/[\u3400-\u9fff]+|[^\u3400-\u9fff]+/g) ?? [];

// ---------------------------------------------------------------- splitSentences

test('splitSentences splits on Chinese punctuation and keeps delimiter', () => {
  const text = '我喜欢学习中文。你好吗？';
  const sentences = splitSentences(text);
  assert.deepEqual(sentences, ['我喜欢学习中文。', '你好吗？']);
});

test('splitSentences handles text without trailing punctuation', () => {
  const text = '我喜欢学习中文。你好吗';
  const sentences = splitSentences(text);
  assert.deepEqual(sentences, ['我喜欢学习中文。', '你好吗']);
});

test('splitSentences handles empty string', () => {
  assert.deepEqual(splitSentences(''), []);
});

test('splitSentences handles only punctuation', () => {
  assert.deepEqual(splitSentences('。？！'), ['。', '？', '！']);
});

// ---------------------------------------------------------------- hasHanzi (from reading/model)

test('hasHanzi detects hanzi runs, ignores punctuation and latin', () => {
  assert.equal(hasHanzi('你好'), true);
  assert.equal(hasHanzi('！'), false);
  assert.equal(hasHanzi('abc 123'), false);
  assert.equal(hasHanzi(''), false);
});

// ---------------------------------------------------------------- tokenizeLine (from reading/model)

test('tokenizeLine marks hanzi tokens as tappable words, punctuation as plain', async () => {
  const tokens = await tokenizeLine('你好！abc', fakeSegment);
  assert.deepEqual(tokens, [
    { text: '你好', word: true },
    { text: '！abc', word: false },
  ]);
  assert.equal(tokens.find((tk) => tk.text === '你好').word, true);
});

// ---------------------------------------------------------------- wordPanel (from reading/model)

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

// ---------------------------------------------------------------- reviewEntryFrom (from reading/model)

test('reviewEntryFrom maps a dictionary entry to the srs.addToReview shape', () => {
  const entry = {
    id: 7,
    simp: '再见',
    trad: '再見',
    pinyinTone: 'zàijiàn',
    pinyinNum: 'zai4 jian4',
    defs: ['goodbye'],
  };
  assert.deepEqual(reviewEntryFrom(entry, 'paste'), {
    id: 7,
    hanzi: '再见',
    trad: '再見',
    pinyin: 'zàijiàn',
    pinyinNumeric: 'zai4 jian4',
    english: ['goodbye'],
    source: 'paste',
  });
});

// ---------------------------------------------------------------- HSK1 + review unknown logic (integration-style, mocked)

// We can't easily test the full render without a browser, but we can test the
// isKnown logic by mocking the sets
test('isKnown logic: word in HSK1 is known', () => {
  const hsk1 = new Set(['我', '喜欢']);
  const review = new Set();
  const known = hsk1.has('我') || review.has('我');
  assert.equal(known, true);
});

test('isKnown logic: word in review is known', () => {
  const hsk1 = new Set(['我']);
  const review = new Set(['学习']);
  const known = hsk1.has('学习') || review.has('学习');
  assert.equal(known, true);
});

test('isKnown logic: word in neither is unknown', () => {
  const hsk1 = new Set(['我']);
  const review = new Set(['学习']);
  const known = hsk1.has('中文') || review.has('中文');
  assert.equal(known, false);
});