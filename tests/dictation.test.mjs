/**
 * dictation.test.mjs — pure logic of src/learn/dictation.js
 * Run with: node --test tests/dictation.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  titleKey,
  LESSON_ID,
  ROUND_SIZE,
  CHOICE_COUNT,
  TONE_MODES,
  DEFAULT_TONE_MODE,
  SETTINGS_KEY,
  normalizePinyin,
  checkPinyin,
  gradeMode,
  displayPinyin,
  respacePinyin,
  normalizeWord,
  englishText,
  isPlayable,
  shuffle,
  buildChoices,
  buildRound,
  summarize,
  getToneMode,
  setToneMode,
  loadHsk1,
  loadSrs,
  loadThemesIndex,
  loadTheme,
  loadSources,
  render,
} from '../src/learn/dictation.js';
import { memoryDriver, createStorage } from '../src/storage.js';

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const flatKeys = (obj, parents = []) =>
  Object.entries(obj ?? {}).flatMap(([key, value]) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? flatKeys(value, [...parents, key])
      : [[...parents, key].join('.')],
  );

/** Deterministic rng (mulberry32) so shuffles are reproducible in tests. */
function seeded(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  { hanzi: '你好', pinyin: 'nǐ hǎo', pinyinNumeric: 'ni3 hao3', english: 'hello' },
  { hanzi: '我', pinyin: 'wǒ', pinyinNumeric: 'wo3', english: 'I; me' },
  { hanzi: '是', pinyin: 'shì', pinyinNumeric: 'shi4', english: 'to be' },
  { hanzi: '爸爸', pinyin: 'bàba', pinyinNumeric: 'ba4ba5', english: 'Dad' },
  { hanzi: '中国', pinyin: 'zhōng guó', pinyinNumeric: 'zhong1 guo2', english: 'China' },
].map(normalizeWord);

/* --------------------------------------------------------- normalization -- */

test('normalizePinyin: tone marks and tone numbers are the same key', () => {
  assert.equal(normalizePinyin('nǐ hǎo'), 'ni3hao3');
  assert.equal(normalizePinyin('ni3 hao3'), 'ni3hao3');
  assert.equal(normalizePinyin('nǐhǎo'), 'ni3hao3');
  assert.equal(normalizePinyin('ni3hao3'), 'ni3hao3');
});

test('normalizePinyin: ignores capitals, spacing and leading/trailing blanks', () => {
  assert.equal(normalizePinyin('Ni3  Hao3'), 'ni3hao3');
  assert.equal(normalizePinyin('  Nǐ hǎo  '), 'ni3hao3');
  assert.equal(normalizePinyin('nǐ    hǎo'), 'ni3hao3');
});

test('normalizePinyin: a glued word keeps both tones (bàba -> ba4ba5)', () => {
  assert.equal(normalizePinyin('bàba'), 'ba4ba5');
  assert.equal(normalizePinyin('ba4 ba5'), 'ba4ba5');
  assert.equal(normalizePinyin('ba4ba5'), 'ba4ba5');
});

test('normalizePinyin: ü / v / u: all collapse to the same key', () => {
  assert.equal(normalizePinyin('lǜ'), 'lu4');
  assert.equal(normalizePinyin('lǜ'), normalizePinyin('lv4'));
  assert.equal(normalizePinyin('lǜ'), normalizePinyin('lu:4'));
  assert.equal(normalizePinyin('nǚ'), 'nu3');
  assert.equal(normalizePinyin('nǚ'), normalizePinyin('nv3'));
});

test('normalizePinyin: glued multi-syllable words are split like the data', () => {
  assert.equal(normalizePinyin('wǒmen'), 'wo3men5'); // 我们
  assert.equal(normalizePinyin('wo3 men5'), 'wo3men5');
  assert.equal(normalizePinyin('xièxie'), 'xie4xie5'); // 谢谢
  assert.equal(normalizePinyin('Zhōngguó'), 'zhong1guo2');
  assert.equal(normalizePinyin('xī\'ān'), normalizePinyin('xi1 an1'));
});

test('normalizePinyin: the syllable "er" and the erhua suffix agree with the data', () => {
  assert.equal(normalizePinyin('èr'), 'er4'); // 二
  assert.equal(normalizePinyin('èr'), normalizePinyin('er4'));
  assert.equal(normalizePinyin('érzi'), 'er2zi5'); // 儿子
  assert.equal(normalizePinyin('nǚ\'ér'), normalizePinyin("nv3'er2")); // 女儿
  assert.equal(normalizePinyin('nǎr'), normalizePinyin('na3r5')); // 哪儿 (erhua)
  assert.equal(normalizePinyin('nǎa'), normalizePinyin('na3')); // 哪, shipped as "nǎa"
});

