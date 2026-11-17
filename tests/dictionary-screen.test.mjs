// Dictionary screen: contract, locale-shard coverage and the debounce/limit
// constants. The DOM flow itself (search, add, reload state) is checked in
// headless Chrome — see the task handoff.
// Run with `node --test tests/dictionary-screen.test.mjs` or `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { titleKey, render, DEBOUNCE_MS, RESULT_LIMIT } from '../src/screens/dictionary.js';

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));

const flatKeys = (obj, parents = []) =>
  Object.entries(obj ?? {}).flatMap(([key, value]) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? flatKeys(value, [...parents, key])
      : [[...parents, key].join('.')],
  );

const source = readFileSync(new URL('../src/screens/dictionary.js', import.meta.url), 'utf8');
const shard = readJson(new URL('../src/locales/en.d/dict.json', import.meta.url));
const shell = readJson(new URL('../src/locales/en.json', import.meta.url));

test('module keeps the screen contract', () => {
  assert.equal(titleKey, 'screens.dictionary.title');
  assert.equal(typeof render, 'function');
  assert.ok(DEBOUNCE_MS > 0, 'the search box is debounced');
  assert.ok(RESULT_LIMIT > 0, 'a search is limited');
});

test('every static text key used by the screen exists in the shard or the shell', () => {
  const staticKeys = [...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1]);
  assert.ok(staticKeys.length > 0, 'the screen reads its texts from i18n');
  const available = new Set(flatKeys(shard).concat(flatKeys(shell)));
  for (const key of staticKeys) {
    assert.ok(available.has(key), `missing locale key: ${key}`);
  }
  // the add button picks its label with a ternary, so check both by hand
  for (const key of ['dict.addToReview', 'dict.added']) {
    assert.ok(available.has(key), `missing locale key: ${key}`);
  }
});

test('the dict shard only owns dict.* keys and collides with nothing', () => {
  const own = flatKeys(shard);
  assert.ok(own.length > 0);
  for (const key of own) {
    assert.ok(key.startsWith('dict.'), `key outside the dict.* prefix: ${key}`);
  }
  const shellKeys = new Set(flatKeys(shell));
  for (const key of own) {
    assert.ok(!shellKeys.has(key), `duplicate locale key also in en.json: ${key}`);
  }
});

test('the shard has no empty strings (a key that resolves to nothing is a bug)', () => {
  const walk = (obj) => {
    for (const value of Object.values(obj ?? {})) {
      if (value !== null && typeof value === 'object') walk(value);
      else assert.ok(typeof value === 'string' && value.trim() !== '', 'empty text value');
    }
  };
  walk(shard);
});

test('the screen writes no literal UI text (all copy goes through t())', () => {
  // Text only reaches the DOM from t(...) or from data (hanzi, pinyin, defs).
  const literalText = [...source.matchAll(/\btext:\s*'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(literalText, [], `literal text found: ${literalText.join(', ')}`);
});
