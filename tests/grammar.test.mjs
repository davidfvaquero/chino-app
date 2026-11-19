/**
 * grammar.test.mjs — schema validation + pure logic of src/learn/grammar.js
 * Run with: node --test tests/grammar.test.mjs
 *
 * The data files are the real ones the screen loads, so this is also the
 * schema validation the task asks for: index.json (15 patterns), the two
 * written patterns and the 25 measure words.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  titleKey,
  LESSON_ID,
  PROGRESS_STORE,
  STUDIED_KEY,
  MEASURE_SEGMENT,
  isValidExample,
  isValidPattern,
  isValidMeasureWord,
  isValidIndexEntry,
  normalizePattern,
  loadIndex,
  loadPattern,
  loadMeasureWords,
  getStudied,
  markStudied,
} from '../src/learn/grammar.js';
import { createStorage, memoryDriver } from '../src/storage.js';

const DATA = new URL('../public/data/grammar/', import.meta.url);
const readJson = (file) => JSON.parse(readFileSync(new URL(file, DATA), 'utf8'));
/** Offline fetchJson so the loaders run against the real files in Node. */
const fetchJson = async (url) => JSON.parse(readFileSync(url, 'utf8'));
const withBase = { base: DATA, fetchJson };
const store = () => createStorage(memoryDriver());

/** The 15 pre-defined pattern ids (order matters: it is the list order). */
const EXPECTED_IDS = [
  'shi',
  'de-possession',
  'ma-questions',
  'bu-mei-negation',
  'le-completed',
  'zai-location',
  'you-have',
  'hen-adjective',
  'question-words',
  'xiang-yao',
  'he-ye-dou',
  'time-word-order',
  'ba-suggestions',
  'cong-dao-zai',
  'bi-comparison',
];

/* ------------------------------------------------------------ index.json -- */

test('index.json: 15 valid patterns with unique ids, in the expected order', () => {
  const raw = readJson('index.json');
  assert.ok(Array.isArray(raw.patterns), 'index.json has a patterns array');
  assert.equal(raw.patterns.length, 15);
  assert.deepEqual(
    raw.patterns.map((entry) => entry.id),
    EXPECTED_IDS,
  );
  assert.equal(new Set(raw.patterns.map((entry) => entry.id)).size, 15, 'ids are unique');
  for (const entry of raw.patterns) {
    assert.ok(isValidIndexEntry(entry), `invalid index entry: ${JSON.stringify(entry)}`);
    assert.ok(entry.title.trim() !== '' && entry.level.trim() !== '');
  }
});

test('index.json: all patterns with a file entry have a valid matching file', () => {
  const written = readJson('index.json').patterns.filter((entry) => entry.file);
  assert.ok(written.length >= 2, 'at least the two original patterns have files');
  for (const entry of written) {
    const pattern = readJson(entry.file); // throws if the file is missing
    assert.equal(pattern.id, entry.id, `${entry.file} must match its index id`);
  }
});

/* --------------------------------------------------------------- patterns -- */

test('all written pattern files: valid per schema, with notes and examples', () => {
  const index = readJson('index.json');
  const writtenFiles = index.patterns
    .filter((entry) => entry.file)
    .map((entry) => entry.file);
  for (const file of writtenFiles) {
    const pattern = normalizePattern(readJson(file));
    assert.ok(isValidPattern(pattern), `${file} is invalid`);
    assert.ok(pattern.examples.length >= 2, `${file} has at least 2 examples`);
    for (const example of pattern.examples) {
      assert.ok(isValidExample(example));
      // pinyin is space-separated syllables so pinyinHtml() can colour them
      assert.ok(example.pinyin.includes(' '), `${file}: "${example.pinyin}" is not syllable-spaced`);
    }
  }
});

/* ---------------------------------------------------------- measure words -- */

test('measure-words.json: 25 classifiers, unique, 2 examples each', () => {
  const raw = readJson('measure-words.json');
  assert.ok(Array.isArray(raw.measureWords));
  assert.equal(raw.measureWords.length, 25);
  assert.equal(new Set(raw.measureWords.map((word) => word.character)).size, 25, 'characters are unique');
  for (const word of raw.measureWords) {
    assert.ok(isValidMeasureWord(word), `invalid measure word: ${JSON.stringify(word)}`);
    assert.equal(word.examples.length, 2, `${word.character} must have exactly 2 examples`);
    assert.ok(word.usage.trim() !== '' && word.pinyin.trim() !== '');
  }
});

test('measure-words.json: includes the classifiers named in the task', () => {
  const chars = readJson('measure-words.json').measureWords.map((word) => word.character);
  for (const expected of ['个', '本', '杯', '张', '只', '条', '件', '位', '瓶', '家']) {
    assert.ok(chars.includes(expected), `missing ${expected}`);
  }
});

/* ------------------------------------------------------------- validators -- */

