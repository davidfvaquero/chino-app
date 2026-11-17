// Pronunciation practice screen (browser-free parts): locale-shard coverage
// and pure helper checks. The DOM flow itself is checked in headless Chrome.
// Run with `node --test tests/pronounce.test.mjs` or `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { titleKey, render } from '../src/extras/pronounce.js';

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));

const flatKeys = (obj, parents = []) =>
  Object.entries(obj ?? {}).flatMap(([key, value]) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? flatKeys(value, [...parents, key])
      : [[...parents, key].join('.')],
  );

const shard = readJson(new URL('../src/locales/en.d/pronounce.json', import.meta.url));
const shell = readJson(new URL('../src/locales/en.json', import.meta.url));

test('module keeps the screen contract', () => {
  assert.equal(titleKey, 'hubs.extras.pronounce');
  assert.equal(typeof render, 'function');
});

test('every static text key used by the screen exists in the shard or shell', () => {
  const source = readFileSync(new URL('../src/extras/pronounce.js', import.meta.url), 'utf8');
  const staticKeys = [...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1])
    .filter(k => !/[<>*]/ .test(k)); // filter out placeholder patterns in comments
  assert.ok(staticKeys.length > 0, 'the screen reads its texts from i18n');
  const available = new Set(flatKeys(shard).concat(flatKeys(shell)));
  for (const key of staticKeys) {
    assert.ok(available.has(key), `missing locale key: ${key}`);
  }
});

test('the pronounce shard only owns pronounce.* keys and collides with nothing', () => {
  const own = flatKeys(shard);
  assert.ok(own.length > 0);
  for (const key of own) {
    assert.ok(key.startsWith('pronounce.'), `key outside the pronounce.* prefix: ${key}`);
  }
  const shellKeys = new Set(flatKeys(shell));
  for (const key of own) {
    assert.ok(!shellKeys.has(key), `duplicate locale key also in en.json: ${key}`);
  }
});

// The speech.js compare/hanziOnly logic is tested in tests/speech.test.mjs
// The audio.js speak logic is tested in tests/audio.test.mjs
// The degraded-mode DOM flow (no support / denied / no-speech / error) is
// verified in headless Chrome per the acceptance criteria.