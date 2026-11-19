// Quick validation for lessons 8-10
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLesson } from '../src/learn/lessons.js';
import { gradeExercise } from '../src/learn/exercises.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = new URL('../public/data/lessons/', import.meta.url);
const readJson = async (url) => JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
const opts = { base: BASE, fetchJson: readJson };

for (const id of ['hsk3-08', 'hsk3-09', 'hsk3-10']) {
  test(`lesson ${id} loads and validates`, async () => {
    const lesson = await loadLesson('hsk3', id, opts);
    assert.ok(lesson.id === id);
    assert.ok(lesson.title && lesson.intro, 'has title and intro');
    assert.ok(lesson.vocabulary.length >= 27, `has vocabulary (${lesson.vocabulary.length} words)`);
    assert.ok(lesson.exercises.length >= 6, `has exercises (${lesson.exercises.length})`);
    const types = new Set(lesson.exercises.map((e) => e.type));
    const requiredTypes = ['choose', 'listen', 'match', 'order'];
    for (const rt of requiredTypes) {
      assert.ok(types.has(rt), `has exercise type ${rt}`);
    }
    for (const word of lesson.vocabulary) {
      assert.ok(word.hanzi && word.pinyin && word.english, 'vocabulary entries complete');
      assert.ok(word.example, 'has example');
    }
    for (const exercise of lesson.exercises) {
      const response =
        exercise.type === 'match'
          ? Object.fromEntries(exercise.pairs.map((pair) => [pair.hanzi, pair.english]))
          : exercise.type === 'order'
            ? exercise.answer.split('')
            : exercise.answer;
      const result = gradeExercise(exercise, response);
      assert.equal(result.correct, true, `${exercise.type} "${exercise.prompt}" grades correct`);
    }
  });
}

test('lesson 8 vocabulary matches HSK 3 words 211-240', async () => {
  const hsk3 = JSON.parse(readFileSync(new URL('../public/data/hsk/3.json', import.meta.url), 'utf8'));
  const lesson = await loadLesson('hsk3', 'hsk3-08', opts);
  const expected = hsk3.items.slice(210, 240).map(w => w.hanzi);
  const got = lesson.vocabulary.map(w => w.hanzi);
  assert.deepEqual(got, expected);
});

test('lesson 9 vocabulary matches HSK 3 words 241-270', async () => {
  const hsk3 = JSON.parse(readFileSync(new URL('../public/data/hsk/3.json', import.meta.url), 'utf8'));
  const lesson = await loadLesson('hsk3', 'hsk3-09', opts);
  const expected = hsk3.items.slice(240, 270).map(w => w.hanzi);
  const got = lesson.vocabulary.map(w => w.hanzi);
  assert.deepEqual(got, expected);
});

test('lesson 10 vocabulary matches HSK 3 words 271-297', async () => {
  const hsk3 = JSON.parse(readFileSync(new URL('../public/data/hsk/3.json', import.meta.url), 'utf8'));
  const lesson = await loadLesson('hsk3', 'hsk3-10', opts);
  const expected = hsk3.items.slice(270, 297).map(w => w.hanzi);
  const got = lesson.vocabulary.map(w => w.hanzi);
  assert.deepEqual(got, expected);
});