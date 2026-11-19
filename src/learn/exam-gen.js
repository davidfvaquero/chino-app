/**
 * exam-gen.js — pure logic for the HSK practice exam (no DOM, no storage, no audio).
 *
 * The exam screen (src/learn/exam.js) owns the UI; everything that can be
 * unit-tested lives here (see tests/exam.test.mjs).
 *
 * A seeded rng makes an exam reproducible: the same seed, level and input data
 * always build the same 20 questions (acceptance: "same seed = same exam").
 *
 * Question shapes (documented contract):
 *   { id, type: 'meaning', section: 'meaning', word,
 *     prompt, promptPinyin, options: [english], answer }
 *   { id, type: 'listen', section: 'listen', mode: 'hanzi' | 'pinyin', word,
 *     audio, prompt, options: [string], answer }
 *   { id, type: 'reading', section: 'reading', kind: 'meaning' | 'missing',
 *     sentence, tokens?: [(string|null)], prompt, promptPinyin,
 *     options: [string], answer }
 *   { id, type: 'order', section: 'order', sentence, tokens: [string],
 *     options: [string] (the shuffled tokens), prompt, answer: string }
 *
 * Every multiple-choice question carries the right answer exactly once and a
 * set of distinct decoys (`uniqueOptions` guarantees it).
 *
 * Public API:
 *   LEVELS, EXAM_SIZE, CHOICE_COUNT, SECTION_SHARE, BLANK, TIMER_SECONDS
 *   mulberry32(seed) / makeRng(seed) / hashSeed(value) / shuffle(list, rng)
 *   normalizeWord(entry) / isWord(word)
 *   segmentSentence(hanzi, vocab) -> [string]
 *   uniqueOptions(answer, decoys, { size }) -> [string]
 *   buildExam({ level, seed, words, sentences, size, rng }) -> exam
 *   gradeAnswer(question, response) -> boolean
 *   gradeExam(exam, answers) -> { correct, total, score, percent, wrong }
 */
import { tonelessKey } from '../pinyin.js';

/** HSK levels the screen may offer (level 3+ only when the data file exists). */
export const LEVELS = [1, 2, 3];
/** Questions per exam. */
export const EXAM_SIZE = 20;
/** Options per multiple-choice question. */
export const CHOICE_COUNT = 4;
/** Optional exam timer (seconds). */
export const TIMER_SECONDS = 600;
/** Marker shown instead of the missing word in a `reading`/`missing` prompt. */
export const BLANK = '____';
/** Fraction of the exam per section; the last section takes the remainder. */
export const SECTION_SHARE = { meaning: 0.3, listen: 0.2, reading: 0.25 };

/* --------------------------------------------------------------- seeded rng -- */

/** Deterministic 32-bit PRNG; a seed string or number is hashed first. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 'abc' / 42 / null -> a 32-bit integer seed (FNV-1a for strings). */
export function hashSeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(Math.abs(value)) >>> 0;
  const text = String(value ?? '');
  if (/^\d+$/.test(text)) return Number(text) >>> 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Rng for a seed. Same seed + same data -> identical exam. */
export function makeRng(seed) {
  return mulberry32(hashSeed(seed));
}

/** Fisher-Yates copy of `list` (injectable rng keeps exams reproducible). */
export function shuffle(list, rng = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ------------------------------------------------------------------- words -- */

const text = (value) => (value === undefined || value === null ? '' : String(value));

function englishText(english) {
  if (Array.isArray(english)) return english.filter(Boolean).join('; ');
  return text(english).trim();
}

/**
 * Normalizes an HSK entry into the word shape the exam uses. The traditional
 * form is dropped on purpose: this app is simplified only.
 */
export function normalizeWord(entry = {}) {
  const hanzi = text(entry.hanzi ?? entry.simp).trim();
  const pinyin = text(entry.pinyin).trim();
  return {
    id: text(entry.id || `${hanzi}|${pinyin}`),
    hanzi,
    pinyin,
    pinyinNumeric: text(entry.pinyinNumeric).trim(),
    english: englishText(entry.english ?? entry.defs ?? entry.meaning),
  };
}

/** A word is usable when it has a hanzi, a reading and a meaning. */
export function isWord(word) {
  return Boolean(word?.hanzi && (word.pinyin || word.pinyinNumeric) && word.english);
}

/* -------------------------------------------------------------- sentences -- */

/** True for a reading/lesson sentence usable in the reading + order sections. */
export function isSentence(sentence) {
  return Boolean(sentence?.hanzi && sentence.english);
}

/**
 * Greedy longest-match segmentation of a Chinese sentence against a known
 * vocabulary set. Unknown stretches fall back to single characters, so
 * `segmentSentence(x, v).join('') === x` always holds. Deterministic.
 */
export function segmentSentence(hanzi, vocab = new Set()) {
  const source = text(hanzi);
  let maxLen = 1;
  for (const word of vocab) maxLen = Math.max(maxLen, word.length);
  maxLen = Math.min(maxLen, 6);
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    let size = Math.min(maxLen, source.length - index);
    while (size > 1 && !vocab.has(source.slice(index, index + size))) size -= 1;
    tokens.push(source.slice(index, index + size));
    index += size;
  }
  return tokens;
}

