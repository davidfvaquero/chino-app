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

/* ------------------------------------------------------- match selection -- */

/**
 * UI-only selection state for a `match` exercise. Grading stays in
 * `gradeExercise`; these helpers just model "tap a word, then its meaning" so
 * the interaction can be unit-tested without a DOM.
 *
 *   { pairs: [{hanzi, english}], chosen: { [hanzi]: english }, selected: hanzi|null }
 */
export function createMatchState(pairs = []) {
  return {
    pairs: (Array.isArray(pairs) ? pairs : []).map((pair) => ({
      hanzi: text(pair?.hanzi),
      english: text(pair?.english),
    })),
    chosen: {},
    selected: null,
  };
}

/** Tap a left-column word: select it, or clear it when it was already selected. */
export function toggleMatchLeft(state, hanzi) {
  const value = text(hanzi);
  if (!state?.pairs?.some((pair) => pair.hanzi === value)) return state;
  return { ...state, selected: state.selected === value ? null : value };
}

/** Tap a right-column meaning: pair it with the selected word (no-op without one). */
export function chooseMatchRight(state, english) {
  if (!state?.selected) return state;
  return {
    ...state,
    chosen: { ...state.chosen, [state.selected]: text(english) },
    selected: null,
  };
}

/** Tap a matched word/meaning again: remove its pair. */
export function unmatchPair(state, hanzi) {
  const value = text(hanzi);
  if (!state?.chosen || !Object.prototype.hasOwnProperty.call(state.chosen, value)) return state;
  const chosen = { ...state.chosen };
  delete chosen[value];
  return { ...state, chosen, selected: state.selected === value ? null : state.selected };
}

/** True when every declared word has a chosen meaning. */
export function isMatchComplete(state) {
  const pairs = state?.pairs ?? [];
  if (!pairs.length) return false;
  const chosen = state?.chosen ?? {};
  return pairs.every((pair) => Object.prototype.hasOwnProperty.call(chosen, pair.hanzi));
}

/** 1-based position of a word in the declared pairs (for pair colours). */
export function matchPairIndex(state, hanzi) {
  const value = text(hanzi);
  return (state?.pairs ?? []).findIndex((pair) => pair.hanzi === value);
}

/** Aggregates `gradeExercise` results into a lesson score. */
export function summarize(results = []) {
  const list = Array.isArray(results) ? results : [];
  const total = list.length;
  const correct = list.filter((result) => result?.correct).length;
  const score = total ? list.reduce((sum, result) => sum + (result?.score ?? 0), 0) / total : 0;
  return { correct, total, score };
}

/* --------------------------------------------------- review the error loop -- */

const HAN_RUN = /\p{Script=Han}+/gu;

/** Every free-text field of an exercise that may hold hanzi (prompt, answer, options, tokens, pairs, audio). */
export function exerciseTexts(exercise = {}) {
  const out = [];
  for (const value of [exercise?.prompt, exercise?.answer, exercise?.audio]) {
    if (typeof value === 'string') out.push(value);
  }
  for (const option of exercise?.options ?? []) out.push(text(option));
  for (const token of exercise?.tokens ?? []) out.push(text(token));
  for (const pair of exercise?.pairs ?? []) out.push(text(pair?.hanzi));
  return out;
}

/**
 * Deck cards for the exercises the learner got wrong: the vocabulary words
 * that appear in a failed exercise, deduped, in lesson order. Pure, so the
 * "review what I missed" flow is unit-testable (the UI hands the result to
 * `addToReview` from src/srs.js). A hanzi run is used whole when the lesson
 * vocabulary has it, else per character.
 */
export function missedVocabulary(exercises = [], results = [], vocabulary = []) {
  const byWord = new Map();
  for (const word of vocabulary ?? []) {
    if (word?.hanzi) byWord.set(text(word.hanzi), word);
  }
  const seen = new Set();
  const out = [];
  (Array.isArray(exercises) ? exercises : []).forEach((exercise, index) => {
    if (results?.[index]?.correct) return;
    for (const value of exerciseTexts(exercise)) {
      for (const run of String(value).match(HAN_RUN) ?? []) {
        const characters = [...run];
        const candidates = byWord.has(run) ? [run] : characters.filter((char) => byWord.has(char));
        for (const hanzi of candidates) {
          if (seen.has(hanzi)) continue;
          seen.add(hanzi);
          const word = byWord.get(hanzi);
          out.push({ hanzi: word.hanzi, pinyin: word.pinyin ?? '', english: word.english ?? '', source: 'lesson' });
        }
      }
    }
  });
  return out;
}

/** The correct answer of a `gradeExercise` result as display text (pairs joined for `match`). */
export function expectedAnswer(result) {
  const expected = result?.expected;
  if (Array.isArray(expected)) return expected.map((pair) => `${pair.left} — ${pair.right}`).join(', ');
  return text(expected);
}
