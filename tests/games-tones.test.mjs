// Tone duel game logic tests — word pool, round generation, grading, confusion stats.
// Run with `node --test tests/games-tones.test.mjs` (or `npm test`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildPool,
  generateRound,
  checkAnswer,
  tallyConfusions,
  practicePool,
  ROUND_LEN,
} from '../src/learn/games/tones-duel.js';

/** Small seeded PRNG so round tests are repeatable. */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x80000000;
  };
}

const VOCAB = [
  { hanzi: '你', pinyin: 'nǐ' },
  { hanzi: '好', pinyin: 'hǎo' },
  { hanzi: '谢谢', pinyin: 'xièxie' }, // glued pinyin: not one syllable per char -> skipped
  { hanzi: '不客气', pinyin: 'bú kèqi' }, // 3 chars -> skipped
  { hanzi: '吗', pinyin: 'ma' }, // neutral tone -> skipped
  { hanzi: '妈妈', pinyin: 'mā ma' }, // second tone-less syllable -> skipped
  { hanzi: '马', pinyin: 'mǎ' },
  { hanzi: '买', pinyin: 'mǎi' },
  { hanzi: '来', pinyin: 'lái' },
  { hanzi: '你', pinyin: 'nǐ' }, // duplicate hanzi -> dropped
];

/* ------------------------------------------------------------- buildPool -- */

test('buildPool: keeps 1-2 char words with their tones, one syllable per char', () => {
  assert.deepEqual(
    buildPool(VOCAB).map((w) => [w.hanzi, w.tones]),
    [
      ['你', [3]],
      ['好', [3]],
      ['马', [3]],
      ['买', [3]],
      ['来', [2]],
    ],
  );
});

test('buildPool: drops duplicates, neutral tones, long words and glued pinyin', () => {
  const hanzi = buildPool(VOCAB).map((w) => w.hanzi);
  assert.equal(hanzi.filter((h) => h === '你').length, 1);
  for (const skipped of ['谢谢', '不客气', '吗', '妈妈']) assert.ok(!hanzi.includes(skipped));
});

test('buildPool: two-syllable word gets two tones', () => {
  const [w] = buildPool([{ hanzi: '妈妈', pinyin: 'mā má' }]);
  assert.deepEqual(w.tones, [1, 2]);
});

test('buildPool: empty and missing input give an empty pool', () => {
  assert.deepEqual(buildPool([]), []);
  assert.deepEqual(buildPool(undefined), []);
});

test('buildPool: real HSK1 vocabulary yields a playable pool', async () => {
  const idx = JSON.parse(await readFile(new URL('../public/data/lessons/hsk1/index.json', import.meta.url), 'utf8'));
  const vocabulary = [];
  for (const l of idx.lessons) {
    const lesson = JSON.parse(await readFile(new URL(`../public/data/lessons/hsk1/${l.file}`, import.meta.url), 'utf8'));
    vocabulary.push(...(lesson.vocabulary ?? []));
  }
  const pool = buildPool(vocabulary);
  assert.ok(pool.length >= ROUND_LEN, `pool too small: ${pool.length}`);
  assert.ok(pool.some((w) => w.tones.length === 2), 'expected two-syllable words');
  assert.ok(pool.every((w) => w.tones.every((n) => n >= 1 && n <= 4)));
});

/* -------------------------------------------------------- generateRound -- */

test('generateRound: 20 rounds from a big pool, count capped by a small pool', () => {
  const big = buildPool(Array.from({ length: 40 }, (_, i) => ({ hanzi: String.fromCharCode(0x4e00 + i), pinyin: 'mā' })));
  assert.equal(generateRound(big, { rnd: seeded(3) }).length, ROUND_LEN);
  assert.equal(generateRound(buildPool(VOCAB), { count: 20, rnd: seeded(3) }).length, 5);
  assert.deepEqual(generateRound([], { rnd: seeded(3) }), []);
});

test('generateRound: each round has the answer among 4 distinct options', () => {
  const pool = buildPool(VOCAB);
  for (const r of generateRound(pool, { rnd: seeded(7) })) {
    assert.equal(r.options.length, 4);
    assert.equal(new Set(r.options).size, 4);
    assert.ok(r.options.includes(r.answer));
  }
});

