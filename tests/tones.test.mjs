import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gradeExercise, summarize } from '../src/learn/exercises.js';
import { loadLesson as loadTonesLesson, getProgress, saveProgress, progressKey } from '../src/learn/tones.js';

/** Reads the tones lesson data from disk. */
const BASE = new URL('../public/data/lessons/', import.meta.url);
const readJson = async (url) => JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
const opts = { base: BASE, fetchJson: readJson };

/* ------------------------------------------------------------ grading -- */

test('listen: grades correctly when the chosen tone matches the audio', () => {
  const ex = {
    type: 'listen',
    audio: 'mā',
    pinyin: 'mā',
    prompt: 'Listen and choose the tone you hear.',
    options: ['1st tone (mā)', '2nd tone (má)', '3rd tone (mǎ)', '4th tone (mà)', 'Neutral (ma)'],
    answer: '1st tone (mā)'
  };
  const right = gradeExercise(ex, '1st tone (mā)');
  assert.equal(right.correct, true);
  assert.equal(right.score, 1);
  assert.equal(right.expected, '1st tone (mā)');
  assert.equal(right.given, '1st tone (mā)');

  const wrong = gradeExercise(ex, '2nd tone (má)');
  assert.equal(wrong.correct, false);
  assert.equal(wrong.score, 0);
});

test('choose: grades correctly for tone identification exercises', () => {
  const ex = {
    type: 'choose',
    prompt: 'Which pinyin represents the 1st tone (high flat)?',
    options: ['mā', 'má', 'mǎ', 'mà', 'ma'],
    answer: 'mā'
  };
  const right = gradeExercise(ex, 'mā');
  assert.equal(right.correct, true);
  assert.equal(right.score, 1);

  const wrong = gradeExercise(ex, 'ma');
  assert.equal(wrong.correct, false);
  assert.equal(wrong.score, 0);
});

test('all five tones have exercises in the tones lesson', async () => {
  const lesson = await loadTonesLesson(opts);
  const tonesInVocab = new Set(lesson.vocabulary.map(v => v.tone));
  assert.deepEqual([...tonesInVocab].sort((a,b) => a-b), [0, 1, 2, 3, 4]);

  const listenExercises = lesson.exercises.filter(e => e.type === 'listen');
  assert.equal(listenExercises.length, 5, 'one listen exercise per tone');

  const chooseExercises = lesson.exercises.filter(e => e.type === 'choose');
  assert.equal(chooseExercises.length, 5, 'one choose exercise per tone');
});

test('every tones exercise grades as correct when answered with its answer', async () => {
  const lesson = await loadTonesLesson(opts);
  for (const exercise of lesson.exercises) {
    const result = gradeExercise(exercise, exercise.answer);
    assert.equal(result.correct, true, `${exercise.type} "${exercise.promptKey || exercise.prompt}" should be gradeable as correct`);
  }
});

/* ------------------------------------------------------------- progress -- */

test('progress round-trips for the tones lesson', async () => {
  const { memoryDriver, createStorage } = await import('../src/storage.js');
  const store = createStorage(memoryDriver());

  assert.equal(await getProgress({ store }), null);

  await saveProgress({ score: 5, total: 10, answered: 5, completed: false }, { store, now: 1 });
  const partial = await getProgress({ store });
  assert.equal(partial.answered, 5);
  assert.equal(partial.completed, false);

  await saveProgress({ score: 9, answered: 10, completed: true }, { store, now: 2 });
  const done = await getProgress({ store });
  assert.equal(done.completed, true);
  assert.equal(done.score, 9);
  assert.equal(done.total, 10, 'unset fields are kept from the previous record');
  assert.equal(progressKey(), 'hsk1:tones');
});

/* ------------------------------------------------ syllable/tone choice -- */

test('listen exercises: the audio is the named syllable and its tone is selectable', async () => {
  const lesson = await loadTonesLesson(opts);
  const listen = lesson.exercises.filter(e => e.type === 'listen');
  for (const ex of listen) {
    assert.equal(ex.audio, ex.pinyin, `${ex.audio}: audio matches the pinyin syllable`);
    assert.ok(ex.options.includes(ex.answer), `${ex.audio}: correct tone is among the options`);
    assert.ok(ex.answer.includes(ex.pinyin), `${ex.audio}: answer names the played syllable`);
  }
});

test('every exercise offers unique options and includes its answer', async () => {
  const lesson = await loadTonesLesson(opts);
  const toneChoices = ['1st tone (mā)', '2nd tone (má)', '3rd tone (mǎ)', '4th tone (mà)', 'Neutral (ma)'];
  for (const ex of lesson.exercises) {
    assert.equal(new Set(ex.options).size, ex.options.length, 'options are unique');
    assert.ok(ex.options.includes(ex.answer), 'the answer is one of the options');
    if (ex.type === 'listen') assert.deepEqual(ex.options, toneChoices);
  }
});

test('the five choose answers cover the five tones in order', async () => {
  const lesson = await loadTonesLesson(opts);
  const answers = lesson.exercises.filter(e => e.type === 'choose').map(e => e.answer);
  assert.deepEqual(answers, ['mā', 'má', 'mǎ', 'mà', 'ma']);
});