test('checkPinyin: every HSK 1 word matches its own numeric reading', async () => {
  const { readFileSync } = await import('node:fs');
  const data = JSON.parse(readFileSync(new URL('../public/data/hsk/1.json', import.meta.url), 'utf8'));
  const failures = data.items.filter((item) => !checkPinyin(item.pinyin, item.pinyinNumeric));
  assert.deepEqual(failures.map((item) => item.hanzi), []);
});

test('normalizePinyin: a syllable with no tone counts as neutral (tone 5)', () => {
  assert.equal(normalizePinyin('ni hao'), 'ni5hao5');
  assert.equal(normalizePinyin('ma'), 'ma5');
  assert.equal(normalizePinyin('ma5'), 'ma5');
});

test('normalizePinyin: toneless mode drops every tone', () => {
  assert.equal(normalizePinyin('nǐ hǎo', { toneMode: 'toneless' }), 'nihao');
  assert.equal(normalizePinyin('ni3 hao3', { toneMode: 'toneless' }), 'nihao');
  assert.equal(normalizePinyin('Ni Hao', { toneMode: 'toneless' }), 'nihao');
  assert.equal(normalizePinyin('bàba', { toneMode: 'toneless' }), 'baba');
});

test('normalizePinyin: empty and junk input give an empty key', () => {
  assert.equal(normalizePinyin(''), '');
  assert.equal(normalizePinyin('   '), '');
  assert.equal(normalizePinyin(null), '');
  assert.equal(normalizePinyin(undefined), '');
  assert.equal(normalizePinyin('12345'), '');
});

/* ------------------------------------------------------------- grading -- */

test('checkPinyin: right answer in any accepted notation', () => {
  assert.equal(checkPinyin('nǐ hǎo', 'ni3 hao3'), true);
  assert.equal(checkPinyin('nǐ hǎo', 'nǐ hǎo'), true);
  assert.equal(checkPinyin('nǐ hǎo', 'NI3 HAO3'), true);
  assert.equal(checkPinyin('bàba', 'ba4ba5'), true);
});

test('checkPinyin: wrong tone is wrong in tonal mode', () => {
  assert.equal(checkPinyin('nǐ hǎo', 'ni2 hao3'), false);
  assert.equal(checkPinyin('nǐ hǎo', 'ni hao'), false); // no tones written
  assert.equal(checkPinyin('nǐ hǎo', 'ni3hao2'), false);
});

test('checkPinyin: toneless grading ignores the tones', () => {
  const opts = { toneMode: 'toneless' };
  assert.equal(checkPinyin('nǐ hǎo', 'ni hao', opts), true);
  assert.equal(checkPinyin('nǐ hǎo', 'ni3 hao3', opts), true);
  assert.equal(checkPinyin('nǐ hǎo', 'Ni Hao', opts), true);
  assert.equal(checkPinyin('nǐ hǎo', 'ni hao2', opts), true);
  assert.equal(checkPinyin('nǐ hǎo', 'wo3', opts), false);
});

test('checkPinyin: empty answer never matches', () => {
  assert.equal(checkPinyin('nǐ hǎo', ''), false);
  assert.equal(checkPinyin('nǐ hǎo', '   '), false);
  assert.equal(checkPinyin('', ''), false);
});

test('gradeMode: only "none" is lenient', () => {
  assert.equal(gradeMode('numbers'), 'tonal');
  assert.equal(gradeMode('marks'), 'tonal');
  assert.equal(gradeMode('none'), 'toneless');
  assert.equal(gradeMode(undefined), 'tonal');
});

/* ------------------------------------------------------------- display -- */

test('displayPinyin: follows the tone mode, spaced into syllables', () => {
  const word = WORDS[0]; // 你好 nǐ hǎo / ni3 hao3
  assert.equal(displayPinyin(word, 'numbers'), 'ni3 hao3');
  assert.equal(displayPinyin(word, 'marks'), 'nǐ hǎo');
  assert.equal(displayPinyin(word, 'none'), 'ni hao');
  assert.equal(displayPinyin(WORDS[3], 'none'), 'ba ba'); // 爸爸 bàba
});

