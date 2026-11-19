/**
 * hubs.test.mjs — the Learn and More menus must connect every screen that
 * already exists as a direct route, and every menu card must carry a title and
 * a short description in both locales.
 *
 * Browser-free: reads the hub sources + each area's titleKey and checks the
 * merged locale shards, so it mirrors what the hub renders without a DOM.
 * Owner: t_677d0794.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadMergedLocale } from '../scripts/build-locales.mjs';

const LOCALES = new URL('../src/locales/', import.meta.url);
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const HUBS = { learn: 'src/screens/learn.js', extras: 'src/screens/extras.js' };
/** Areas this task connected (they used to be reachable by route only). */
const NEW_AREAS = {
  learn: ['plan', 'exam', 'typing'],
  extras: ['worksheet', 'anki', 'account', 'conversation'],
};
const MAX_DESCRIPTION = 80;

const areasOf = (source) =>
  source
    .match(/const AREAS = \[([^\]]*)\]/)[1]
    .match(/'([^']+)'/g)
    .map((s) => s.slice(1, -1));
const titleKeyOf = (hub, area) => readFile(new URL(`src/${hub}/${area}.js`, root), 'utf8').then((s) => s.match(/^export const titleKey = '([^']+)'/m)[1]);
const get = (dict, key) => key.split('.').reduce((o, k) => o?.[k], dict);

test('both hubs list the new areas and each area module exists with titleKey + render', async () => {
  for (const [hub, file] of Object.entries(HUBS)) {
    const areas = areasOf(await read(file));
    for (const area of NEW_AREAS[hub]) assert.ok(areas.includes(area), `${hub}: "${area}" missing from AREAS`);
    assert.equal(new Set(areas).size, areas.length, `${hub}: AREAS has duplicates`);
    for (const area of areas) {
      const source = await read(`src/${hub}/${area}.js`);
      assert.match(source, /^export const titleKey = '[^']+'/m, `${hub}/${area}.js exports titleKey`);
      assert.match(source, /export (async )?function render\(/, `${hub}/${area}.js exports render`);
    }
  }
});

test('every menu card has a title in en and es (never a raw key)', async () => {
  for (const code of ['en', 'es']) {
    const dict = await loadMergedLocale(LOCALES, code);
    for (const [hub, file] of Object.entries(HUBS)) {
      for (const area of areasOf(await read(file))) {
        const titleKey = await titleKeyOf(hub, area);
        const label = get(dict, `hubs.${hub}.${area}`) ?? get(dict, titleKey);
        assert.equal(typeof label, 'string', `${code}: ${hub}/${area} has no title (hubs.${hub}.${area} / ${titleKey})`);
        assert.notEqual(label.trim(), '', `${code}: ${hub}/${area} title is empty`);
      }
    }
  }
});

test('every newly connected card has a short description in en and es', async () => {
  for (const code of ['en', 'es']) {
    const dict = await loadMergedLocale(LOCALES, code);
    for (const [hub, areas] of Object.entries(NEW_AREAS)) {
      for (const area of areas) {
        const key = `hubs.${hub}.descriptions.${area}`;
        const text = get(dict, key);
        assert.equal(typeof text, 'string', `${code}: ${key} missing`);
        assert.notEqual(text.trim(), '', `${code}: ${key} is empty`);
        assert.ok(text.length <= MAX_DESCRIPTION, `${code}: ${key} too long (${text.length} > ${MAX_DESCRIPTION})`);
      }
    }
  }
});

test('the es description set matches en one-to-one', async () => {
  const en = await loadMergedLocale(LOCALES, 'en');
  const es = await loadMergedLocale(LOCALES, 'es');
  for (const hub of Object.keys(HUBS)) {
    assert.deepEqual(
      Object.keys(get(en, `hubs.${hub}.descriptions`) ?? {}).sort(),
      Object.keys(get(es, `hubs.${hub}.descriptions`) ?? {}).sort(),
      `hubs.${hub}.descriptions keys differ between locales`,
    );
  }
});
