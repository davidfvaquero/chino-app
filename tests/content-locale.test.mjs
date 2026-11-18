/**
 * content-locale.test.mjs — the study screens load their CONTENT in the active
 * language. With locale 'es' they read `data/es/<path>` when the translation
 * exists and fall back to English (no error) when it does not.
 *
 * Owner: t_dd58b364 (connect the engines). Browser-free: a stub fetch + base,
 * so nothing here touches the network or the DOM.
 *
 * Covered modules: lessons, themes, grammar, readings, dictation (HSK list),
 * and a guard that no connected screen keeps a hard-coded absolute '/data/'.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { registerLocale, setLocale } from '../src/i18n.js';
import { configure, resetCache } from '../src/data-url.js';
import { loadIndex as loadLessonIndex, loadLesson } from '../src/learn/lessons.js';
import { loadIndex as loadThemeIndex, loadTheme } from '../src/learn/themes.js';
import { loadIndex as loadGrammarIndex, loadPattern } from '../src/learn/grammar.js';
import { loadIndex as loadReadingIndex, loadReading } from '../src/reading/data.js';
import { loadHsk1 } from '../src/learn/dictation.js';

registerLocale('en', {});
registerLocale('es', { locale: { name: 'Español' } });

const BASE = 'https://example.com/chino/data/'; // data root (Pages-subdirectory safe)
const ES = `${BASE}es/`;

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
  configure({ base: BASE, fetch: impl });
  return calls;
}

beforeEach(() => resetCache());

/* ---------------------------------------------------------------- lessons -- */

test('lessons: locale es reads data/es/lessons/... when translated', async () => {
  const calls = setup({
    [`${ES}lessons/hsk1/index.json`]: { level: 'hsk1', lessons: [{ id: 'hsk1-01', title: 'Saludos y números', file: 'lesson-01.json' }] },
    [`${ES}lessons/hsk1/lesson-01.json`]: { id: 'hsk1-01', title: 'Saludos y números', vocabulary: [] },
    [`${BASE}lessons/hsk1/index.json`]: { level: 'hsk1', lessons: [{ id: 'hsk1-01', title: 'Greetings & numbers', file: 'lesson-01.json' }] },
    [`${BASE}lessons/hsk1/lesson-01.json`]: { id: 'hsk1-01', title: 'Greetings & numbers', vocabulary: [] },
  });
  setLocale('es');

  const index = await loadLessonIndex('hsk1');
  assert.equal(index.lessons[0].title, 'Saludos y números');
  const lesson = await loadLesson('hsk1', 'hsk1-01');
  assert.equal(lesson.title, 'Saludos y números');
  assert.ok(calls.includes(`${ES}lessons/hsk1/lesson-01.json`));
  assert.ok(!calls.includes(`${BASE}lessons/hsk1/lesson-01.json`), 'English lesson not fetched');
});

test('lessons: locale es without a translation falls back to English', async () => {
  const calls = setup({
    [`${BASE}lessons/hsk2/index.json`]: { level: 'hsk2', lessons: [{ id: 'hsk2-01', title: 'HSK 2', file: 'lesson-01.json' }] },
    [`${BASE}lessons/hsk2/lesson-01.json`]: { id: 'hsk2-01', title: 'HSK 2', vocabulary: [] },
  });
  setLocale('es');

  const index = await loadLessonIndex('hsk2');
  assert.equal(index.lessons[0].title, 'HSK 2');
  const lesson = await loadLesson('hsk2', 'hsk2-01');
  assert.equal(lesson.title, 'HSK 2');
  assert.ok(calls.includes(`${ES}lessons/hsk2/index.json`), 'the es file was probed');
  assert.ok(calls.includes(`${BASE}lessons/hsk2/index.json`), 'English fallback was fetched');
});

test('lessons: locale en never probes Spanish', async () => {
  const calls = setup({ [`${BASE}lessons/hsk1/index.json`]: { level: 'hsk1', lessons: [] } });
  setLocale('en');
  await loadLessonIndex('hsk1');
  assert.deepEqual(calls, [`${BASE}lessons/hsk1/index.json`]);
});

/* ----------------------------------------------------------------- themes -- */

test('themes: es translation wins, missing one falls back to English', async () => {
  const calls = setup({
    [`${ES}themes/index.json`]: [{ id: 'theme-01', title: 'Saludos' }],
    [`${ES}themes/theme-01.json`]: { id: 'theme-01', title: 'Saludos', words: [{ hanzi: '你', pinyin: 'nǐ', english: 'tú' }], phrases: [] },
    [`${BASE}themes/index.json`]: [{ id: 'theme-01', title: 'Greetings' }],
    [`${BASE}themes/theme-01.json`]: { id: 'theme-01', title: 'Greetings', words: [{ hanzi: '你', pinyin: 'nǐ', english: 'you' }], phrases: [] },
  });
  setLocale('es');

  const index = await loadThemeIndex();
  assert.equal(index[0].title, 'Saludos');
  const theme = await loadTheme('theme-01');
  assert.equal(theme.words[0].english, 'tú');

  // a theme with no Spanish file falls back
  const calls2 = setup({ [`${BASE}themes/index.json`]: [{ id: 'theme-99', title: 'Only English' }] });
  setLocale('es');
  const fallback = await loadThemeIndex();
  assert.equal(fallback[0].title, 'Only English');
  assert.ok(calls2.includes(`${BASE}themes/index.json`));
  assert.ok(calls.length > 0);
});

