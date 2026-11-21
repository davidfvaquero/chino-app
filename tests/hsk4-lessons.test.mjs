// HSK 4 lesson plan index validation.
// Run with `node --test tests/hsk4-lessons.test.mjs`.
// Validates the committed index against docs/lesson-schema.md and the word
// ranges in public/data/lessons/hsk4/index.json, and checks that every
// exercise grades as correct when answered with its answer (same contract as
// tests/exercises.test.mjs). Mirrors tests/hsk3-lessons.test.mjs.
// Skips lesson files that don't exist yet so the test passes now and watches
// when they arrive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadIndex, loadLesson, LEVELS } from '../src/learn/lessons.js';
import { gradeExercise } from '../src/learn/exercises.js';

const BASE = new URL('../public/data/lessons/', import.meta.url);
const readJson = async (url) => JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
const opts = { base: BASE, fetchJson: readJson };

const hsk4 = JSON.parse(readFileSync(new URL('../public/data/hsk/4.json', import.meta.url), 'utf8'));
const words = hsk4.items;

test('the HSK 4 level is selectable in the lessons picker', () => {
  assert.ok(LEVELS.includes('hsk4'), 'LEVELS exposes hsk4');
});

test('the picker has an "HSK 4" label shard (en + es)', () => {
  for (const locale of ['en', 'es']) {
    const shard = JSON.parse(
      readFileSync(new URL(`../src/locales/${locale}.d/hsk4.json`, import.meta.url), 'utf8'),
    );
    assert.equal(shard.hsk4.level, 'HSK 4', `${locale}.d/hsk4.json labels the level "HSK 4"`);
  }
});

test('hsk4 index: 20 lessons whose ranges tile the 598-word list', async () => {
  const index = await loadIndex('hsk4', opts);
  assert.equal(index.level, 'hsk4');
  assert.equal(index.wordCount, words.length);
  assert.equal(index.lessons.length, 20);
  assert.equal(index.wordsPerLesson, 30);

  let expectedFrom = 1;
  index.lessons.forEach((lesson, i) => {
    assert.match(lesson.id, /^hsk4-\d\d$/);
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

test('hsk4 lessons that exist validate schema, vocabulary range and exercise grading', async () => {
  const index = await loadIndex('hsk4', opts);
  for (const meta of index.lessons) {
    // Skip lessons whose file does not exist yet (filler tasks will add them later).
    try {
      const lesson = await loadLesson('hsk4', meta.id, opts);
      assert.equal(lesson.id, meta.id);
      assert.ok(lesson.title && lesson.intro, 'has a title and an intro');
      assert.ok(lesson.vocabulary.length >= 10, 'has vocabulary');
      assert.ok(lesson.exercises.length >= 4, 'has exercises');
      const types = new Set(lesson.exercises.map((exercise) => exercise.type));
      assert.deepEqual([...types].sort(), ['choose', 'listen', 'match', 'order']);
      for (const word of lesson.vocabulary) {
        assert.ok(word.hanzi && word.pinyin && word.english, 'vocabulary entries are complete');
      }

      // Vocabulary matches the reserved HSK slice for non-curated lessons.
      if (meta.range && !meta.curated) {
        const expected = words.slice(meta.range.from - 1, meta.range.to).map((word) => word.hanzi);
        const got = lesson.vocabulary.map((word) => word.hanzi);
        assert.deepEqual(got, expected, `vocabulary is the HSK slice ${meta.range.from}..${meta.range.to}`);
      }

      // No traditional-only characters (same technique as hsk3-lessons.test.mjs).
      const simp = new Set(words.flatMap((word) => [...word.hanzi]));
      const tradOnly = new Set(words.flatMap((word) => [...word.trad]).filter((char) => !simp.has(char)));
      const text = JSON.stringify(lesson) + JSON.stringify(lesson.exercises);
      const bad = [...text].filter((char) => tradOnly.has(char));
      assert.deepEqual(bad, [], `found traditional-only characters: ${bad.join('')}`);

      // Every exercise grades as correct when answered with its answer.
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
    } catch (err) {
      if (err.code === 'ENOENT' || String(err.message).includes('unknown lesson')) {
        // Lesson file not written yet — skip, so the test passes now and watches when it arrives.
        continue;
      }
      throw err;
    }
  }
});