test('validators reject malformed data', () => {
  assert.equal(isValidExample({ hanzi: '我', pinyin: 'wǒ' }), false, 'english required');
  assert.equal(isValidExample(null), false);
  assert.equal(isValidMeasureWord({ character: '个', pinyin: 'gè', usage: 'x', examples: [] }), false);
  assert.equal(isValidMeasureWord({ character: '', pinyin: 'gè', usage: 'x', examples: [{ hanzi: '一', pinyin: 'yī', english: 'one' }] }), false);
  const base = { id: 'a', title: 'b', level: 'HSK1', explanation: 'c', structure: 'd', examples: [{ hanzi: '一', pinyin: 'yī', english: 'one' }] };
  assert.ok(isValidPattern(base));
  assert.equal(isValidPattern({ ...base, structure: '  ' }), false);
  assert.equal(isValidPattern({ ...base, examples: [] }), false);
  assert.equal(isValidPattern({ ...base, notes: 7 }), false);
  assert.ok(isValidPattern({ ...base, notes: 'ok' }));
  assert.equal(isValidIndexEntry({ id: 'a', title: 'b' }), false, 'level required');
  assert.ok(isValidIndexEntry({ id: 'a', title: 'b', level: 'HSK1' }));
  assert.ok(isValidIndexEntry({ id: 'a', title: 'b', level: 'HSK1', file: 'x.json' }));
});

test('normalizePattern trims and keeps the documented shape', () => {
  const pattern = normalizePattern({ id: ' shi ', title: ' 是 ', level: ' HSK1 ', explanation: ' x ', structure: ' y ', examples: [{ hanzi: ' 我 ', pinyin: ' wǒ ', english: ' I ' }] });
  assert.deepEqual(pattern, {
    id: 'shi',
    title: '是',
    level: 'HSK1',
    explanation: 'x',
    structure: 'y',
    examples: [{ hanzi: '我', pinyin: 'wǒ', english: 'I' }],
    notes: undefined,
  });
});

/* ----------------------------------------------------------------- loaders -- */

test('loadIndex / loadPattern / loadMeasureWords read the real files', async () => {
  const index = await loadIndex(withBase);
  assert.equal(index.length, 15);
  assert.equal(index[0].id, 'shi');

  const pattern = await loadPattern('shi', withBase);
  assert.equal(pattern.id, 'shi');
  assert.ok(pattern.examples.length >= 2);

  assert.equal(await loadPattern('non-existent-pattern', withBase), null, 'unknown pattern => null');

  const words = await loadMeasureWords(withBase);
  assert.equal(words.length, 25);
});

test('loaders reject a non-conforming payload', async () => {
  const badFetch = async () => ({ patterns: [{ id: 'x' }] });
  assert.deepEqual(await loadIndex({ fetchJson: badFetch }), []);
  assert.equal(await loadPattern('x', { fetchJson: async () => ({ id: 'x' }), index: [{ id: 'x', title: 'X', level: 'HSK1', file: 'x.json' }] }), null);
  assert.deepEqual(await loadMeasureWords({ fetchJson: async () => ({ measureWords: [{ character: '个' }] }) }), []);
});

/* ---------------------------------------------------------------- progress -- */

test('getStudied starts empty and markStudied is idempotent', async () => {
  const memory = store();
  assert.deepEqual(await getStudied({ store: memory }), []);
  await markStudied('shi', { store: memory, notify: false });
  await markStudied('shi', { store: memory, notify: false });
  await markStudied('de-possession', { store: memory, notify: false });
  assert.deepEqual(await getStudied({ store: memory }), ['shi', 'de-possession']);
  const record = await memory.get(PROGRESS_STORE, STUDIED_KEY);
  assert.deepEqual(record.ids, ['shi', 'de-possession']);
  assert.ok(typeof record.updatedAt === 'number');
});

test('markStudied fires chino:lesson_done with the pattern id and count', async () => {
  const memory = store();
  const events = [];
  globalThis.window = { dispatchEvent: (event) => events.push(event) };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  try {
    await markStudied('shi', { store: memory });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'chino:lesson_done');
    assert.deepEqual(events[0].detail, { lessonId: LESSON_ID, patternId: 'shi', studied: 1 });
    assert.equal(LESSON_ID, 'grammar');
  } finally {
    delete globalThis.window;
    delete globalThis.CustomEvent;
  }
});

/* ------------------------------------------------------------------- i18n -- */

test('every t() key used by the module exists in the grammar locale shard', () => {
  const source = readFileSync(new URL('../src/learn/grammar.js', import.meta.url), 'utf8');
  const shard = JSON.parse(readFileSync(new URL('../src/locales/en.d/grammar.json', import.meta.url), 'utf8')).grammar;
  const keys = [...source.matchAll(/t\('(grammar\.[A-Za-z0-9_.]+)'/g)].map((match) => match[1]);
  assert.ok(keys.length > 0, 'the module uses grammar.* keys');
  for (const key of new Set(keys)) {
    const leaf = key.slice('grammar.'.length);
    assert.ok(Object.hasOwn(shard, leaf), `missing locale key: ${key}`);
  }
});

test('the module wires pinyinHtml, audio, review and the lesson event', () => {
  const source = readFileSync(new URL('../src/learn/grammar.js', import.meta.url), 'utf8');
  assert.match(source, /pinyinHtml/);
  assert.match(source, /speak\(/);
  assert.match(source, /addToReview\(/);
  assert.match(source, /chino:lesson_done/);
  assert.equal(titleKey, 'grammar.title');
  assert.equal(MEASURE_SEGMENT, 'measure-words');
});