test('respacePinyin: glued data pinyin becomes one syllable per span', () => {
  assert.equal(respacePinyin('tiānqì'), 'tiān qì'); // 天气
  assert.equal(respacePinyin('tian1qi4'), 'tian1 qi4');
  assert.equal(respacePinyin('bàba'), 'bà ba');
  assert.equal(respacePinyin('nǐ hǎo'), 'nǐ hǎo');
  assert.equal(respacePinyin(''), '');
  const word = normalizeWord({ hanzi: '天气', pinyin: 'tiānqì', pinyinNumeric: 'tian1qi4' });
  assert.equal(displayPinyin(word, 'numbers'), 'tian1 qi4');
  assert.equal(displayPinyin(word, 'marks'), 'tiān qì');
  assert.equal(displayPinyin(word, 'none'), 'tian qi');
});

test('displayPinyin: falls back to whatever the data has', () => {
  assert.equal(displayPinyin({ pinyin: 'nǐ hǎo' }, 'numbers'), 'nǐ hǎo');
  assert.equal(displayPinyin({ pinyinNumeric: 'ni3 hao3' }, 'marks'), 'ni3 hao3');
  assert.equal(displayPinyin({}, 'marks'), '');
});

/* --------------------------------------------------------------- words -- */

test('normalizeWord: maps HSK/deck entries and never keeps the traditional form', () => {
  const word = normalizeWord({ id: 7, hanzi: '爱', trad: '愛', pinyin: 'ài', pinyinNumeric: 'ai4', english: 'love' });
  assert.deepEqual(word, { id: '7', hanzi: '爱', pinyin: 'ài', pinyinNumeric: 'ai4', english: 'love' });
  assert.equal('trad' in word, false);
  // deck cards use simp/defs
  const card = normalizeWord({ simp: '我', pinyin: 'wǒ', defs: ['I', 'me'] });
  assert.equal(card.hanzi, '我');
  assert.equal(card.english, 'I; me');
});

test('englishText / isPlayable', () => {
  assert.equal(englishText(['cup', 'glass']), 'cup; glass');
  assert.equal(englishText('Dad'), 'Dad');
  assert.equal(englishText(undefined), '');
  assert.equal(isPlayable({ hanzi: '我', pinyin: 'wǒ' }), true);
  assert.equal(isPlayable({ hanzi: '我' }), false);
  assert.equal(isPlayable({ pinyin: 'wǒ' }), false);
  assert.equal(isPlayable(null), false);
});

/* --------------------------------------------------------------- rounds -- */

test('shuffle: same members, deterministic with a seeded rng', () => {
  const list = [1, 2, 3, 4, 5, 6];
  const a = shuffle(list, seeded(1));
  const b = shuffle(list, seeded(1));
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), list);
  assert.deepEqual(list, [1, 2, 3, 4, 5, 6], 'the input list is not mutated');
});

test('buildRound: 10 questions, mixed modes, no repeated word', () => {
  const pool = Array.from({ length: 30 }, (_, i) => normalizeWord({ hanzi: `字${i}`, pinyin: 'zi4' }));
  const round = buildRound({ words: pool, rng: seeded(42) });
  assert.equal(round.length, ROUND_SIZE);
  assert.equal(new Set(round.map((question) => question.word.hanzi)).size, ROUND_SIZE);
  assert.deepEqual(
    round.map((question) => question.mode),
    ['pinyin', 'choose', 'pinyin', 'choose', 'pinyin', 'choose', 'pinyin', 'choose', 'pinyin', 'choose'],
  );
});

test('buildRound: a single-mode round', () => {
  const round = buildRound({ words: WORDS, size: 3, mode: 'choose', rng: seeded(7) });
  assert.equal(round.length, 3);
  assert.ok(round.every((question) => question.mode === 'choose'));
  const pinyinRound = buildRound({ words: WORDS, size: 3, mode: 'pinyin', rng: seeded(7) });
  assert.ok(pinyinRound.every((question) => question.mode === 'pinyin' && question.choices.length === 0));
});

test('buildRound: never longer than the pool, and drops unusable words', () => {
  assert.equal(buildRound({ words: WORDS, size: 50, rng: seeded(3) }).length, WORDS.length);
  assert.equal(buildRound({ words: [{ hanzi: '我' }], size: 10, rng: seeded(3) }).length, 0);
  assert.equal(buildRound({ words: [], rng: seeded(3) }).length, 0);
  assert.equal(buildRound({ rng: seeded(3) }).length, 0);
});

test('buildChoices: 4 distinct hanzi including the answer', () => {
  const target = WORDS[0];
  const choices = buildChoices(target, WORDS, { rng: seeded(11) });
  assert.equal(choices.length, CHOICE_COUNT);
  assert.equal(new Set(choices).size, CHOICE_COUNT);
  assert.ok(choices.includes(target.hanzi));
});

