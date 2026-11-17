import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { hardWords, getHardWords } from '../src/hardwords.js';
import { memoryDriver, createStorage } from '../src/storage.js';

const card = (id, lapses, ease) => ({ id, hanzi: id, pinyin: 'x', english: ['e'], ...(lapses === undefined ? {} : { lapses }), ...(ease === undefined ? {} : { ease }) });

test('min threshold: default 3, custom min, legacy cards (no lapses) never hard', () => {
  const cards = [card('a', 2), card('b', 3), card('c', 4), card('legacy')];
  assert.deepEqual(hardWords(cards).map((c) => c.id).sort(), ['b', 'c']);
  assert.deepEqual(hardWords(cards, { min: 2 }).map((c) => c.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(hardWords(cards, { min: 0 }).length, 4);
});

test('sorted by severity: more lapses first, lower ease breaks ties', () => {
  const out = hardWords([card('a', 3, 2.5), card('b', 3, 1.3), card('c', 5, 2.5), card('d', 3, 1.3)]);
  assert.deepEqual(out.map((c) => c.id), ['c', 'b', 'd', 'a']);
  assert.ok(out[0].severity > out[1].severity);
});

test('getHardWords reads the srs store and does not mutate cards', async () => {
  const store = createStorage(memoryDriver());
  await store.set('srs', 'p', card('p', 4, 1.5));
  await store.set('srs', 'q', card('q', 1, 2.5));
  const out = await getHardWords({ store });
  assert.deepEqual(out.map((c) => c.id), ['p']);
  assert.equal(out[0].lapses, 4);
  assert.equal((await store.get('srs', 'p')).severity, undefined);
  assert.deepEqual((await getHardWords({ store, min: 1 })).map((c) => c.id), ['p', 'q']);
});

test('locale shard has every key the screen uses', () => {
  const shard = JSON.parse(readFileSync(new URL('../src/locales/en.d/hardwords.json', import.meta.url), 'utf8')).hardwords;
  const src = readFileSync(new URL('../src/learn/hardwords.js', import.meta.url), 'utf8');
  const keys = [...src.matchAll(/t\('hardwords\.([\w.]+)'/g)].map((m) => m[1]);
  keys.push('again', 'good');
  for (const k of keys) assert.equal(typeof k.split('.').reduce((o, p) => o?.[p], shard), 'string', k);
});
