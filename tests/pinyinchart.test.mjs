import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  INITIALS,
  FINALS,
  syllableKey,
  toneOf,
  splitSyllables,
  decompose,
  buildChart,
} from '../scripts/build-pinyin-chart.mjs';
import { loadChart } from '../src/learn/pinyin-chart.js';

const CHART_URL = new URL('../public/data/pinyin-chart.json', import.meta.url);
const chart = JSON.parse(readFileSync(fileURLToPath(CHART_URL), 'utf8'));

/* ------------------------------------------------------------- helpers -- */

test('syllableKey keeps ü apart from u (CC-CEDICT writes ü as u: or v)', () => {
  assert.equal(syllableKey('nu:3'), 'nü');
  assert.equal(syllableKey('lv4'), 'lü');
  assert.equal(syllableKey('nu3'), 'nu');
  assert.equal(syllableKey('ma1'), 'ma');
  assert.equal(syllableKey('Bei3jing1'), 'beijing');
});

test('toneOf reads the trailing tone number', () => {
  assert.equal(toneOf('ma4'), 4);
  assert.equal(toneOf('r5'), 5);
  assert.equal(toneOf('ma'), null);
});

test('splitSyllables splits numbered pinyin on every tone digit', () => {
  assert.deepEqual(splitSyllables('ma1ma5'), ['ma1', 'ma5']);
  assert.deepEqual(splitSyllables('bu2 ke4qi5'), ['bu2', 'ke4', 'qi5']);
});

test('decompose splits syllables into initial + final', () => {
  assert.deepEqual(decompose('ma'), { initial: 'm', final: 'a' });
  assert.deepEqual(decompose('zhi'), { initial: 'zh', final: 'i' });
  assert.deepEqual(decompose('ri'), { initial: 'r', final: 'i' });
  assert.deepEqual(decompose('lü'), { initial: 'l', final: 'ü' });
  assert.deepEqual(decompose('a'), { initial: '', final: 'a' });
  assert.deepEqual(decompose('er'), { initial: '', final: 'er' });
  assert.equal(decompose('hm'), null, 'interjections without a real final are dropped');
});

test('the initials list matches the task spec', () => {
  assert.deepEqual(INITIALS, ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'zh', 'ch', 'sh', 'r', 'z', 'c', 's', 'y', 'w']);
  assert.ok(FINALS.includes('ü'));
});

/* ------------------------------------------------------ generated chart -- */

test('the chart has the expected top-level shape', () => {
  assert.ok(Array.isArray(chart.initials) && chart.initials.length >= 20);
  assert.ok(Array.isArray(chart.finals) && chart.finals.length >= 20);
  assert.equal(typeof chart.syllables, 'object');
  assert.equal(typeof chart.grid, 'object');
  assert.equal(chart.generatedAt.includes('T'), true);
});

test('ma exists with all four tones and a hanzi each', () => {
  const ma = chart.syllables.ma;
  assert.ok(ma, 'syllable "ma" exists');
  assert.deepEqual(ma.tones.map((t) => t.tone), [1, 2, 3, 4]);
  for (const tone of ma.tones) {
    assert.ok(tone.hanzi && tone.hanzi.length === 1, `ma${tone.tone} has a hanzi`);
    assert.ok(tone.pinyin, `ma${tone.tone} has toned pinyin`);
  }
  assert.equal(ma.tones[2].hanzi, '马', 'ma3 is 马');
});

test('zhi, chi, shi and ri exist (retroflex + buzzy i)', () => {
  for (const key of ['zhi', 'chi', 'shi', 'ri']) {
    const record = chart.syllables[key];
    assert.ok(record, `syllable "${key}" exists`);
    assert.equal(record.final, 'i');
    assert.ok(record.tones.some((t) => t.hanzi), `${key} has at least one tone with a hanzi`);
  }
  assert.equal(chart.syllables.ri.tones[3].hanzi, '日', 'rì is 日');
});

test('lü and nü exist under the ü final', () => {
  for (const key of ['lü', 'nü']) {
    const record = chart.syllables[key];
    assert.ok(record, `syllable "${key}" exists`);
    assert.equal(record.final, 'ü');
    assert.ok(record.tones.some((t) => t.hanzi), `${key} has at least one tone with a hanzi`);
  }
  assert.equal(chart.syllables.nü.tones[2].hanzi, '女', 'nǚ is 女');
});