test('buildChoices: a tiny pool just offers what exists', () => {
  const choices = buildChoices(WORDS[0], WORDS.slice(0, 2), { rng: seeded(11) });
  assert.equal(choices.length, 2);
  assert.ok(choices.includes(WORDS[0].hanzi));
  assert.ok(choices.includes(WORDS[1].hanzi));
});

test('buildRound: choose mode degrades to pinyin when there is no decoy', () => {
  const round = buildRound({ words: [WORDS[0]], mode: 'choose', rng: seeded(5) });
  assert.equal(round.length, 1);
  assert.equal(round[0].mode, 'pinyin');
  assert.deepEqual(round[0].choices, []);
});

test('summarize: score, misses and the empty round', () => {
  const results = [
    { word: WORDS[0], mode: 'pinyin', correct: true },
    { word: WORDS[1], mode: 'choose', correct: false },
    { word: WORDS[2], mode: 'pinyin', correct: true },
    { word: WORDS[3], mode: 'choose', correct: false },
  ];
  const summary = summarize(results);
  assert.deepEqual(summary, { correct: 2, total: 4, score: 50, missed: [WORDS[1], WORDS[3]] });
  assert.deepEqual(summarize([]), { correct: 0, total: 0, score: 0, missed: [] });
  assert.deepEqual(summarize(), { correct: 0, total: 0, score: 0, missed: [] });
});

/* -------------------------------------------------------------- sources -- */

const fetchJsonOf = (map) => async (url) => {
  const key = String(url).split('/data/').pop();
  if (!(key in map)) throw new Error(`404 ${key}`);
  return map[key];
};

test('loadHsk1: reads the real HSK 1 file shape', async () => {
  const words = await loadHsk1({
    base: new URL('file:///data/'),
    fetchJson: fetchJsonOf({
      'hsk/1.json': {
        count: 2,
        items: [
          { level: 1, hanzi: '爱', trad: '愛', pinyin: 'ài', pinyinNumeric: 'ai4', english: 'love' },
          { level: 1, hanzi: '八', trad: '八', pinyin: 'bā', pinyinNumeric: 'ba1', english: 'eight' },
        ],
      },
    }),
  });
  assert.equal(words.length, 2);
  assert.deepEqual(words[0], { id: '爱|ài', hanzi: '爱', pinyin: 'ài', pinyinNumeric: 'ai4', english: 'love' });
});

test('loadSrs: maps review cards from the storage store', async () => {
  const store = createStorage(memoryDriver());
  await store.set('srs', 'd1', { id: 'd1', simp: '你好', pinyin: 'nǐ hǎo', pinyinNumeric: 'ni3 hao3', defs: ['hello'] });
  await store.set('srs', 'd2', { id: 'd2', simp: '我', pinyin: 'wǒ', pinyinNumeric: 'wo3', defs: ['I'] });
  const words = await loadSrs({ store });
  assert.equal(words.length, 2);
  assert.equal(words[0].hanzi, '你好');
  assert.equal(words[0].english, 'hello');
  assert.equal(words[1].id, 'd2');
});

test('loadThemesIndex / loadTheme: absent theme data degrades to nothing', async () => {
  const empty = fetchJsonOf({});
  assert.deepEqual(await loadThemesIndex({ base: new URL('file:///data/'), fetchJson: empty }), []);
  await assert.rejects(() => loadTheme('food', { base: new URL('file:///data/'), fetchJson: empty }));

  const withThemes = fetchJsonOf({
    'themes/index.json': { themes: [{ id: 'food', title: 'Food' }, { slug: 'travel', title: 'Travel' }] },
    'themes/food.json': { items: [{ hanzi: '饭', pinyin: 'fàn', pinyinNumeric: 'fan4', english: 'rice' }] },
  });
  const base = new URL('file:///data/');
  const themes = await loadThemesIndex({ base, fetchJson: withThemes });
  assert.deepEqual(themes.map((theme) => theme.id), ['food', undefined]);
  const words = await loadTheme('food', { base, fetchJson: withThemes });
  assert.deepEqual(words, [{ id: '饭|fàn', hanzi: '饭', pinyin: 'fàn', pinyinNumeric: 'fan4', english: 'rice' }]);
});

