// HSK 3 lesson plan + lesson-01 data.
// Run with `node --test tests/hsk3-lessons.test.mjs`.
//
// Validates the committed data against docs/lesson-schema.md and the word
// ranges in public/data/lessons/hsk3/index.json, and checks that every
// exercise grades as correct when answered with its answer (same contract as
// tests/exercises.test.mjs). Mirrors tests/hsk2-lessons.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadIndex, loadLesson, LEVELS } from '../src/learn/lessons.js';
import { gradeExercise } from '../src/learn/exercises.js';

const BASE = new URL('../public/data/lessons/', import.meta.url);
const readJson = async (url) => JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
const opts = { base: BASE, fetchJson: readJson };

const hsk3 = JSON.parse(readFileSync(new URL('../public/data/hsk/3.json', import.meta.url), 'utf8'));
const words = hsk3.items;

test('the HSK 3 level is selectable in the lessons picker', () => {
  assert.ok(LEVELS.includes('hsk3'), 'LEVELS exposes hsk3');
});

test('the picker has an "HSK 3" label shard (en + es)', () => {
  for (const locale of ['en', 'es']) {
    const shard = JSON.parse(
      readFileSync(new URL(`../src/locales/${locale}.d/hsk3.json`, import.meta.url), 'utf8'),
    );
    assert.equal(shard.hsk3.level, 'HSK 3', `${locale}.d/hsk3.json labels the level "HSK 3"`);
  }
});

test('hsk3 index: 10 lessons whose ranges tile the 297-word list', async () => {
  const index = await loadIndex('hsk3', opts);
  assert.equal(index.level, 'hsk3');
  assert.equal(index.wordCount, words.length);
  assert.equal(index.lessons.length, 10);

  let expectedFrom = 1;
  index.lessons.forEach((lesson, i) => {
    assert.match(lesson.id, /^hsk3-\d\d$/);
    assert.ok(lesson.file, `${lesson.id} declares a file`);
    assert.equal(lesson.range.from, expectedFrom, `${lesson.id} continues where the previous ended`);
    assert.ok(lesson.range.to >= lesson.range.from, `${lesson.id} has a valid range`);
    if (!lesson.curated) {
      const expectedTo = i === index.lessons.length - 1 ? words.length : lesson.range.from + index.wordsPerLesson - 1;
      assert.equal(lesson.range.to, expectedTo, `${lesson.id} takes its slot of the word list`);
    }
    expectedFrom = lesson.range.to + 1;
  });
  assert.equal(expectedFrom - 1, words.length, 'the ranges cover every word exactly once');
});

test('hsk3 lesson-01 is complete and uses all four exercise types', async () => {
  const lesson = await loadLesson('hsk3', 'hsk3-01', opts);
  assert.equal(lesson.id, 'hsk3-01');
  assert.ok(lesson.title && lesson.intro, 'has a title and an intro');
  assert.ok(lesson.vocabulary.length >= 10, 'has vocabulary');
  assert.ok(lesson.exercises.length >= 4, 'has exercises');
  const types = new Set(lesson.exercises.map((exercise) => exercise.type));
  assert.deepEqual([...types].sort(), ['choose', 'listen', 'match', 'order']);
  for (const word of lesson.vocabulary) {
    assert.ok(word.hanzi && word.pinyin && word.english, 'vocabulary entries are complete');
  }
});

test('lesson-01 vocabulary is the first 30 HSK 3 words (simplified form)', async () => {
  const lesson = await loadLesson('hsk3', 'hsk3-01', opts);
  const expect = words.slice(0, 30).map((word) => word.hanzi);
  const got = lesson.vocabulary.map((word) => word.hanzi);
  assert.deepEqual(got, expect, 'vocabulary is the alphabetical slice 1..30, using the simplified hanzi field');
});

test('lesson-01 shows no traditional-only characters anywhere', async () => {
  // A character is traditional-only when it appears in some word's `trad` but
  // in no word's simplified `hanzi`.
  const simp = new Set(words.flatMap((word) => [...word.hanzi]));
  const tradOnly = new Set(words.flatMap((word) => [...word.trad]).filter((char) => !simp.has(char)));
  const lesson = await loadLesson('hsk3', 'hsk3-01', opts);
  const text = JSON.stringify(lesson) + JSON.stringify(lesson.exercises);
  const bad = [...text].filter((char) => tradOnly.has(char));
  assert.deepEqual(bad, [], `found traditional-only characters: ${bad.join('')}`);
});

test('every lesson-01 exercise grades as correct when answered with its answer', async () => {
  const lesson = await loadLesson('hsk3', 'hsk3-01', opts);
  for (const exercise of lesson.exercises) {
    const response =
      exercise.type === 'match'
        ? Object.fromEntries(exercise.pairs.map((pair) => [pair.hanzi, pair.english]))
        : exercise.type === 'order'
          ? exercise.answer.split('')
          : exercise.answer;
    const result = gradeExercise(exercise, response);
    assert.equal(result.correct, true, `${exercise.type} "${exercise.prompt}" should grade as correct`);
  }
});
