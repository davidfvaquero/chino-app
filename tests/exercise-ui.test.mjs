// Exercise UI: match selection state + shared mobile CSS.
// Run with `node --test tests/exercise-ui.test.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createMatchState,
  toggleMatchLeft,
  chooseMatchRight,
  unmatchPair,
  isMatchComplete,
  matchPairIndex,
  gradeExercise,
} from '../src/learn/exercises.js';
import { EXERCISE_UI_CSS } from '../src/learn/exercise-ui.css.js';

const PAIRS = [
  { hanzi: '你', english: 'you' },
  { hanzi: '谢谢', english: 'thank you' },
  { hanzi: '再见', english: 'goodbye' },
  { hanzi: '一', english: 'one' },
];

test('match state starts empty and incomplete', () => {
  const state = createMatchState(PAIRS);
  assert.deepEqual(state.chosen, {});
  assert.equal(state.selected, null);
  assert.equal(isMatchComplete(state), false);
  assert.equal(matchPairIndex(state, '谢谢'), 1);
});

test('tap a word selects it; tap it again deselects it', () => {
  let state = createMatchState(PAIRS);
  state = toggleMatchLeft(state, '你');
  assert.equal(state.selected, '你');
  state = toggleMatchLeft(state, '你');
  assert.equal(state.selected, null, 'second tap must clear the selection');
});

test('tapping a meaning without a selected word does nothing', () => {
  const state = createMatchState(PAIRS);
  const next = chooseMatchRight(state, 'you');
  assert.deepEqual(next.chosen, {});
  assert.equal(next.selected, null);
});

test('tap word -> tap meaning pairs them and clears the selection', () => {
  let state = createMatchState(PAIRS);
  state = toggleMatchLeft(state, '你');
  state = chooseMatchRight(state, 'you');
  assert.deepEqual(state.chosen, { 你: 'you' });
  assert.equal(state.selected, null);
});

test('a matched pair can be unselected by tapping it again', () => {
  let state = createMatchState(PAIRS);
  state = toggleMatchLeft(state, '你');
  state = chooseMatchRight(state, 'you');
  state = unmatchPair(state, '你');
  assert.deepEqual(state.chosen, {});
  assert.equal(isMatchComplete(state), false);
});

test('complete only after all four pairs are chosen', () => {
  let state = createMatchState(PAIRS);
  for (const pair of PAIRS) {
    state = toggleMatchLeft(state, pair.hanzi);
    state = chooseMatchRight(state, pair.english);
  }
  assert.equal(isMatchComplete(state), true);
  const result = gradeExercise({ type: 'match', pairs: PAIRS }, state.chosen);
  assert.equal(result.correct, true);
  assert.equal(result.score, 1);
});

test('exercise kit styles the match grid and its states; design system keeps 48px touch targets and no 300ms tap delay', () => {
  const shell = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(shell, /\.btn\s*\{[^}]*min-height:\s*48px/s);
  assert.match(shell, /\.chip\s*\{[^}]*min-height:\s*48px/s);
  assert.match(shell, /touch-action:\s*manipulation/);
  assert.match(EXERCISE_UI_CSS, /\.match-grid\s*\{[^}]*grid-template-columns/s);
  assert.match(EXERCISE_UI_CSS, /\.match-chip\.selected/);
  assert.match(EXERCISE_UI_CSS, /\.match-chip\.matched/);
});
