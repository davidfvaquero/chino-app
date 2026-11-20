/**
 * Lesson error loop (design round 2, task A): the failure text names the right
 * answer, the result screen offers "review what I missed" (and it feeds the
 * review deck) + "repeat lesson", the feedback is a live region, and typing no
 * longer kills the focus ring.
 *
 * Run with `node --test tests/lesson-error-loop.test.mjs` or `npm test`.
 * The DOM flow itself (which buttons appear, when the pinyin is hidden by the
 * global switch) is verified in headless Chrome — see the task handoff.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { missedVocabulary, expectedAnswer, gradeExercise } from '../src/learn/exercises.js';
import { createDeck } from '../src/srs.js';
import { tonelessKey } from '../src/pinyin.js';
import { memoryDriver, createStorage } from '../src/storage.js';

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const LESSON = readJson('../public/data/lessons/hsk1/lesson-01.json');
const ES = readJson('../src/locales/es.d/learn.json').learn.lessons;
const EN = readJson('../src/locales/en.d/learn.json').learn.lessons;

/* ---------------------------------------------------------------- texts -- */

test('the failure text names the correct answer, in both locales (P1-1)', () => {
  for (const [name, locale, expected] of [
    ['es', ES, /^Incorrecto\. La respuesta es \{answer\}\.$/],
    ['en', EN, /^Incorrect\. The answer is \{answer\}\.$/],
  ]) {
    assert.match(locale.incorrectAnswer, expected, `${name}: wrong failure text`);
  }
});

test('"Casi" / "Not quite" is gone, and the generic wrong text stays answer-free', () => {
  assert.equal(ES.incorrect, 'Incorrecto.');
  assert.equal(EN.incorrect, 'Incorrect.');
  assert.ok(!/casi/i.test(ES.incorrect), 'es still says "Casi"');
  assert.ok(!/not quite/i.test(EN.incorrect), 'en still says "Not quite"');
});

test('the result screen texts exist in both locales (P1-2)', () => {
  for (const [name, locale] of [['es', ES], ['en', EN]]) {
    for (const key of ['reviewMissed', 'repeatLesson', 'finish']) {
      assert.equal(typeof locale[key], 'string', `${name}: missing learn.lessons.${key}`);
      assert.ok(locale[key].length > 0, `${name}: empty learn.lessons.${key}`);
    }
  }
  assert.match(ES.reviewMissed, /Repasar lo que fall/i);
});

test('the vocabulary batch button exists in both locales (P2-2)', () => {
  for (const [name, locale] of [['es', ES], ['en', EN]]) {
    for (const key of ['addAllToReview', 'addedAll']) {
      assert.ok(locale[key]?.length > 0, `${name}: missing learn.lessons.${key}`);
    }
  }
});

/* ------------------------------------------------------- review the missed -- */

test('missedVocabulary maps a failed exercise to its lesson words', () => {
  const exercises = LESSON.exercises;
  const results = exercises.map(() => ({ correct: true }));

  assert.deepEqual(missedVocabulary(exercises, results, LESSON.vocabulary), [], 'nothing missed, nothing to review');

  // exercise 0 = "What does 谢谢 mean?" -> the word 谢谢 is in the vocabulary
  const failed = results.map((r, i) => (i === 0 ? { correct: false } : r));
  const cards = missedVocabulary(exercises, failed, LESSON.vocabulary);
  assert.ok(cards.length >= 1, 'a failed exercise yields at least one card');
  assert.ok(cards.some((card) => card.hanzi === '谢谢'), 'the word of the failed exercise is added');
  for (const card of cards) {
    assert.ok(card.hanzi, 'every card has hanzi');
    assert.equal(card.source, 'lesson');
  }
});

test('missedVocabulary only looks at the failed exercises', () => {
  const exercises = LESSON.exercises;
  const results = exercises.map((r, i) => ({ correct: i !== 4 })); // exercise 4 = order "你好"
  const cards = missedVocabulary(exercises, results, LESSON.vocabulary);
  assert.ok(cards.some((card) => card.hanzi === '你') || cards.some((card) => card.hanzi === '好'));
  assert.ok(!cards.some((card) => card.hanzi === '谢谢'), 'a passed exercise never lands in the review set');
});

test('the missed words really go into the review deck (srs addToReview)', async () => {
  const exercises = LESSON.exercises;
  const results = exercises.map(() => ({ correct: false }));
  const missed = missedVocabulary(exercises, results, LESSON.vocabulary);
  const deck = createDeck(createStorage(memoryDriver()));
  assert.equal(await deck.countDue(), 0);

  for (const word of missed) await deck.addToReview(word);
  assert.equal(await deck.countDue(), missed.length, 'every missed word is due in the deck');
  const stored = await deck.listCards();
  assert.ok(stored.some((card) => tonelessKey(card.pinyin) === tonelessKey('xièxie')));
});

test('expectedAnswer shows the correct answer, joining match pairs', () => {
  assert.equal(expectedAnswer(gradeExercise(LESSON.exercises[1], '一')), '二');
  const match = gradeExercise(exercises0Match(), { 你: 'wrong' });
  assert.match(expectedAnswer(match), /你 — you/);
  assert.match(expectedAnswer(match), /谢谢 — thank you/);
});

function exercises0Match() {
  return LESSON.exercises.find((exercise) => exercise.type === 'match');
}

/* ---------------------------------------------------------- source guards -- */

const LESSONS_SRC = readSrc('../src/learn/lessons.js');

test('the feedback and the result expose a role=status live region (P1-3)', () => {
  assert.match(LESSONS_SRC, /role:\s*'status'/, 'no role=status in lessons.js');
  assert.match(LESSONS_SRC, /'aria-live':\s*'polite'/, 'no aria-live=polite in lessons.js');
});

test('the result screen wires "review what I missed" to addToReview (P1-2)', () => {
  const resultStep = LESSONS_SRC.slice(LESSONS_SRC.indexOf('function resultStep'));
  assert.match(resultStep, /learn\.lessons\.reviewMissed/, 'the review button text is missing');
  assert.match(resultStep, /learn\.lessons\.repeatLesson/, 'the repeat button text is missing');
  assert.match(resultStep, /addToReview\(/, 'the review button does not add the misses to the deck');
  assert.match(resultStep, /missedVocabulary\(/, 'the review button does not compute the misses');
});

test('typing keeps the shared focus ring (P2-7)', () => {
  const typing = readSrc('../src/learn/typing.js');
  assert.ok(!/outline:\s*none/.test(typing), 'typing.js still removes the outline');
});
