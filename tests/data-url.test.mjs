/**
 * data-url.test.mjs — the language-aware data loader (browser-free, no deps).
 *
 * Owner: t_4fa17334 (Spanish study content). Uses a stub fetch + a stub base
 * URL, so nothing here touches the network or the DOM.
 *
 * Covered: English always reads data/; Spanish reads data/es/ when the file
 * exists and falls back to English when it does not (404 remembered, never
 * repeated); the es listing skips the probe; URLs stay relative to the app base
 * (GitHub Pages subdirectory).
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerLocale, setLocale } from '../src/i18n.js';
import {
  configure,
  dataUrl,
  fetchData,
  hasLocalizedData,
  loadManifest,
  normalizePath,
  resetCache,
} from '../src/data-url.js';

registerLocale('en', {});
registerLocale('es', { locale: { name: 'Español' } });

const BASE = 'https://example.com/chino/'; // the app in a Pages subdirectory
const EN = `${BASE}data/`; // the data root: what the module's base points at
const ES = `${EN}es/`;
const LESSON = 'lessons/hsk1/lesson-01.json';

/** Fake fetch over a { url: json } map; records every requested URL. */
function stub(files = {}) {
  const calls = [];
  const impl = async (url) => {
    const key = String(url);
    calls.push(key);
    if (Object.prototype.hasOwnProperty.call(files, key)) {
      return { ok: true, status: 200, json: async () => files[key] };
    }
    return {
      ok: false,
      status: 404,
      json: async () => {
        throw new Error('404');
      },
    };
  };
  return { calls, impl };
}

function setup(files = {}) {
  const { calls, impl } = stub(files);
  configure({ base: EN, fetch: impl });
  return calls;
}

beforeEach(() => resetCache());

test('locale en: always the English file, no Spanish probe', async () => {
  const calls = setup({
    [`${EN}${LESSON}`]: { id: 'hsk1-01', title: 'Greetings' },
    [`${ES}${LESSON}`]: { id: 'hsk1-01', title: 'Saludos' },
  });
  setLocale('en');

  assert.equal(await dataUrl(LESSON), `${EN}${LESSON}`);
  assert.deepEqual(await fetchData(LESSON), { id: 'hsk1-01', title: 'Greetings' });
  assert.deepEqual(calls, [`${EN}${LESSON}`]);
});

test('locale es: data/es/<path> when the translation exists', async () => {
  const calls = setup({
    [`${EN}${LESSON}`]: { id: 'hsk1-01', title: 'Greetings' },
    [`${ES}${LESSON}`]: { id: 'hsk1-01', title: 'Saludos' },
  });
  setLocale('es');

  assert.equal(await dataUrl(LESSON), `${ES}${LESSON}`);
  assert.deepEqual(await fetchData(LESSON), { id: 'hsk1-01', title: 'Saludos' });
  assert.equal(await hasLocalizedData(LESSON), true);
  // one listing request (absent here) + one probe, whose body is reused as the data
  assert.deepEqual(calls, [`${ES}files.json`, `${ES}${LESSON}`]);
});

test('locale es: a missing translation falls back to English and is not retried', async () => {
  const calls = setup({ [`${EN}${LESSON}`]: { id: 'hsk1-01', title: 'Greetings' } });
  setLocale('es');

  assert.deepEqual(await fetchData(LESSON), { id: 'hsk1-01', title: 'Greetings' });
  assert.equal(await dataUrl(LESSON), `${EN}${LESSON}`);
  assert.equal(await hasLocalizedData(LESSON), false);
  assert.deepEqual(await fetchData(LESSON), { id: 'hsk1-01', title: 'Greetings' });

  // the 404 is remembered: the es URL is asked exactly once (and the JSON is cached)
  assert.equal(calls.filter((url) => url === `${ES}${LESSON}`).length, 1);
  assert.equal(calls.filter((url) => url === `${EN}${LESSON}`).length, 1);
});

test('locale es: a broken/offline es request falls back to English too', async () => {
  configure({
    base: EN,
    fetch: async (url) => {
      const key = String(url);
      if (key.startsWith(ES)) throw new Error('network down');
      return { ok: true, status: 200, json: async () => ({ title: 'English' }) };
    },
  });
  setLocale('es');

  assert.equal(await dataUrl(LESSON), `${EN}${LESSON}`);
  assert.deepEqual(await fetchData(LESSON), { title: 'English' });
});

test('the es listing (data/es/files.json) answers without probing', async () => {
  const calls = setup({
    [`${ES}files.json`]: [{ file: LESSON, bytes: 10 }],
    [`${ES}${LESSON}`]: { title: 'Saludos' },
  });
  setLocale('es');

  const listing = await loadManifest();
  assert.equal(listing instanceof Set, true);
  assert.equal(listing.has(LESSON), true);

  assert.equal(await dataUrl(LESSON), `${ES}${LESSON}`);
  // listed file -> es URL, unlisted file -> en URL, and neither is probed
  assert.equal(await dataUrl('themes/theme-01.json'), `${EN}themes/theme-01.json`);
  assert.deepEqual(calls, [`${ES}files.json`]);
});

test('a translation on disk is found even without the listing', async () => {
  setup({ [`${ES}${LESSON}`]: { title: 'Saludos' } }); // no files.json
  setLocale('es');

  assert.equal(await loadManifest(), null);
  assert.equal(await dataUrl(LESSON), `${ES}${LESSON}`);
});

test('normalizePath accepts the paths callers actually pass', () => {
  assert.equal(normalizePath(LESSON), LESSON);
  assert.equal(normalizePath(`data/${LESSON}`), LESSON);
  assert.equal(normalizePath(`public/data/${LESSON}`), LESSON);
  assert.equal(normalizePath(`/data/es/${LESSON}`), LESSON);
  assert.equal(normalizePath(`./${LESSON}`), LESSON);
});

test('URLs stay relative to the app base (subdirectory safe)', async () => {
  setup({ [`${ES}${LESSON}`]: { title: 'Saludos' } });
  setLocale('es');
  const url = await dataUrl(LESSON);
  assert.equal(url.startsWith('https://example.com/chino/data/'), true);
  assert.equal(url.includes('//data/'), false);

  configure({ base: null, fetch: async () => ({ ok: false, status: 404 }) });
  setLocale('es');
  assert.equal(await dataUrl(LESSON), 'http://localhost/data/lessons/hsk1/lesson-01.json');
});

test('resetCache forgets the 404 memory', async () => {
  const calls = setup({ [`${EN}${LESSON}`]: { title: 'Greetings' } });
  setLocale('es');
  await fetchData(LESSON);
  resetCache();
  await fetchData(LESSON);
  assert.equal(calls.filter((url) => url === `${ES}${LESSON}`).length, 2);
});
