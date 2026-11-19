/**
 * exam.test.mjs — pure logic of src/learn/exam-gen.js
 * Run with: node --test tests/exam.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LEVELS,
  EXAM_SIZE,
  CHOICE_COUNT,
  BLANK,
  mulberry32,
  hashSeed,
  makeRng,
  shuffle,
  normalizeWord,
  isWord,
  isSentence,
  segmentSentence,
  uniqueOptions,
  sectionPlan,
  buildExam,
  gradeAnswer,
  gradeExam,
} from '../src/learn/exam-gen.js';

const readJson = (rel) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));

const HSK1 = readJson('public/data/hsk/1.json').items.map(normalizeWord).filter(isWord);
const SENTENCES = [1, 2, 3, 4]
  .flatMap((n) => readJson(`public/data/readings/hsk1/reading-0${n}.json`).lines)
  .map((line) => ({ hanzi: line.hanzi, pinyin: line.pinyin, english: line.english }))
  .filter(isSentence);

const build = (seed, opts = {}) =>
  buildExam({ level: 1, seed, words: HSK1, sentences: SENTENCES, size: EXAM_SIZE, rng: makeRng(seed), ...opts });

test('the rng is deterministic per seed', () => {
  const a = mulberry32(hashSeed('1234'));
  const b = mulberry32(hashSeed('1234'));
  const first = [a(), a(), a()];
  const second = [b(), b(), b()];
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, [a(), a(), a()]);
  assert.equal(hashSeed(1234), hashSeed('1234'));
});

test('the same seed builds exactly the same exam', () => {
  assert.deepEqual(build('1234'), build('1234'));
  assert.equal(JSON.stringify(build('42')), JSON.stringify(build('42')));
});

test('a different seed builds a different exam', () => {
  assert.notEqual(JSON.stringify(build('1')), JSON.stringify(build('2')));
});

test('an exam has EXAM_SIZE questions split into the four sections', () => {
  const exam = build('seed-a');
  assert.equal(exam.size, EXAM_SIZE);
  assert.equal(exam.questions.length, EXAM_SIZE);
  const plan = sectionPlan(EXAM_SIZE);
  const counts = { meaning: 0, listen: 0, reading: 0, order: 0 };
  for (const question of exam.questions) counts[question.section] += 1;
  assert.deepEqual(counts, plan);
  assert.equal(plan.meaning + plan.listen + plan.reading + plan.order, EXAM_SIZE);
});

test('every choice question has distinct options and one single correct answer', () => {
  const exam = build('choices');
  for (const question of exam.questions) {
    if (question.type === 'order') continue;
    assert.ok(question.options.length >= 2, `${question.id} needs at least two options`);
    assert.ok(question.options.length <= CHOICE_COUNT);
    assert.equal(new Set(question.options).size, question.options.length, `${question.id} has a duplicate option`);
    const hits = question.options.filter((option) => option === question.answer);
    assert.equal(hits.length, 1, `${question.id} must carry the answer exactly once`);
  }
});

test('decoys never equal the answer or each other', () => {
  const options = uniqueOptions('good', ['good', 'good', 'fine', 'fine', 'nice', 'kind'], { size: 4, rng: makeRng(7) });
  assert.equal(options.length, 4);
  assert.equal(new Set(options).size, 4);
  assert.equal(options.filter((option) => option === 'good').length, 1);
  // too few distinct decoys -> fewer options, never a duplicated value
  const small = uniqueOptions('good', ['good', 'fine', 'fine'], { size: 4, rng: makeRng(7) });
  assert.equal(small.length, 2);
  assert.equal(new Set(small).size, 2);
});

test('listen questions alternate hanzi / pinyin and answer in the shown script', () => {
  const exam = build('listen');
  const listens = exam.questions.filter((question) => question.type === 'listen');
  assert.ok(listens.length >= 2);
  assert.deepEqual([...new Set(listens.map((question) => question.mode))].sort(), ['hanzi', 'pinyin']);
  for (const question of listens) {
    const shown = question.mode === 'hanzi' ? question.word.hanzi : question.word.pinyin;
    assert.equal(question.answer, shown);
    assert.ok(question.options.includes(shown));
  }
});

test('reading questions ask either the meaning or the missing word', () => {
  const exam = build('reading');
  const readings = exam.questions.filter((question) => question.type === 'reading');
  assert.ok(readings.length >= 2);
  for (const question of readings) {
    if (question.kind === 'meaning') {
      assert.equal(question.answer, question.sentence.english);
      assert.ok(question.options.includes(question.sentence.english));
    } else {
      assert.equal(question.kind, 'missing');
      assert.ok(question.prompt.includes(BLANK), 'the missing word is replaced by the blank marker');
      assert.ok(question.tokens.includes(null));
      assert.ok(question.sentence.hanzi.includes(question.answer));
    }
  }
});

test('order questions are built from the sentence tokens', () => {
  const exam = build('order');
  const orders = exam.questions.filter((question) => question.type === 'order');
  assert.ok(orders.length >= 2);
  for (const question of orders) {
    assert.equal(question.tokens.join(''), question.answer);
    assert.equal(question.answer, question.sentence.hanzi);
    assert.deepEqual([...question.options].sort(), [...question.tokens].sort());
  }
});

test('segmentSentence covers the sentence exactly and reuses known words', () => {
  const vocab = new Set(['你好', '我', '叫', '什么', '名字']);
  const tokens = segmentSentence('你好！你叫什么名字？', vocab);
  assert.equal(tokens.join(''), '你好！你叫什么名字？');
  assert.ok(tokens.includes('你好'));
  assert.ok(tokens.includes('名字'));
});

test('gradeAnswer marks the right response and only it', () => {
  const exam = build('grade');
  const question = exam.questions.find((entry) => entry.type === 'meaning');
  assert.equal(gradeAnswer(question, question.answer), true);
  assert.equal(gradeAnswer(question, 'definitely not the meaning'), false);
  assert.equal(gradeAnswer(question, ''), false);
  assert.equal(gradeAnswer(question, null), false);

  const order = exam.questions.find((entry) => entry.type === 'order');
  assert.equal(gradeAnswer(order, order.tokens), true);
  assert.equal(gradeAnswer(order, order.tokens.join('')), true);
  assert.equal(gradeAnswer(order, [...order.tokens].reverse()), order.tokens.length < 2);
});

test('gradeExam scores all-correct at 100% and all-wrong at 0%', () => {
  const exam = build('score');
  const allRight = exam.questions.map((question) => (question.type === 'order' ? question.tokens : question.answer));
  const good = gradeExam(exam, allRight);
  assert.equal(good.correct, exam.questions.length);
  assert.equal(good.total, exam.questions.length);
  assert.equal(good.percent, 100);
  assert.equal(good.wrong.length, 0);

  const bad = gradeExam(exam, exam.questions.map(() => null));
  assert.equal(bad.correct, 0);
  assert.equal(bad.percent, 0);
  assert.equal(bad.wrong.length, exam.questions.length);
  for (const miss of bad.wrong) assert.equal(miss.expected, miss.question.answer);
});

test('normalizeWord keeps simplified only and joins meanings', () => {
  const word = normalizeWord({ hanzi: '爱', trad: '愛', pinyin: 'ài', pinyinNumeric: 'ai4', english: ['love', 'to love'] });
  assert.equal(word.hanzi, '爱');
  assert.equal(word.trad, undefined);
  assert.equal(word.english, 'love; to love');
  assert.equal(isWord(word), true);
  assert.equal(isWord({ hanzi: '爱' }), false);
});

test('shuffle is a permutation and a seeded shuffle is stable', () => {
  const list = [1, 2, 3, 4, 5];
  assert.deepEqual([...shuffle(list, makeRng(9))].sort(), list);
  assert.deepEqual(shuffle(list, makeRng(9)), shuffle(list, makeRng(9)));
});

test('the Spanish exam shard mirrors the English one', () => {
  const flat = (obj, parents = []) => {
    const out = [];
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) out.push(...flat(value, [...parents, key]));
      else out.push([[...parents, key].join('.'), value]);
    }
    return out;
  };
  const en = new Map(flat(readJson('src/locales/en.d/exam.json')));
  const es = new Map(flat(readJson('src/locales/es.d/exam.json')));
  assert.deepEqual([...es.keys()].sort(), [...en.keys()].sort());
  for (const [key, value] of en) {
    assert.equal(String(es.get(key)).match(/\{[^}]*\}/g)?.join(',') ?? '', String(value).match(/\{[^}]*\}/g)?.join(',') ?? '', `placeholders differ in ${key}`);
    assert.ok(String(es.get(key)).trim().length > 0, `empty Spanish string for ${key}`);
  }
});

test('LEVELS offers HSK 1 to 3', () => {
  assert.deepEqual(LEVELS, [1, 2, 3]);
});
