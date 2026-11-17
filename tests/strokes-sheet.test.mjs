/**
 * Multi-character stroke sheet: input parsing, step generation, stroke-type
 * classification from real medians, and the missing-data shape. Browser-free;
 * `render()` is exercised in the headless check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  MAX_CHARACTERS,
  buildSteps,
  classifyStroke,
  parseCharacters,
  sheetLines,
} from '../src/learn/strokes-sheet.js';
import { createStrokeLoader } from '../src/learn/strokes.js';

const DATA = new URL('../public/data/strokes/', import.meta.url);
const fetchFile = (url) => fs.readFile(fileURLToPath(url), 'utf8').then((text) => JSON.parse(text));
const loader = createStrokeLoader({ base: DATA, fetchImpl: fetchFile });

test('parseCharacters keeps hanzi in order and drops spaces, letters and punctuation', () => {
  assert.deepEqual(parseCharacters(' 戴维 德!?abc123，').characters, ['戴', '维', '德']);
  assert.deepEqual(parseCharacters('hello').characters, []);
  assert.deepEqual(parseCharacters('').characters, []);
  assert.deepEqual(parseCharacters(undefined).characters, []);
});

test('parseCharacters caps at 20 characters and flags the overflow', () => {
  const text = '你好'.repeat(13); // 26 hanzi
  const parsed = parseCharacters(text);
  assert.equal(parsed.characters.length, MAX_CHARACTERS);
  assert.equal(parsed.total, 26);
  assert.equal(parsed.overflow, true);

  const exact = parseCharacters('你好'.repeat(10));
  assert.equal(exact.characters.length, 20);
  assert.equal(exact.overflow, false);
});

test('buildSteps makes n steps and step k holds the first k strokes', () => {
  const steps = buildSteps(17);
  assert.equal(steps.length, 17);
  assert.deepEqual(steps[0], { number: 1, strokes: [0], newStroke: 0 });
  assert.deepEqual(steps[4].strokes, [0, 1, 2, 3, 4]);
  assert.equal(steps[4].number, 5);
  assert.equal(steps[16].newStroke, 16);
  assert.deepEqual(buildSteps(0), []);
  assert.deepEqual(buildSteps(null), []);
});

test('classifyStroke reads the direction of the real medians (一 丨 丿 丶)', async () => {
  const expected = { 一: 'horizontal', 丨: 'vertical', 丿: 'left-falling', 丶: 'dot' };
  for (const [character, type] of Object.entries(expected)) {
    const set = await loader.load(character);
    assert.ok(set, `stroke data for ${character}`);
    assert.equal(classifyStroke(set.medians[0]), type, `${character} should be ${type}`);
  }
});

test('classifyStroke returns null when there is no safe answer', () => {
  assert.equal(classifyStroke([]), null);
  assert.equal(classifyStroke([[10, 10]]), null);
  assert.equal(classifyStroke(null), null);
});

test('the real data has the stroke counts the sheet shows (戴 17, 维 11, 德 15)', async () => {
  for (const [character, count] of Object.entries({ 戴: 17, 维: 11, 德: 15 })) {
    const set = await loader.load(character);
    assert.ok(set, `stroke data for ${character}`);
    assert.equal(set.strokes.length, count);
    assert.equal(buildSteps(set.strokes.length).length, count);
    assert.equal(classifyStroke(set.medians[0]).length > 0, true);
  }
});

test('sheetLines marks a character without stroke data and keeps the others', () => {
  const lines = sheetLines([
    { character: '戴', strokes: 17, types: ['horizontal', null] },
    { character: '龘', strokes: null, types: [] },
  ]);
  assert.deepEqual(lines[0], { character: '戴', strokes: 17, hasData: true, types: ['horizontal', null] });
  assert.deepEqual(lines[1], { character: '龘', strokes: 0, hasData: false, types: [] });
});