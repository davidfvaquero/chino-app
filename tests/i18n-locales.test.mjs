import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeDictionaries } from '../src/i18n.js';
import { listLocaleCodes, loadMergedLocale } from '../scripts/build-locales.mjs';

/** Writes a throwaway locales/ tree and returns { dir, code } as file URLs. */
async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'chino-locales-'));
  const locales = join(root, 'locales');
  await mkdir(locales, { recursive: true });
  for (const [name, dict] of Object.entries(files)) {
    const file = join(locales, name);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, JSON.stringify(dict));
  }
  return { root, dir: pathToFileURL(`${locales}/`) };
}

test('mergeDictionaries deep-merges the shared locale with module shards', () => {
  const merged = mergeDictionaries([
    { name: 'en.json', dict: { app: { title: 'Chino' }, nav: { learn: 'Learn' } } },
    { name: 'en.d/tones.json', dict: { tones: { title: 'Tones' } } },
    { name: 'en.d/hubs.json', dict: { app: { description: 'Learn Mandarin' } } },
  ]);
  assert.deepEqual(merged, {
    app: { title: 'Chino', description: 'Learn Mandarin' },
    nav: { learn: 'Learn' },
    tones: { title: 'Tones' },
  });
});

test('mergeDictionaries rejects a leaf key defined by two files (build error)', () => {
  assert.throws(
    () =>
      mergeDictionaries([
        { name: 'en.json', dict: { nav: { learn: 'Learn' } } },
        { name: 'en.d/learn.json', dict: { nav: { learn: 'Lessons' } } },
      ]),
    /duplicate locale key "nav\.learn" \(en\.json and en\.d\/learn\.json\)/,
  );
});

test('mergeDictionaries rejects a key that is an object in one file and a string in another', () => {
  assert.throws(
    () =>
      mergeDictionaries([
        { name: 'a.json', dict: { tones: { title: 'Tones' } } },
        { name: 'b.json', dict: { tones: 'oops' } },
      ]),
    /duplicate locale key "tones"/,
  );
});

test('mergeDictionaries onDuplicate collects collisions instead of throwing', () => {
  const found = [];
  mergeDictionaries(
    [
      { name: 'a.json', dict: { x: '1' } },
      { name: 'b.json', dict: { x: '2' } },
    ],
    { onDuplicate: (key, previous, next) => found.push([key, previous, next]) },
  );
  assert.deepEqual(found, [['x', 'a.json', 'b.json']]);
});

test('listLocaleCodes finds every locale file and ignores index.json', async () => {
  const { root, dir } = await fixture({ 'en.json': {}, 'es.json': {}, 'index.json': ['en'] });
  try {
    assert.deepEqual(await listLocaleCodes(dir), ['en', 'es']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loadMergedLocale merges <code>.json with every <code>.d/*.json', async () => {
  const { root, dir } = await fixture({
    'en.json': { app: { title: 'Chino' }, common: { comingSoon: 'Coming soon' } },
    'en.d/tones.json': { tones: { title: 'Tones' } },
    'en.d/hubs.json': { hubs: { learn: { lessons: 'HSK lessons' } } },
  });
  try {
    const merged = await loadMergedLocale(dir, 'en');
    assert.equal(merged.app.title, 'Chino');
    assert.equal(merged.common.comingSoon, 'Coming soon');
    assert.equal(merged.tones.title, 'Tones');
    assert.equal(merged.hubs.learn.lessons, 'HSK lessons');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loadMergedLocale fails loudly when two module shards claim the same key', async () => {
  const { root, dir } = await fixture({
    'en.json': {},
    'en.d/a.json': { shared: { title: 'A' } },
    'en.d/b.json': { shared: { title: 'B' } },
  });
  try {
    await assert.rejects(
      () => loadMergedLocale(dir, 'en'),
      /duplicate locale key "shared\.title" \(en\.d\/a\.json and en\.d\/b\.json\)/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('loadMergedLocale works with no shard directory (a language with one file)', async () => {
  const { root, dir } = await fixture({ 'es.json': { locale: { name: 'Español' } } });
  try {
    assert.deepEqual(await loadMergedLocale(dir, 'es'), { locale: { name: 'Español' } });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the shipped en locale merges without collisions', async () => {
  const merged = await loadMergedLocale(new URL('../src/locales/', import.meta.url), 'en');
  assert.equal(merged.app.title, 'Chino');
  assert.equal(merged.hubs.learn.tones, 'Tones & pinyin');
  assert.equal(merged.hubs.extras.pronounce, 'Pronunciation practice');
});