test('loadSources: HSK1 + review deck, with counts and loaders', async () => {
  const store = createStorage(memoryDriver());
  await store.set('srs', 'd1', { id: 'd1', simp: '我', pinyin: 'wǒ', pinyinNumeric: 'wo3', defs: ['I'] });
  const sources = await loadSources({
    store,
    base: new URL('file:///data/'),
    fetchJson: fetchJsonOf({
      'hsk/1.json': { items: [{ hanzi: '爱', pinyin: 'ài', pinyinNumeric: 'ai4', english: 'love' }] },
      'themes/index.json': { themes: [{ id: 'food', title: 'Food' }] },
      'themes/food.json': { items: [{ hanzi: '饭', pinyin: 'fàn', pinyinNumeric: 'fan4', english: 'rice' }] },
    }),
  });
  assert.deepEqual(sources.map((source) => source.id), ['hsk1', 'srs', 'theme:food']);
  assert.deepEqual(sources.map((source) => source.count), [1, 1, null]);
  assert.equal(sources[0].labelKey, 'dictation.source.hsk1');
  assert.equal(sources[2].label, 'Food');
  assert.equal((await sources[0].load()).length, 1);
  assert.equal((await sources[1].load()).length, 1);
  assert.equal((await sources[2].load())[0].hanzi, '饭');
});

test('loadSources: an unreachable HSK file still yields the review source', async () => {
  const store = createStorage(memoryDriver());
  const sources = await loadSources({ store, base: new URL('file:///data/'), fetchJson: fetchJsonOf({}) });
  assert.deepEqual(sources.map((source) => source.id), ['hsk1', 'srs']);
  assert.deepEqual(sources.map((source) => source.count), [0, 0]);
});

/* ------------------------------------------------------------- settings -- */

test('getToneMode / setToneMode: stored in the settings store, validated', async () => {
  const store = createStorage(memoryDriver());
  assert.equal(await getToneMode({ store }), DEFAULT_TONE_MODE);
  assert.equal(SETTINGS_KEY, 'dictationToneMode');
  assert.equal(await setToneMode('none', { store }), 'none');
  assert.equal(await getToneMode({ store }), 'none');
  assert.equal(await store.get('settings', SETTINGS_KEY), 'none');
  assert.equal(await setToneMode('nonsense', { store }), DEFAULT_TONE_MODE);
  assert.equal(await getToneMode({ store }), DEFAULT_TONE_MODE);
  assert.deepEqual(TONE_MODES, ['numbers', 'marks', 'none']);
});

/* ------------------------------------------------------------- contract -- */

test('module keeps the screen/hub contract', () => {
  assert.equal(titleKey, 'dictation.title');
  assert.equal(LESSON_ID, 'dictation');
  assert.equal(ROUND_SIZE, 10);
  assert.equal(CHOICE_COUNT, 4);
  assert.equal(typeof render, 'function');
});

test('the shard only owns dictation.* keys, collides with nothing and is not empty', () => {
  const shard = readJson(new URL('../src/locales/en.d/dictation.json', import.meta.url));
  const shell = readJson(new URL('../src/locales/en.json', import.meta.url));
  const own = flatKeys(shard);
  assert.ok(own.length > 0);
  for (const key of own) assert.ok(key.startsWith('dictation.'), `key outside the dictation.* prefix: ${key}`);
  const shellKeys = new Set(flatKeys(shell));
  for (const key of own) assert.ok(!shellKeys.has(key), `duplicate locale key also in en.json: ${key}`);
  const walk = (obj) => {
    for (const value of Object.values(obj ?? {})) {
      if (value !== null && typeof value === 'object') walk(value);
      else assert.ok(typeof value === 'string' && value.trim() !== '', 'empty text value');
    }
  };
  walk(shard);
});

test('every static t() key used by the module exists in the shard', () => {
  const source = readFileSync(new URL('../src/learn/dictation.js', import.meta.url), 'utf8');
  const shard = readJson(new URL('../src/locales/en.d/dictation.json', import.meta.url));
  const available = new Set(flatKeys(shard));
  const keys = [
    ...[...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1]),
    ...[...source.matchAll(/\bt\(\s*`([^`]+)`/g)].map((match) => match[1]),
  ];
  assert.ok(keys.length > 0, 'the module reads its texts from i18n');
  for (const key of keys) {
    if (key.includes('${')) continue; // template key, checked by hand below
    assert.ok(available.has(key), `missing locale key: ${key}`);
  }
  // the tone-mode labels are built from a template: check all three by hand
  for (const mode of TONE_MODES) assert.ok(available.has(`dictation.toneMode.${mode}`), `missing dictation.toneMode.${mode}`);
});

test('the module writes no literal UI text (all copy goes through t())', () => {
  const source = readFileSync(new URL('../src/learn/dictation.js', import.meta.url), 'utf8');
  const literalText = [...source.matchAll(/\btext:\s*'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(literalText, [], `literal text found: ${literalText.join(', ')}`);
});
