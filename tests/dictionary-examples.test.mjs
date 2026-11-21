// Dictionary example sentences — pure logic, no DOM:
//   - highlightWord: splits zh around the word and marks the hit (bold+underline)
//   - exampleTranslation: es when present, else en (locale aware)
//   - exampleShardOf / examplesFor: the builder hash, lazy shard load and the
//     network-failure path the screen turns into "Sin ejemplos".
// Run with `node --test tests/dictionary-examples.test.mjs` or `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  configure,
  examplesFor,
  highlightWord,
  exampleTranslation,
  exampleShardOf,
} from '../src/dictionary.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EX = path.join(ROOT, 'public', 'data', 'examples');

/** A fetch that serves the committed example shards from disk. */
function fileFetch(url) {
  const m = String(url).match(/shards\/(\d{3})\.json$/);
  const file = m && path.join(EX, 'shards', `${m[1]}.json`);
  if (!file || !fs.existsSync(file)) return Promise.resolve({ ok: false, status: 404 });
  const body = fs.readFileSync(file, 'utf8');
  return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(body) });
}

test('exampleShardOf is the builder hash, pointed at the committed shard', () => {
  assert.equal(exampleShardOf('好'), 61);
  assert.equal(exampleShardOf('银行'), 14);
  assert.equal(exampleShardOf('因为'), 20);
  const bucket = JSON.parse(fs.readFileSync(path.join(EX, 'shards', '061.json'), 'utf8'));
  assert.ok(Array.isArray(bucket['好']) && bucket['好'].length > 0, '好 lives in shard 61');
});

test('examplesFor reads the word list from the shard its hash points to', async () => {
  configure({ fetch: fileFetch });
  const list = await examplesFor('好');
  assert.equal(list.length, 4);
  for (const s of list) {
    assert.equal(typeof s.id, 'number');
    assert.ok(s.zh.includes('好'), 'the word is part of every sentence');
    assert.equal(typeof s.pinyin, 'string');
    assert.equal(typeof s.en, 'string');
  }
  configure({ fetch: fileFetch }); // leave the module clean for the next test
});

test('examplesFor resolves [] for a word with no examples', async () => {
  configure({ fetch: () => Promise.resolve({ ok: true, json: async () => ({}) }) });
  assert.deepEqual(await examplesFor('没例子'), []);
  assert.deepEqual(await examplesFor(''), [], 'an empty word never fetches');
});

test('examplesFor rejects on a network failure (the screen degrades to none)', async () => {
  configure({ fetch: () => Promise.reject(new TypeError('offline')) });
  await assert.rejects(examplesFor('好'));
  configure({ fetch: fileFetch });
});

test('highlightWord marks every occurrence with a hit flag (no colour needed)', () => {
  assert.deepEqual(highlightWord('我好胖哦。', '好'), [
    { text: '我', hit: false },
    { text: '好', hit: true },
    { text: '胖哦。', hit: false },
  ]);
  assert.deepEqual(highlightWord('好好', '好'), [
    { text: '好', hit: true },
    { text: '好', hit: true },
  ]);
  assert.deepEqual(highlightWord('abc', '好'), [{ text: 'abc', hit: false }]);
  assert.deepEqual(highlightWord('', '好'), [{ text: '', hit: false }]);
  assert.deepEqual(highlightWord('你好', ''), [{ text: '你好', hit: false }]);
});

test('exampleTranslation picks Spanish when present, English otherwise', () => {
  const both = { en: 'I work in a bank.', es: 'Trabajo en el banco.' };
  assert.equal(exampleTranslation(both, 'es'), 'Trabajo en el banco.');
  assert.equal(exampleTranslation(both, 'en'), 'I work in a bank.');
  assert.equal(exampleTranslation({ en: 'hello' }, 'es'), 'hello');
  assert.equal(exampleTranslation({}, 'es'), '');
});
