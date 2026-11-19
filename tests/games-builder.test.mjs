// Sentence Builder game logic tests — segmentation, round generation, order checks, scoring.
// Run with `node --test tests/games-builder.test.mjs` (or `npm test`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { configure } from '../src/dictionary.js';
import {
  generateBuilderRound,
  checkBuilderOrder,
  segmentSentence,
  chipOrder,
  roundPoints,
} from '../src/learn/games/builder.js';

// Node has no fetch for /data/dict/...: serve the generated dictionary from disk.
configure({
  fetch: async (url) => {
    const rel = url.replace(/^.*\/data\/dict\//, '');
    const body = await readFile(new URL(`../public/data/dict/${rel}`, import.meta.url), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  },
});

const SAMPLE_SENTENCES = [
  { id: 1, zh: '我爱你', pinyin: 'wǒ ài nǐ', en: 'I love you' },
  { id: 2, zh: '我不知道', pinyin: 'wǒ bù zhī dào', en: "I don't know" },
  { id: 3, zh: '你好吗', pinyin: 'nǐ hǎo ma', en: 'How are you' },
  { id: 4, zh: '谢谢', pinyin: 'xiè xie', en: 'Thank you' },
  { id: 5, zh: '不客气', pinyin: 'bú kè qì', en: "You're welcome" },
  { id: 6, zh: '我要去北京', pinyin: 'wǒ yào qù běi jīng', en: 'I want to go to Beijing' },
  { id: 7, zh: '他在吃饭', pinyin: 'tā zài chī fàn', en: 'He is eating' },
  { id: 8, zh: '我们明天见', pinyin: 'wǒ men míng tiān jiàn', en: 'See you tomorrow' },
  { id: 9, zh: '这很好', pinyin: 'zhè hěn hǎo', en: 'This is good' },
  { id: 10, zh: '请帮我', pinyin: 'qǐng bāng wǒ', en: 'Please help me' },
  { id: 11, zh: '我会说中文', pinyin: 'wǒ huì shuō zhōng wén', en: 'I can speak Chinese' },
  { id: 12, zh: '今天天气很好', pinyin: 'jīn tiān tiān qì hěn hǎo', en: 'The weather is nice today' },
];

const HANZI_ONLY = /^[\u3400-\u9fff\uf900-\ufaff]+$/;

/* ------------------------------------------------------- segmentSentence -- */

test('segmentSentence: simple sentence returns hanzi words', async () => {
  assert.deepEqual(await segmentSentence('我爱你'), ['我', '爱', '你']);
});

test('segmentSentence: spaces and punctuation are dropped', async () => {
  assert.deepEqual(await segmentSentence('我 爱 你。'), ['我', '爱', '你']);
});

test('segmentSentence: empty string returns empty array', async () => {
  assert.deepEqual(await segmentSentence(''), []);
});

test('segmentSentence: traditional input comes back simplified', async () => {
  assert.equal((await segmentSentence('擔心')).join(''), '担心');
  assert.deepEqual(await segmentSentence('趕快!'), ['赶快']);
});

/* ---------------------------------------------------- checkBuilderOrder -- */

test('checkBuilderOrder: exact match returns correct=true, score=1', () => {
  const result = checkBuilderOrder(['我', '爱', '你'], ['我', '爱', '你'], []);
  assert.equal(result.correct, true);
  assert.equal(result.score, 1);
  assert.equal(result.matched, 3);
  assert.equal(result.total, 3);
  assert.equal(result.alternative, false);
});

test('checkBuilderOrder: partial match returns partial score', () => {
  const result = checkBuilderOrder(['我', '爱', '你'], ['我', '你', '爱'], []);
  assert.equal(result.correct, false);
  assert.equal(result.score, 1 / 3); // only first word matches position
  assert.equal(result.matched, 1);
  assert.equal(result.total, 3);
  assert.equal(result.alternative, false);
});

test('checkBuilderOrder: alternative order accepted', () => {
  const result = checkBuilderOrder(['我', '爱', '你'], ['爱', '我', '你'], [['爱', '我', '你']]);
  assert.equal(result.correct, true);
  assert.equal(result.score, 1);
  assert.equal(result.total, 3);
  assert.equal(result.alternative, true);
});

test('checkBuilderOrder: wrong order with no alternative returns incorrect', () => {
  const result = checkBuilderOrder(['我', '爱', '你'], ['你', '爱', '我'], []);
  assert.equal(result.correct, false);
  assert.equal(result.matched, 1); // middle word matches
  assert.equal(result.total, 3);
  assert.equal(result.alternative, false);
});

test('checkBuilderOrder: empty arrays returns correct', () => {
  const result = checkBuilderOrder([], [], []);
  assert.equal(result.correct, true);
  assert.equal(result.score, 1);
  assert.equal(result.total, 0);
});

test('checkBuilderOrder: user words shorter than correct is incorrect', () => {
  const result = checkBuilderOrder(['我', '爱', '你'], ['我', '爱'], []);
  assert.equal(result.correct, false);
  assert.equal(result.matched, 2);
  assert.equal(result.score, 2 / 3);
});

test('checkBuilderOrder: user words longer than correct is incorrect', () => {
  const result = checkBuilderOrder(['我', '爱'], ['我', '爱', '你'], []);
  assert.equal(result.correct, false);
  assert.equal(result.matched, 2);
  assert.equal(result.total, 2);
});

/* ------------------------------------------------- generateBuilderRound -- */

test('generateBuilderRound: returns the requested number of rounds', async () => {
  const { rounds, total } = await generateBuilderRound(SAMPLE_SENTENCES, { count: 5 });
  assert.equal(rounds.length, 5);
  assert.equal(total, 5);
});

test('generateBuilderRound: count is capped by available playable sentences', async () => {
  const { rounds } = await generateBuilderRound(SAMPLE_SENTENCES, { count: 50 });
  assert.ok(rounds.length <= SAMPLE_SENTENCES.length);
  assert.ok(rounds.length >= 5);
});

test('generateBuilderRound: handles empty and missing input', async () => {
  assert.deepEqual(await generateBuilderRound([], { count: 5 }), { rounds: [], total: 0 });
  assert.deepEqual(await generateBuilderRound(null, { count: 5 }), { rounds: [], total: 0 });
});

test('generateBuilderRound: each round has the required fields and hanzi-only words', async () => {
  const { rounds } = await generateBuilderRound(SAMPLE_SENTENCES, { count: 6 });
  for (const round of rounds) {
    assert.ok(round.id !== undefined);
    assert.ok(round.zh && round.pinyin && round.en);
    assert.ok(round.words.length >= 2);
    assert.deepEqual(round.alternatives, []);
    for (const word of round.words) assert.match(word, HANZI_ONLY);
  }
});

test('generateBuilderRound: words rebuild the sentence', async () => {
  const { rounds } = await generateBuilderRound(SAMPLE_SENTENCES, { count: 12 });
  for (const round of rounds) {
    assert.equal(round.words.join(''), round.zh);
  }
});

test('generateBuilderRound: skips unsegmentable and incomplete sentences', async () => {
  const sentences = [
    { id: 1, zh: '我爱你', pinyin: 'wǒ ài nǐ', en: 'I love you' },
    { id: 2, zh: 'abc', pinyin: 'abc', en: 'abc' }, // no hanzi
    { id: 3, zh: '我们', pinyin: 'wǒ men', en: '' }, // no English
    { id: 4, zh: '你好吗', pinyin: '', en: 'How are you' }, // no pinyin
    { id: 5, zh: '谢谢', pinyin: 'xiè xie', en: 'Thank you' }, // one word only
  ];
  const { rounds, total } = await generateBuilderRound(sentences, { count: 10 });
  assert.equal(total, 1);
  assert.equal(rounds[0].id, 1);
});

/* ------------------------------------------------------------ chipOrder -- */

test('chipOrder: returns a permutation that is never the identity for n > 1', () => {
  for (let n = 2; n <= 6; n++) {
    for (let run = 0; run < 50; run++) {
      const order = chipOrder(n);
      assert.deepEqual([...order].sort((a, b) => a - b), [...Array(n).keys()]);
      assert.ok(order.some((v, i) => v !== i), `identity for n=${n}`);
    }
  }
});

test('chipOrder: trivial sizes', () => {
  assert.deepEqual(chipOrder(0), []);
  assert.deepEqual(chipOrder(1), [0]);
});

/* ----------------------------------------------------------- roundPoints -- */

test('roundPoints: 3 for a clean solve, minus hints, never below 1; 0 when wrong', () => {
  assert.equal(roundPoints({ correct: true, hints: 0 }), 3);
  assert.equal(roundPoints({ correct: true, hints: 1 }), 2);
  assert.equal(roundPoints({ correct: true, hints: 9 }), 1);
  assert.equal(roundPoints({ correct: false, hints: 0 }), 0);
});