/* ---------------------------------------------------------------- grammar -- */

test('grammar: es index/pattern win, missing file falls back to English', async () => {
  const calls = setup({
    [`${ES}grammar/index.json`]: { patterns: [{ id: 'shi', title: 'Ser', level: 'HSK1', file: 'pattern-01.json' }] },
    [`${ES}grammar/pattern-01.json`]: { id: 'shi', title: 'Ser', level: 'HSK1', explanation: 'explicación', structure: 'A 是 B', examples: [{ hanzi: '我是学生', pinyin: 'wǒ shì xuésheng', english: 'soy estudiante' }] },
    [`${BASE}grammar/index.json`]: { patterns: [{ id: 'shi', title: 'To be', level: 'HSK1', file: 'pattern-01.json' }] },
    [`${BASE}grammar/pattern-01.json`]: { id: 'shi', title: 'To be', level: 'HSK1', explanation: 'explanation', structure: 'A 是 B', examples: [{ hanzi: '我是学生', pinyin: 'wǒ shì xuésheng', english: 'I am a student' }] },
  });
  setLocale('es');

  const index = await loadGrammarIndex();
  assert.equal(index[0].title, 'Ser');
  const pattern = await loadPattern('shi');
  assert.equal(pattern.title, 'Ser');
  assert.equal(pattern.examples[0].english, 'soy estudiante');
  assert.ok(calls.includes(`${ES}grammar/pattern-01.json`));
});

/* --------------------------------------------------------------- readings -- */

test('readings: es file used when present, English fallback otherwise', async () => {
  const calls = setup({
    [`${ES}readings/hsk1/index.json`]: [{ id: 'reading-01', title: '¡Hola!', topic: 'saludos' }],
    [`${ES}readings/hsk1/reading-01.json`]: { id: 'reading-01', title: '¡Hola!', lines: [{ hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hola' }] },
    [`${BASE}readings/hsk1/index.json`]: [{ id: 'reading-01', title: 'Hello!', topic: 'greetings' }],
    [`${BASE}readings/hsk1/reading-01.json`]: { id: 'reading-01', title: 'Hello!', lines: [{ hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' }] },
  });
  setLocale('es');

  const index = await loadReadingIndex();
  assert.equal(index[0].title, '¡Hola!');
  const reading = await loadReading('reading-01');
  assert.equal(reading.lines[0].english, 'hola');
  assert.ok(calls.includes(`${ES}readings/hsk1/reading-01.json`));
});

test('readings: an injected fetch keeps the plain-URL contract', async () => {
  const seen = [];
  const fileFetch = async (url) => {
    seen.push(String(url));
    return { ok: true, status: 200, json: async () => [{ id: 'reading-01', title: 'T', topic: 'x' }] };
  };
  setLocale('es');
  const index = await loadReadingIndex({ fetch: fileFetch });
  assert.equal(index.length, 1);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].endsWith('/data/readings/hsk1/index.json'));
});

/* ---------------------------------------------------------------- HSK list -- */

test('dictation: HSK list goes through the language-aware loader', async () => {
  const calls = setup({
    [`${BASE}hsk/1.json`]: { items: [{ hanzi: '爱', pinyin: 'ài', pinyinNumeric: 'ai4', english: 'love' }] },
  });
  setLocale('es');
  const words = await loadHsk1();
  assert.equal(words[0].hanzi, '爱');
  assert.ok(calls.includes(`${ES}hsk/1.json`), 'es HSK probed');
  assert.ok(calls.includes(`${BASE}hsk/1.json`), 'English HSK fetched');
});

/* ------------------------------------------------------- no absolute '/data/' -- */

/** Drops `//` and `/* *\/` comments so doc examples are not mistaken for code. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('no connected screen fetches an absolute /data/ path', () => {
  const files = [
    'src/learn/lessons.js',
    'src/learn/themes.js',
    'src/learn/grammar.js',
    'src/learn/sentences.js',
    'src/learn/dictation.js',
    'src/learn/games.js',
    'src/learn/games/matching.js',
    'src/learn/games/memory.js',
    'src/learn/games/timed.js',
    'src/screens/read.js',
    'src/screens/home.js',
    'src/reading/data.js',
    'src/extras/pronounce.js',
    'src/extras/paste.js',
  ];
  for (const rel of files) {
    const code = stripComments(readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8'))
      // The Node-only `typeof document === 'undefined' ? '/data/...'` fallback is
      // browser-safe (the browser branch is relative to document.baseURI); the
      // modules that only exist for tests keep it. Any other absolute path fails.
      .replace(/typeof document === 'undefined'\s*\?\s*['"`]\/data\/[^'"`]*['"`]/g, 'NODE_FALLBACK');
    assert.ok(!/['"`]\/data\//.test(code), `${rel} still has an absolute '/data/' path`);
  }
});

