// Design round 2, task C — review hints, dictionary display, reading-list
// pinyin, and the docs guard. Static, browser-free.
// Run with `node --test tests/design-ronda2c.test.mjs` or `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { REVIEW_MODES } from '../src/screens/review.js';
import { distinctDefs } from '../src/dictionary.js';

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// ------------------------------------------------------------- review hints

test('every review mode has a one-line hint in both languages', () => {
  const en = readJson(new URL('../src/locales/en.d/review-modes.json', import.meta.url));
  const es = readJson(new URL('../src/locales/es.d/review-modes.json', import.meta.url));
  for (const mode of REVIEW_MODES) {
    assert.ok(en.reviewMode.hint[mode]?.trim(), `en hint missing for ${mode}`);
    assert.ok(es.reviewMode.hint[mode]?.trim(), `es hint missing for ${mode}`);
  }
  assert.deepEqual(Object.keys(es.reviewMode.hint).sort(), Object.keys(en.reviewMode.hint).sort());
});

test('the review screen builds the hint key from the mode (no static literal)', () => {
  const source = src('src/screens/review.js');
  assert.match(source, /hintKey\s*=\s*\(mode\)/);
  assert.match(source, /class: 'hint'/);
});

// --------------------------------------------------------- dictionary display

test('distinctDefs collapses near-identical glosses and caps the count', () => {
  assert.deepEqual(distinctDefs(['to thank', 'thanks', 'thank you']), ['to thank']);
  assert.deepEqual(distinctDefs(['hello', 'hi']), ['hello', 'hi']);
  assert.deepEqual(distinctDefs(['one', 'two', 'three', 'four', 'five']), ['one', 'two', 'three']);
  assert.deepEqual(distinctDefs([]), []);
  assert.deepEqual(distinctDefs(undefined), []);
  assert.deepEqual(distinctDefs(['', '  ']), []);
});

test('the dictionary screen shows the "in English" label and trims defs', () => {
  const source = src('src/screens/dictionary.js');
  assert.match(source, /distinctDefs\(entry\.defs\)/);
  assert.match(source, /t\('dict\.defsEnglish'\)/);
});

test('the dictionary screen shows a Spanish gloss first when the data has one', () => {
  const source = src('src/screens/dictionary.js');
  assert.match(source, /class: 'dict-gloss'/);
  assert.match(source, /fetchData/);
});

test('the "in English" label exists in both dictionary shards', () => {
  const en = readJson(new URL('../src/locales/en.d/dict.json', import.meta.url));
  const es = readJson(new URL('../src/locales/es.d/dict.json', import.meta.url));
  assert.equal(en.dict.defsEnglish, 'Definitions in English');
  assert.equal(es.dict.defsEnglish, 'Definiciones en inglés');
});

// ----------------------------------------------------- reading-list pinyin

test('the reading index carries a pinyin for every title', () => {
  const en = readJson(new URL('../public/data/readings/hsk1/index.json', import.meta.url));
  const es = readJson(new URL('../public/data/es/readings/hsk1/index.json', import.meta.url));
  assert.equal(en.length, 40);
  assert.equal(es.length, 40);
  for (const r of en) assert.ok(r.pinyin?.trim(), `missing pinyin for ${r.id}`);
  // es mirrors en, same ids and same (non-translatable) pinyin
  assert.deepEqual(es.map((r) => r.id), en.map((r) => r.id));
  assert.deepEqual(es.map((r) => r.pinyin), en.map((r) => r.pinyin));
});

test('the reading list renders the title pinyin', () => {
  const source = src('src/screens/read.js');
  assert.match(source, /reading\.pinyin/);
});

// --------------------------------------------------------------- no gradients

test('the memory game CSS keeps no no-op gradient', () => {
  assert.ok(!src('src/learn/games/memory.js').includes('linear-gradient'), 'gradient left in memory.js');
});

// -------------------------------------------------------------------- docs

test('DESIGN.md documents the round-2 reality', () => {
  const doc = src('docs/DESIGN.md');
  assert.match(doc, /\|\s*`--focus`\s*\|/, '--focus missing from the token table');
  assert.match(doc, /labels are 11 px/, 'tab-label size not updated');
  assert.match(doc, /hairline row per reading/, 'reading list not described as a hairline row');
  assert.match(doc, /without the shake or pop/, 'reduced-motion note not updated');
});