test('generateRound: one-syllable words offer tones 1-4; two-syllable words offer pairs', () => {
  const pool = buildPool([...VOCAB, { hanzi: '妈妈', pinyin: 'mā ma' }, { hanzi: '妈妈', pinyin: 'mā má' }]);
  const rounds = generateRound(pool, { count: 50, rnd: seeded(11) });
  for (const r of rounds) {
    const parts = r.answer.split('-');
    assert.ok(parts.length === 1 || parts.length === 2);
    if (parts.length === 1) assert.deepEqual([...r.options].sort(), ['1', '2', '3', '4']);
    else assert.ok(r.options.every((o) => o.split('-').length === 2));
  }
});

test('generateRound: answer matches the pool word pinyin and hanzi', () => {
  const pool = buildPool(VOCAB);
  const byHanzi = Object.fromEntries(pool.map((w) => [w.hanzi, w]));
  for (const r of generateRound(pool, { rnd: seeded(5) })) {
    assert.equal(r.answer, byHanzi[r.hanzi].tones.join('-'));
    assert.equal(r.pinyin, byHanzi[r.hanzi].pinyin);
  }
});

/* ---------------------------------------------------------- checkAnswer -- */

test('checkAnswer: right tone is correct with no mix-ups', () => {
  assert.deepEqual(checkAnswer({ answer: '3' }, '3'), { correct: true, pairs: [] });
});

test('checkAnswer: wrong single tone records the mix-up (right -> heard)', () => {
  assert.deepEqual(checkAnswer({ answer: '2' }, '3'), { correct: false, pairs: [{ from: 2, to: 3 }] });
});

test('checkAnswer: two-syllable word records one pair per differing syllable', () => {
  assert.deepEqual(checkAnswer({ answer: '2-4' }, '2-1'), { correct: false, pairs: [{ from: 4, to: 1 }] });
  assert.deepEqual(checkAnswer({ answer: '2-4' }, '3-1'), {
    correct: false,
    pairs: [{ from: 2, to: 3 }, { from: 4, to: 1 }],
  });
});

test('checkAnswer: time ran out (null) is wrong and adds no mix-up', () => {
  assert.deepEqual(checkAnswer({ answer: '1' }, null), { correct: false, pairs: [] });
});

/* ---------------------------------------------------------- tallyConfusions -- */

test('tallyConfusions: counts the mix-ups, most frequent first', () => {
  const pairs = [
    { from: 2, to: 3 },
    { from: 2, to: 3 },
    { from: 4, to: 1 },
    { from: 2, to: 3 },
    { from: 1, to: 4 },
  ];
  assert.deepEqual(tallyConfusions(pairs), [
    { from: 2, to: 3, count: 3 },
    { from: 1, to: 4, count: 1 },
    { from: 4, to: 1, count: 1 },
  ]);
});

test('tallyConfusions: limit and empty input', () => {
  assert.deepEqual(tallyConfusions([{ from: 1, to: 2 }, { from: 3, to: 4 }], 1), [{ from: 1, to: 2, count: 1 }]);
  assert.deepEqual(tallyConfusions([]), []);
  assert.deepEqual(tallyConfusions(undefined), []);
});

/* ------------------------------------------------------------ practicePool -- */

test('practicePool: keeps words with the tones the player mixes up', () => {
  const pool = [
    { hanzi: '马', tones: [3] },
    { hanzi: '来', tones: [2] },
    { hanzi: '吗', tones: [1] },
  ];
  const confusions = [{ from: 2, to: 3, count: 4 }];
  assert.deepEqual(practicePool(pool, confusions).map((w) => w.hanzi), ['来']);
});

test('practicePool: no confusions -> whole pool', () => {
  const pool = [{ hanzi: '马', tones: [3] }];
  assert.equal(practicePool(pool, []), pool);
  assert.equal(practicePool(pool, undefined), pool);
});

test('practicePool: confusion tones absent from the pool -> whole pool', () => {
  const pool = [{ hanzi: '马', tones: [3] }];
  assert.equal(practicePool(pool, [{ from: 1, to: 2, count: 1 }]), pool);
});
