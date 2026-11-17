/**
 * exercises.js — pure grading for the four lesson exercise types.
 *
 * No DOM, no storage, no audio: this module only answers "was this response
 * right?" so it can be unit-tested in Node (see tests/exercises.test.mjs) and
 * reused by the lesson screen (src/learn/lessons.js), which owns the UI and
 * plays audio for `listen` exercises via src/audio.js.
 *
 * Exercise shapes are documented in docs/lesson-schema.md. In short:
 *
 *   { type: 'choose', prompt, options: [string], answer: string }
 *   { type: 'listen', audio: string, pinyin?, prompt, options: [string], answer: string }
 *   { type: 'match',  prompt, pairs: [{ hanzi, english }] }
 *   { type: 'order',  prompt, tokens: [string], answer: string | [string] }
 *
 * `gradeExercise(exercise, response)` is pure and returns
 *   { correct, score, expected, given, type }
 * where `score` is 0..1 (partial credit for `match`, all-or-nothing otherwise).
 * An unknown type throws (same style as src/srs.js rejecting a bad rating).
 */

export const EXERCISE_TYPES = ['choose', 'match', 'order', 'listen'];

/** True for a supported exercise type. */
export function isExerciseType(type) {
  return EXERCISE_TYPES.includes(type);
}

const text = (value) => (value === undefined || value === null ? '' : String(value));

/** Joins a token list (or a plain string) into the answer string. */
const joinTokens = (value) => (Array.isArray(value) ? value.map(text).join('') : text(value));

/**
 * Response -> `{ left: right }` map, accepting either an object or a list of
 * `[left, right]` / `{ left, right }` pairs. Used by `match`.
 */
function toPairsMap(response) {
  const out = {};
  if (!response) return out;
  if (Array.isArray(response)) {
    for (const pair of response) {
      if (Array.isArray(pair)) out[text(pair[0])] = text(pair[1]);
      else if (pair && typeof pair === 'object') out[text(pair.left)] = text(pair.right);
    }
    return out;
  }
  if (typeof response === 'object') {
    for (const [left, right] of Object.entries(response)) out[text(left)] = text(right);
  }
  return out;
}

/** Grades one response against one exercise. Pure. */
export function gradeExercise(exercise, response) {
  const type = exercise?.type;
  if (!isExerciseType(type)) {
    throw new TypeError(`exercises: unknown type "${type}" (expected ${EXERCISE_TYPES.join('/')})`);
  }

  if (type === 'choose' || type === 'listen') {
    const expected = text(exercise.answer);
    const given = text(response);
    const correct = given !== '' && given === expected;
    return { type, correct, score: correct ? 1 : 0, expected, given };
  }

  if (type === 'order') {
    const expected = joinTokens(exercise.answer);
    const given = joinTokens(response);
    const correct = given !== '' && given === expected;
    return { type, correct, score: correct ? 1 : 0, expected, given };
  }

  // match: partial credit over the declared pairs.
  const pairs = Array.isArray(exercise.pairs) ? exercise.pairs : [];
  const expected = pairs.map((pair) => ({ left: text(pair.hanzi), right: text(pair.english) }));
  const given = toPairsMap(response);
  const matched = expected.filter((pair) => given[pair.left] === pair.right).length;
  const score = expected.length ? matched / expected.length : 0;
  return { type, correct: expected.length > 0 && matched === expected.length, score, expected, given, matched };
}

/** Aggregates `gradeExercise` results into a lesson score. */
export function summarize(results = []) {
  const list = Array.isArray(results) ? results : [];
  const total = list.length;
  const correct = list.filter((result) => result?.correct).length;
  const score = total ? list.reduce((sum, result) => sum + (result?.score ?? 0), 0) / total : 0;
  return { correct, total, score };
}
