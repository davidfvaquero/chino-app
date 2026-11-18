import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  loadIndex,
  loadTheme,
  validateIndex,
  validateTheme,
  themeCards,
  addThemeToReview,
  markStudied,
  getStudied,
  studiedKey,
} from '../src/learn/themes.js';
import { createStorage, memoryDriver } from '../src/storage.js';

const readJson = async (url) => JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
/** Source-of-truth data on disk (the module's DATA_BASE is the runtime URL). */
const BASE = new URL('../public/data/themes/', import.meta.url);
const opts = { base: BASE, fetchJson: readJson };
const readRaw = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../public/data/themes/${name}`, import.meta.url)), 'utf8'));

const IDS = [
  'theme-01', 'theme-02', 'theme-03', 'theme-04', 'theme-05', 'theme-06',
  'theme-07', 'theme-08', 'theme-09', 'theme-10', 'theme-11', 'theme-12',
];

/* ------------------------------------------------------------------ data -- */

test('index: 12 predefined themes, ids and order fixed', async () => {
  const index = await loadIndex(opts);
  assert.equal(index.length, 12);
  assert.deepEqual(index.map((item) => item.id), IDS);
  for (const item of index) assert.ok(item.title, `${item.id} has a title`);
  assert.deepEqual(validateIndex(index), []);
});

test('index: travel themes are flagged', async () => {
  const index = await loadIndex(opts);
  const travel = index.filter((item) => item.travel).map((item) => item.id);
  for (const id of ['theme-04', 'theme-06', 'theme-07', 'theme-08']) assert.ok(travel.includes(id), `${id} travel`);
});

test('theme-01 and theme-02 load and validate', async () => {
  for (const id of ['theme-01', 'theme-02']) {
    const theme = await loadTheme(id, opts);
    assert.equal(theme.id, id);
    assert.equal(validateTheme(theme).length, 0);
    assert.ok(theme.words.length >= 10, `${id} has a real word list`);
    assert.ok(theme.phrases.length >= 5, `${id} has phrases`);
    assert.ok(theme.title);
  }
});

test('data files: simplified hanzi, spaced tone-marked pinyin, english', () => {
  for (const name of ['theme-01.json', 'theme-02.json', 'index.json']) readRaw(name); // parses
  for (const name of ['theme-01.json', 'theme-02.json']) {
    const theme = readRaw(name);
    assert.equal(name, `${theme.id}.json`);
    for (const kind of ['words', 'phrases']) {
      for (const entry of theme[kind]) {
        assert.match(entry.hanzi, /^[\u4e00-\u9fff\uff0c\u3002\uff01\uff1f\u3001 ]+$/, `hanzi only: ${entry.hanzi}`);
        assert.match(entry.pinyin, /^[a-zA-Züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ ,']+$/, `pinyin ${entry.pinyin}`);
        assert.doesNotMatch(entry.pinyin, /\d/, `no tone numbers: ${entry.pinyin}`);
        assert.ok(entry.english.length > 0);
      }
    }
  }
});

test('validateTheme reports each missing field', () => {
  const problems = validateTheme({ id: 'x', words: [{ hanzi: '你' }, { pinyin: 'nǐ', english: 'you' }], phrases: 'nope' });
  assert.ok(problems.includes('theme.title or theme.titleKey missing'));
  assert.ok(problems.includes('phrases is not an array'));
  assert.ok(problems.includes('words[0].pinyin missing'));
  assert.ok(problems.includes('words[0].english missing'));
  assert.ok(problems.includes('words[1].hanzi missing'));
});

test('validateIndex rejects duplicates and missing ids/titles', () => {
  const problems = validateIndex([{ id: 'a', title: 'A' }, { id: 'a' }, {}]);
  assert.ok(problems.some((p) => p.includes('duplicate id a')));
  assert.ok(problems.some((p) => p.includes('index[2].id missing')));
  assert.ok(problems.some((p) => p.includes('index[1].title missing')));
});

/* ------------------------------------------------------------- review -- */

test('themeCards: words + phrases, id keyed by hanzi, deduped', () => {
  const theme = {
    id: 'theme-x',
    words: [
      { hanzi: '你', pinyin: 'nǐ', english: 'you' },
      { hanzi: '你', pinyin: 'nǐ', english: 'you' },
    ],
    phrases: [{ hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' }],
  };
  const cards = themeCards(theme);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((c) => c.id), ['theme:你', 'theme:你好']);
  assert.equal(cards[0].source, 'theme');
  assert.equal(cards[0].themeId, 'theme-x');
  assert.equal(cards[1].kind, 'phrases');
});

test('addThemeToReview adds every card once (idempotent via srs)', async () => {
  const theme = await loadTheme('theme-01', opts);
  const expected = theme.words.length + theme.phrases.length;
  const store = createStorage(memoryDriver());
  const seen = new Map();
  const add = async (card) => {
    if (seen.has(card.id)) return { card: seen.get(card.id), created: false };
    seen.set(card.id, card);
    return { card, created: true };
  };
  const first = await addThemeToReview(theme, { add });
  assert.deepEqual(first, { added: expected, total: expected });
  const second = await addThemeToReview(theme, { add });
  assert.deepEqual(second, { added: 0, total: expected });
  assert.equal((await store.list('srs')).length, 0); // stub add does not touch storage
});

test('markStudied stores progress under progress[theme:<id>]', async () => {
  const store = createStorage(memoryDriver());
  const theme = await loadTheme('theme-02', opts);
  const record = await markStudied(theme, { store, now: 1000 });
  assert.equal(record.themeId, 'theme-02');
  assert.equal(record.words, theme.words.length);
  assert.equal(record.phrases, theme.phrases.length);
  assert.equal(studiedKey('theme-02'), 'theme:theme-02');
  assert.deepEqual(await store.get('progress', 'theme:theme-02'), record);
  assert.deepEqual(await getStudied('theme-02', { store }), record);
  assert.equal(await getStudied('theme-03', { store }), null);
});

test('missing theme file rejects with a schema/load error', async () => {
  await assert.rejects(() => loadTheme('theme-99', opts));
});
