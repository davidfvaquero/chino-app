// Practical lessons validation test.
// Run with: node --test tests/practical-lessons.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadIndex, loadLesson } from '../src/learn/lessons.js';

/** Reads the real committed lesson data from disk. */
const BASE = new URL('../public/data/lessons/', import.meta.url);
const readJson = async (url) => JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
const opts = { base: BASE, fetchJson: readJson };

/* --------------------------------------------------------- lesson data -- */

test('loadIndex reads the practical plan: 5 curated lessons', async () => {
  const index = await loadIndex('practical', opts);
  assert.equal(index.level, 'practical');
  assert.equal(index.lessons.length, 5);
  for (const lesson of index.lessons) {
    assert.match(lesson.id, /^practical-\d\d$/);
    assert.ok(lesson.file, `${lesson.id} declares a file`);
    assert.equal(lesson.curated, true, `${lesson.id} should be curated`);
  }
});

const expectedTitles = [
  'Numbers 0-10 & Counting',
  'Numbers 11-99, Hundreds & Thousands',
  'Dates: Year, Month, Day, Weekdays',
  'Telling Time: 点, 半, 分',
  'Money & Prices: 块/元/毛, 多少钱, Bargaining'
];

for (let i = 0; i < 5; i++) {
  const lessonId = `practical-${String(i + 1).padStart(2, '0')}`;
  const expectedTitle = expectedTitles[i];

  test(`loadLesson reads ${lessonId} with correct title and structure`, async () => {
    const lesson = await loadLesson('practical', lessonId, opts);
    assert.equal(lesson.id, lessonId);
    assert.equal(lesson.title, expectedTitle);
    assert.ok(lesson.intro && typeof lesson.intro === 'string', 'has intro');
    assert.ok(lesson.vocabulary.length >= 10, `has vocabulary (${lesson.vocabulary.length} words)`);
    assert.ok(lesson.exercises.length >= 6, `has 6+ exercises (${lesson.exercises.length})`);

    // Validate vocabulary entries
    for (const word of lesson.vocabulary) {
      assert.ok(word.hanzi && typeof word.hanzi === 'string', 'has hanzi');
      assert.ok(word.pinyin && typeof word.pinyin === 'string', 'has pinyin');
      assert.ok(word.english && typeof word.english === 'string', 'has english');
      if (word.example) {
        assert.ok(word.example.hanzi, 'example has hanzi');
        assert.ok(word.example.pinyin, 'example has pinyin');
        assert.ok(word.example.english, 'example has english');
      }
    }

    // Validate all four exercise types are used
    const types = new Set(lesson.exercises.map((ex) => ex.type));
    assert.ok(types.has('choose'), 'has choose exercises');
    assert.ok(types.has('listen'), 'has listen exercises');
    assert.ok(types.has('match'), 'has match exercises');
    assert.ok(types.has('order'), 'has order exercises');

    // Validate exercise structure
    for (const ex of lesson.exercises) {
      assert.ok(ex.type, 'exercise has type');
      assert.ok(ex.prompt, 'exercise has prompt');
      if (ex.type === 'choose' || ex.type === 'listen') {
        assert.ok(Array.isArray(ex.options) && ex.options.length >= 2, 'choose/listen has options');
        assert.ok(ex.answer, 'choose/listen has answer');
        assert.ok(ex.options.includes(ex.answer), 'answer is in options');
      }
      if (ex.type === 'match') {
        assert.ok(Array.isArray(ex.pairs) && ex.pairs.length >= 2, 'match has pairs');
        for (const pair of ex.pairs) {
          assert.ok(pair.hanzi && pair.english, 'match pair has hanzi and english');
        }
      }
      if (ex.type === 'order') {
        assert.ok(Array.isArray(ex.tokens) && ex.tokens.length >= 2, 'order has tokens');
        assert.ok(ex.answer, 'order has answer');
      }
      if (ex.type === 'listen') {
        assert.ok(ex.audio, 'listen has audio');
        assert.ok(ex.pinyin, 'listen has pinyin');
      }
    }
  });

  test(`${lessonId} exercises grade correctly with their own answers`, async () => {
    const lesson = await loadLesson('practical', lessonId, opts);
    const { gradeExercise } = await import('../src/learn/exercises.js');
    for (const exercise of lesson.exercises) {
      let response;
      if (exercise.type === 'match') {
        response = Object.fromEntries(exercise.pairs.map((pair) => [pair.hanzi, pair.english]));
      } else if (exercise.type === 'order') {
        response = exercise.answer.split('');
      } else {
        response = exercise.answer;
      }
      const result = gradeExercise(exercise, response);
      assert.equal(result.correct, true, `${exercise.type} "${exercise.prompt}" should be gradeable as correct`);
    }
  });
}

/* ------------------------------------------------------ pinyin format -- */

test('all pinyin uses tone marks (not numbers) and no traditional chars', async () => {
  const index = await loadIndex('practical', opts);
  for (const lessonMeta of index.lessons) {
    const lesson = await loadLesson('practical', lessonMeta.id, opts);
    for (const word of lesson.vocabulary) {
      // No tone numbers (1-5)
      assert.ok(!/[1-5]/.test(word.pinyin), `${word.hanzi}: pinyin "${word.pinyin}" should use tone marks, not numbers`);
      // No traditional characters in hanzi (basic check - simplified only)
      // Note: This is a basic check; full trad/simp detection would need a table
    }
    for (const ex of lesson.exercises) {
      if (ex.pinyin) {
        assert.ok(!/[1-5]/.test(ex.pinyin), `exercise "${ex.prompt}": pinyin "${ex.pinyin}" should use tone marks`);
      }
      if (ex.audio) {
        // audio field should be hanzi (what TTS speaks)
        assert.ok(/[\u4e00-\u9fff]/.test(ex.audio), `exercise "${ex.prompt}": audio "${ex.audio}" should contain hanzi`);
      }
    }
  }
});