test('every syllable key round-trips through its initial + final', () => {
  for (const [key, record] of Object.entries(chart.syllables)) {
    assert.equal(`${record.initial}${record.final}`, key, `${key} = initial + final`);
    assert.equal(record.tones.length, 4, `${key} has exactly four tones`);
    record.tones.forEach((tone, index) => {
      assert.equal(tone.tone, index + 1);
      assert.ok(tone.pinyin, `${key}${index + 1} has toned pinyin even without audio`);
      if (tone.hanzi !== null) assert.equal(tone.hanzi.length, 1, `${key}${index + 1} hanzi is one char`);
    });
  }
});

test('the grid only lists finals the syllable set actually has', () => {
  for (const [initial, finals] of Object.entries(chart.grid)) {
    for (const final of finals) {
      assert.ok(chart.syllables[`${initial}${final}`], `grid cell ${initial}${final} has a syllable`);
    }
  }
  assert.ok(chart.grid.m.includes('a'), 'm × a is a valid cell');
  assert.ok(chart.grid[''].includes('a'), 'the zero-initial group has "a"');
});

test('some tone has no common character and is marked without audio', () => {
  const withoutAudio = Object.values(chart.syllables).flatMap((s) => s.tones).filter((t) => t.hanzi === null);
  assert.ok(withoutAudio.length > 0, 'at least one tone lacks a hanzi');
  for (const tone of withoutAudio) assert.equal(tone.english, null);
});

/* ------------------------------------------------------------ buildChart -- */

test('buildChart prefers the character HSK pairs with the exact reading', () => {
  const hskItems = [
    { level: 1, hanzi: '吗', pinyinNumeric: 'ma5', english: 'question particle' },
    { level: 1, hanzi: '妈妈', pinyinNumeric: 'ma1ma5', english: 'mother' },
    { level: 3, hanzi: '马', pinyinNumeric: 'ma3', english: 'horse' },
  ];
  const cedictEntries = [
    { id: 1, simp: '麻', pinyinNumeric: 'ma2', defs: ['hemp'] },
    { id: 2, simp: '蟆', pinyinNumeric: 'ma2', defs: ['toad'] },
    { id: 3, simp: '妈', pinyinNumeric: 'ma1', defs: ['mother'] },
    { id: 4, simp: '吗', pinyinNumeric: 'ma2', defs: ['variant reading'] },
    { id: 5, simp: '马', pinyinNumeric: 'ma3', defs: ['horse'] },
    { id: 6, simp: '麻烦', pinyinNumeric: 'ma2fan2', defs: ['trouble'] },
    { id: 7, simp: '麻木', pinyinNumeric: 'ma2mu4', defs: ['numb'] },
  ];
  const built = buildChart({ hskItems, cedictEntries, generatedAt: '2020-01-01T00:00:00.000Z' });

  const ma = built.syllables.ma;
  assert.ok(ma);
  assert.equal(ma.tones[0].hanzi, '妈', 'ma1 -> 妈 (from 妈妈, tone-aligned)');
  assert.equal(ma.tones[1].hanzi, '麻', 'ma2 -> 麻, not the HSK-1 吗 (which is ma5)');
  assert.equal(ma.tones[2].hanzi, '马', 'ma3 -> 马 (HSK reading match)');
  assert.equal(ma.tones[3].hanzi, null, 'ma4 has no candidate -> no audio');
  assert.equal(ma.tones[3].pinyin, 'mà');
});

/* -------------------------------------------------------------- loadChart -- */

test('loadChart uses the injected fetchJson (no network in tests)', async () => {
  const calls = [];
  const chart2 = await loadChart({
    base: 'https://example.test/pinyin-chart.json',
    fetchJson: async (url) => {
      calls.push(url);
      return { initials: ['m'], finals: ['a'], syllables: {}, grid: {} };
    },
  });
  assert.deepEqual(calls, ['https://example.test/pinyin-chart.json']);
  assert.deepEqual(chart2.initials, ['m']);
});
