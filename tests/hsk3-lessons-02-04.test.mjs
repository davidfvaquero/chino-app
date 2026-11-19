import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadIndex, loadLesson } from '../src/learn/lessons.js';
import { gradeExercise } from '../src/learn/exercises.js';

const BASE = new URL('../public/data/lessons/', import.meta.url);
const readJson = async (url) => JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
const opts = { base: BASE, fetchJson: readJson };

const hsk3 = JSON.parse(readFileSync(new URL('../public/data/hsk/3.json', import.meta.url), 'utf8'));
const words = hsk3.items;

test('hsk3 lesson-02 is complete and uses all four exercise types', async () => {
  const lesson = await loadLesson('hsk3', 'hsk3-02', opts);
  assert.equal(lesson.id, 'hsk3-02');
  assert.ok(lesson.title && lesson.intro, 'has a title and an intro');
  assert.ok(lesson.vocabulary.length >= 10, 'has vocabulary');
  assert.ok(lesson.exercises.length >= 4, 'has exercises');
  const types = new Set(lesson.exercises.map((exercise) => exercise.type));
  assert.deepEqual([...types].sort(), ['choose', 'listen', 'match', 'order']);
  for (const word of lesson.vocabulary) {
    assert.ok(word.hanzi && word.pinyin && word.english, 'vocabulary entries are complete');
  }
});

test('lesson-02 vocabulary is the HSK 3 words 31..60 (simplified form)', async () => {
  const lesson = await loadLesson('hsk3', 'hsk3-02', opts);
  const expect = words.slice(30, 60).map((word) => word.hanzi);
  const got = lesson.vocabulary.map((word) => word.hanzi);
  assert.deepEqual(got, expect, 'vocabulary is the alphabetical slice 31..60, using the simplified hanzi field');
});

test('lesson-02 shows no traditional-only characters anywhere', async () => {
  const simp = new Set(words.flatMap((word) => [...word.hanzi]));
  const tradOnly = new Set(words.flatMap((word) => [...word.trad]).filter((char) => !simp.has(char)));
  const lesson = await loadLesson('hsk3', 'hsk3-02', opts);
  const text = JSON.stringify(lesson) + JSON.stringify(lesson.exercises);
  const bad = [...text].filter((char) => tradOnly.has(char));
  assert.deepEqual(bad, [], `found traditional-only characters: ${bad.join('')}`);
});

test('every lesson-02 exercise grades as correct when answered with its answer', async () => {
  const lesson = await loadLesson('hsk3', 'hsk3-02', opts);
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

test('hsk3 lesson-03 is complete and uses all four exercise types', async () => {
  const lesson = await loadLesson('hsk3', 'hsk3-03', opts);
  assert.equal(lesson.id, 'hsk3-03');
  assert.ok(lesson.title && lesson.intro, 'has a title and an intro');
  assert.ok(lesson.vocabulary.length >= 10, 'has vocabulary');
  assert.ok(lesson.exercises.length >= 4, 'has exercises');
  const types = new Set(lesson.exercises.map((exercise) => exercise.type));
  assert.deepEqual([...types].sort(), ['choose', 'listen', 'match', 'order']);
  for (const word of lesson.vocabulary) {
    assert.ok(word.hanzi && word.pinyin && word.english, 'vocabulary entries are complete');
  }
});

test('lesson-03 vocabulary is the HSK 3 words 61..90 (simplified form)', async () => {
  const lesson = await loadLesson('hsk3', 'hsk3-03', opts);
  const expect = words.slice(60, 90).map((word) => word.hanzi);
  const got = lesson.vocabulary.map((word) => word.hanzi);
  assert.deepEqual(got, expect, 'vocabulary is the alphabetical slice 61..90, using the simplified hanzi field');
});

test('lesson-03 shows no traditional-only characters anywhere', async () => {
  const simp = new Set(words.flatMap((word) => [...word.hanzi]));
  const tradOnly = new Set(words.flatMap((word) => [...word.trad]).filter((char) => !simp.has(char)));
  const lesson = await loadLesson('hsk3', 'hsk3-03', opts);
  const text = JSON.stringify(lesson) + JSON.stringify(lesson.exercises);
  const bad = [...text].filter((char) => tradOnly.has(char));
  assert.deepEqual(bad, [], `found traditional-only characters: ${bad.join('')}`);
});

test('every lesson-03 exercise grades as correct when answered with its answer', async () => {
  const lesson = await loadLesson('hsk3', 'hsk3-03', opts);
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

test('hsk3 lesson-04 is complete and uses all four exercise types', async () => {
  const lesson = await loadLesson('hsk3', 'hsk3-04', opts);
  assert.equal(lesson.id, 'hsk3-04');
  assert.ok(lesson.title && lesson.intro, 'has a title and an intro');
  assert.ok(lesson.vocabulary.length >= 10, 'has vocabulary');
  assert.ok(lesson.exercises.length >= 4, 'has exercises');
  const types = new Set(lesson.exercises.map((exercise) => exercise.type));
  assert.deepEqual([...types].sort(), ['choose', 'listen', 'match', 'order']);
  for (const word of lesson.vocabulary) {
    assert.ok(word.hanzi && word.pinyin && word.english, 'vocabulary entries are complete');
  }
});

test('lesson-04 vocabulary is the HSK 3 words 91..120 (simplified form)', async () => {
  const lesson = await loadLesson('hsk3', 'hsk3-04', opts);
  const expect = words.slice(90, 120).map((word) => word.hanzi);
  const got = lesson.vocabulary.map((word) => word.hanzi);
  assert.deepEqual(got, expect, 'vocabulary is the alphabetical slice 91..120, using the simplified hanzi field');
});

test('lesson-04 shows no traditional-only characters anywhere', async () => {
  const simp = new Set(words.flatMap((word) => [...word.hanzi]));
  const tradOnly = new Set(words.flatMap((word) => [...word.trad]).filter((char) => !simp.has(char)));
  const lesson = await loadLesson('hsk3', 'hsk3-04', opts);
  const text = JSON.stringify(lesson) + JSON.stringify(lesson.exercises);
  const bad = [...text].filter((char) => tradOnly.has(char));
  assert.deepEqual(bad, [], `found traditional-only characters: ${bad.join('')}`);
});

test('every lesson-04 exercise grades as correct when answered with its answer', async () => {
  const lesson = await loadLesson('hsk3', 'hsk3-04', opts);
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