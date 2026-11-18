// HSK 2 lesson plan + lesson-01 data (task t_20c97fb4).
// Run with `node --test tests/hsk2-lessons.test.mjs`.
//
// Validates the committed data against docs/lesson-schema.md and the word
// ranges in public/data/lessons/hsk2/index.json, and checks that every
// exercise grades as correct when answered with its answer (same contract as
// tests/exercises.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadIndex, loadLesson, LEVELS } from '../src/learn/lessons.js';
import { gradeExercise } from '../src/learn/exercises.js';

const BASE = new URL('../public/data/lessons/', import.meta.url);
const readJson = async (url) => JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
const opts = { base: BASE, fetchJson: readJson };

const hsk2 = JSON.parse(readFileSync(new URL('../public/data/hsk/2.json', import.meta.url), 'utf8'));
const words = hsk2.items;

test('the HSK 2 level is selectable in the lessons picker', () => {
  assert.ok(LEVELS.includes('hsk2'), 'LEVELS exposes hsk2');
});

test('hsk2 index: 10 lessons whose ranges tile the 151-word list', async () => {
  const index = await loadIndex('hsk2', opts);
  assert.equal(index.level, 'hsk2');
  assert.equal(index.wordCount, words.length);
  assert.equal(index.lessons.length, 10);

  let expectedFrom = 1;
  index.lessons.forEach((lesson, i) => {
    assert.match(lesson.id, /^hsk2-\d\d$/);
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

test('hsk2 lesson-01 is complete and uses all four exercise types', async () => {
  const lesson = await loadLesson('hsk2', 'hsk2-01', opts);
  assert.equal(lesson.id, 'hsk2-01');
  assert.ok(lesson.title && lesson.intro, 'has a title and an intro');
  assert.ok(lesson.vocabulary.length >= 10, 'has vocabulary');
  assert.ok(lesson.exercises.length >= 4, 'has exercises');
  const types = new Set(lesson.exercises.map((exercise) => exercise.type));
  assert.deepEqual([...types].sort(), ['choose', 'listen', 'match', 'order']);
  for (const word of lesson.vocabulary) {
    assert.ok(word.hanzi && word.pinyin && word.english, 'vocabulary entries are complete');
  }
});

test('lesson-01 vocabulary is the first 15 HSK 2 words (simplified form)', async () => {
  const lesson = await loadLesson('hsk2', 'hsk2-01', opts);
  const expect = words.slice(0, 15).map((word) => word.hanzi);
  const got = lesson.vocabulary.map((word) => word.hanzi);
  assert.deepEqual(got, expect, 'vocabulary is the alphabetical slice 1..15, using the simplified hanzi field');
});

test('lesson-01 shows no traditional-only characters anywhere', async () => {
  // A character is traditional-only when it appears in some word's `trad` but
  // in no word's simplified `hanzi`.
  const simp = new Set(words.flatMap((word) => [...word.hanzi]));
  const tradOnly = new Set(words.flatMap((word) => [...word.trad]).filter((char) => !simp.has(char)));
  const lesson = await loadLesson('hsk2', 'hsk2-01', opts);
  const text = JSON.stringify(lesson) + JSON.stringify(lesson.exercises);
  const bad = [...text].filter((char) => tradOnly.has(char));
  assert.deepEqual(bad, [], `found traditional-only characters: ${bad.join('')}`);
});

test('every lesson-01 exercise grades as correct when answered with its answer', async () => {
  const lesson = await loadLesson('hsk2', 'hsk2-01', opts);
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