/* ---------------------------------------------------------------- options -- */

/**
 * The options shown for one question: `answer` plus up to `size - 1` distinct
 * decoys (`decoys` must be distinct from the answer and from each other),
 * shuffled. Returns fewer options when the pool is too small — never a
 * duplicated value.
 */
export function uniqueOptions(answer, decoys = [], { size = CHOICE_COUNT, rng = Math.random } = {}) {
  const want = text(answer);
  const seen = new Set([want]);
  const extras = [];
  for (const candidate of shuffle(decoys, rng)) {
    const value = text(candidate);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    extras.push(value);
    if (extras.length >= size - 1) break;
  }
  return shuffle([want, ...extras], rng);
}

/** Distinct values drawn from a pool of entries via `valueOf`. */
function decoyValues(pool, valueOf, rng) {
  const values = [];
  const seen = new Set();
  for (const entry of shuffle(pool, rng)) {
    const value = text(valueOf(entry));
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

/* ------------------------------------------------------------- the exam -- */

/** Questions per section for a given exam size (the order section takes the rest). */
export function sectionPlan(size = EXAM_SIZE) {
  const meaning = Math.floor(size * SECTION_SHARE.meaning);
  const listen = Math.floor(size * SECTION_SHARE.listen);
  const reading = Math.floor(size * SECTION_SHARE.reading);
  const order = Math.max(0, size - meaning - listen - reading);
  return { meaning, listen, reading, order };
}

const SECTION_LABEL = { meaning: 'meaning', listen: 'listen', reading: 'reading', order: 'order' };

function meaningQuestion(index, word, wordPool, rng) {
  const decoys = decoyValues(wordPool, (entry) => entry.english, rng);
  return {
    id: `meaning-${index}`,
    type: 'meaning',
    section: SECTION_LABEL.meaning,
    word,
    prompt: word.hanzi,
    promptPinyin: word.pinyin,
    options: uniqueOptions(word.english, decoys, { rng }),
    answer: word.english,
  };
}

function listenQuestion(index, word, wordPool, rng) {
  const mode = index % 2 === 0 ? 'hanzi' : 'pinyin';
  const valueOf = mode === 'hanzi' ? (entry) => entry.hanzi : (entry) => entry.pinyin;
  const answer = text(valueOf(word));
  return {
    id: `listen-${index}`,
    type: 'listen',
    section: SECTION_LABEL.listen,
    mode,
    word,
    audio: word.hanzi,
    prompt: word.hanzi,
    options: uniqueOptions(answer, decoyValues(wordPool, valueOf, rng), { rng }),
    answer,
  };
}

function readingQuestion(index, sentence, sentencePool, lexicon, rng) {
  const kind = index % 2 === 0 ? 'meaning' : 'missing';
  if (kind === 'meaning') {
    const decoys = decoyValues(sentencePool, (entry) => entry.english, rng);
    return {
      id: `reading-${index}`,
      type: 'reading',
      section: SECTION_LABEL.reading,
      kind,
      sentence,
      prompt: sentence.hanzi,
      promptPinyin: sentence.pinyin ?? '',
      options: uniqueOptions(sentence.english, decoys, { rng }),
      answer: sentence.english,
    };
  }
  // missing word: blank out one token of the segmented sentence
  const tokens = segmentSentence(sentence.hanzi, lexicon);
  const at = Math.min(tokens.length - 1, Math.floor(rng() * tokens.length));
  const missing = tokens[at];
  const shown = tokens.map((token, i) => (i === at ? BLANK : token));
  const decoys = [].concat(...sentencePool.map((entry) => segmentSentence(entry.hanzi, lexicon)));
  return {
    id: `reading-${index}`,
    type: 'reading',
    section: SECTION_LABEL.reading,
    kind,
    sentence,
    tokens: tokens.map((token, i) => (i === at ? null : token)),
    prompt: shown.join(''),
    promptPinyin: '',
    options: uniqueOptions(missing, decoys, { rng }),
    answer: missing,
  };
}

function orderQuestion(index, sentence, lexicon, rng) {
  const tokens = segmentSentence(sentence.hanzi, lexicon);
  return {
    id: `order-${index}`,
    type: 'order',
    section: SECTION_LABEL.order,
    sentence,
    tokens: [...tokens],
    options: shuffle(tokens, rng),
    prompt: sentence.english,
    answer: tokens.join(''),
  };
}

function take(pool, count, rng) {
  return shuffle(pool, rng).slice(0, Math.max(0, Math.min(count, pool.length)));
}

/**
 * Builds a full exam from the given pools. Pure: the same `seed` and the same
 * `words` / `sentences` always produce an identical exam.
 *
 * `sentences` are `{ hanzi, pinyin?, english }`; `words` are normalizeWord()
 * shaped. Questions with not enough material are simply dropped, so a tiny
 * pool yields a shorter exam.
 */
export function buildExam({ level = 1, seed = 1, words = [], sentences = [], size = EXAM_SIZE, rng } = {}) {
  const random = rng || makeRng(seed);
  const wordPool = words.map((word) => (word?.english !== undefined ? word : normalizeWord(word))).filter(isWord);
  const sentencePool = sentences.filter(isSentence);
  const lexicon = new Set(wordPool.map((word) => word.hanzi));
  const plan = sectionPlan(size);
  const questions = [];

  for (const word of take(wordPool, plan.meaning, random)) {
    questions.push(meaningQuestion(questions.length, word, wordPool, random));
  }
  for (const word of take(wordPool, plan.listen, random)) {
    questions.push(listenQuestion(questions.length, word, wordPool, random));
  }
  for (const sentence of take(sentencePool, plan.reading, random)) {
    questions.push(readingQuestion(questions.length, sentence, sentencePool, lexicon, random));
  }
  for (const sentence of take(sentencePool, plan.order, random)) {
    questions.push(orderQuestion(questions.length, sentence, lexicon, random));
  }

  return { level, seed, size: questions.length, questions };
}

/* ---------------------------------------------------------------- grading -- */

const joinTokens = (value) => (Array.isArray(value) ? value.map(text).join('') : text(value));

/** True when `response` earns the point for `question`. Pure, all-or-nothing. */
export function gradeAnswer(question, response) {
  if (response === undefined || response === null || response === '') return false;
  if (question?.type === 'order') {
    const given = joinTokens(response);
    return given !== '' && given === question.answer;
  }
  if (Array.isArray(response)) return joinTokens(response) === question?.answer;
  return text(response) === text(question?.answer);
}

/**
 * Grades a whole exam. `answers` is indexed by question position (a missing
 * entry counts as wrong). Returns score in percent and the list of misses with
 * the expected answer.
 */
export function gradeExam(exam, answers = []) {
  const questions = exam?.questions ?? [];
  const wrong = [];
  let correct = 0;
  questions.forEach((question, index) => {
    const response = Array.isArray(answers) ? answers[index] : answers?.[question.id];
    if (gradeAnswer(question, response)) {
      correct += 1;
    } else {
      wrong.push({ question, response, expected: question.answer });
    }
  });
  const total = questions.length;
  const percent = total ? Math.round((correct / total) * 100) : 0;
  return { correct, total, score: correct, percent, wrong };
}

/** Pinyin key of a word, used to dedupe review cards. */
export function wordKey(word) {
  return tonelessKey(word?.pinyinNumeric || word?.pinyin || '') || text(word?.hanzi);
}
