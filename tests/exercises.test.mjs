// Lesson exercise grading + lesson engine tests.
// Run with `npm test` (node --test tests/) or `node --test tests/exercises.test.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { EXERCISE_TYPES, isExerciseType, gradeExercise, summarize } from '../src/learn/exercises.js';
import { loadIndex, loadLesson, getProgress, saveProgress, progressKey } from '../src/learn/lessons.js';
import { memoryDriver, createStorage } from '../src/storage.js';

/** Reads the real committed lesson data from disk (public/ is not in the module path). */
const BASE = new URL('../public/data/lessons/', import.meta.url);
const readJson = async (url) => JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
const opts = { base: BASE, fetchJson: readJson };

/* ------------------------------------------------------------- grading -- */

test('choose: a matching option scores 1, anything else 0', () => {
  const ex = { type: 'choose', prompt: 'What does 谢谢 mean?', options: ['thank you', 'bye'], answer: 'thank you' };
  const right = gradeExercise(ex, 'thank you');
  assert.equal(right.correct, true);
  assert.equal(right.score, 1);
  assert.equal(right.expected, 'thank you');
  assert.equal(right.given, 'thank you');

  const wrong = gradeExercise(ex, 'bye');
  assert.equal(wrong.correct, false);
  assert.equal(wrong.score, 0);

  const empty = gradeExercise(ex, '');
  assert.equal(empty.correct, false, 'an empty response is never correct');
});

test('listen: graded like choose (audio field is ignored by the grader)', () => {
  const ex = { type: 'listen', audio: '你好', options: ['你好', '再见'], answer: '你好' };
  assert.equal(gradeExercise(ex, '你好').correct, true);
  assert.equal(gradeExercise(ex, '再见').correct, false);
});

test('order: joins tokens and compares against the answer (string or array)', () => {
  const ex = { type: 'order', tokens: ['个', '人', '五'], answer: '五个人' };
  assert.equal(gradeExercise(ex, ['五', '个', '人']).correct, true);
  assert.equal(gradeExercise(ex, ['个', '五', '人']).correct, false);
  assert.equal(gradeExercise(ex, '五个人').correct, true, 'a plain string response works too');

  const arrayAnswer = { type: 'order', tokens: ['好', '你'], answer: ['你', '好'] };
  assert.equal(gradeExercise(arrayAnswer, ['你', '好']).correct, true);
});

test('match: partial credit over the declared pairs', () => {
  const ex = {
    type: 'match',
    pairs: [
      { hanzi: '你', english: 'you' },
      { hanzi: '谢谢', english: 'thank you' },
      { hanzi: '再见', english: 'goodbye' },
    ],
  };
  const full = gradeExercise(ex, { 你: 'you', 谢谢: 'thank you', 再见: 'goodbye' });
  assert.equal(full.correct, true);
  assert.equal(full.score, 1);

  const partial = gradeExercise(ex, { 你: 'you', 谢谢: 'goodbye', 再见: 'goodbye' });
  assert.equal(partial.correct, false);
  assert.equal(partial.score, 2 / 3);
  assert.equal(partial.matched, 2);

  const pairsList = gradeExercise(ex, [['你', 'you'], ['谢谢', 'thank you'], ['再见', 'goodbye']]);
  assert.equal(pairsList.correct, true, 'a list of [left, right] pairs is accepted');
});

test('unknown exercise type throws (same style as srs rejecting a bad rating)', () => {
  assert.throws(() => gradeExercise({ type: 'sing' }, 'x'), /unknown type/);
  assert.equal(isExerciseType('choose'), true);
  assert.equal(isExerciseType('sing'), false);
  assert.deepEqual(EXERCISE_TYPES, ['choose', 'match', 'order', 'listen']);
});

test('summarize aggregates results into correct/total/score', () => {
  const results = [
    { correct: true, score: 1 },
    { correct: false, score: 0 },
    { correct: false, score: 0.5 },
  ];
  const summary = summarize(results);
  assert.equal(summary.correct, 1);
  assert.equal(summary.total, 3);
  assert.equal(summary.score, 1.5 / 3);
  assert.deepEqual(summarize([]), { correct: 0, total: 0, score: 0 });
});

/* --------------------------------------------------------- lesson data -- */

test('loadIndex reads the committed HSK1 plan: 10 lessons with ranges', async () => {
  const index = await loadIndex('hsk1', opts);
  assert.equal(index.level, 'hsk1');
  assert.equal(index.lessons.length, 10);
  for (const lesson of index.lessons) {
    assert.match(lesson.id, /^hsk1-\d\d$/);
    assert.ok(lesson.file, `${lesson.id} declares a file`);
    if (!lesson.curated) {
      assert.equal(lesson.range.to - lesson.range.from + 1, index.wordsPerLesson);
    }
  }
});

test('loadLesson reads lesson-01 and it uses all four exercise types', async () => {
  const lesson = await loadLesson('hsk1', 'hsk1-01', opts);
  assert.equal(lesson.id, 'hsk1-01');
  assert.ok(lesson.vocabulary.length >= 10, 'has vocabulary');
  assert.ok(lesson.exercises.length >= 4, 'has exercises');
  const types = new Set(lesson.exercises.map((exercise) => exercise.type));
  assert.deepEqual([...types].sort(), ['choose', 'listen', 'match', 'order']);
  for (const word of lesson.vocabulary) {
    assert.ok(word.hanzi && word.pinyin && word.english, 'vocabulary entries are complete');
  }
});

test('every lesson-01 exercise grades as correct when answered with its answer', async () => {
  const lesson = await loadLesson('hsk1', 'hsk1-01', opts);
  for (const exercise of lesson.exercises) {
    const response =
      exercise.type === 'match'
        ? Object.fromEntries(exercise.pairs.map((pair) => [pair.hanzi, pair.english]))
        : exercise.type === 'order'
          ? exercise.answer.split('')
          : exercise.answer;
    const result = gradeExercise(exercise, response);
    assert.equal(result.correct, true, `${exercise.type} "${exercise.prompt}" should be gradeable as correct`);
  }
});

/* ----------------------------------------------------------- progress -- */

test('progress round-trips through the store and survives a new reader', async () => {
  const store = createStorage(memoryDriver());
  assert.equal(await getProgress('hsk1', 'hsk1-01', { store }), null);

  await saveProgress('hsk1', 'hsk1-01', { score: 3, total: 8, answered: 3, completed: false }, { store, now: 1 });
  const partial = await getProgress('hsk1', 'hsk1-01', { store });
  assert.equal(partial.answered, 3);
  assert.equal(partial.completed, false);

  await saveProgress('hsk1', 'hsk1-01', { score: 7, answered: 8, completed: true }, { store, now: 2 });
  const done = await getProgress('hsk1', 'hsk1-01', { store });
  assert.equal(done.completed, true);
  assert.equal(done.score, 7);
  assert.equal(done.total, 8, 'unset fields are kept from the previous record');
  assert.equal(progressKey('hsk1', 'hsk1-01'), 'hsk1:hsk1-01');
});
