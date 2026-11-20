/**
 * Worksheet: input parsing, grid building, layout calculation.
 * Browser-free; render() is exercised in the headless check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  MAX_CHARACTERS,
  CELL_SIZES,
  parseCharacters,
  buildGrid,
  calculateLayout,
} from '../src/extras/worksheet.js';
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

test('buildGrid creates correct number of cells (rows x 2 cols)', () => {
  const grid3 = buildGrid(3);
  assert.equal(grid3.rows, 3);
  assert.equal(grid3.cols, 2);
  assert.equal(grid3.cells.length, 6);
  assert.deepEqual(grid3.cells[0], { r: 0, c: 0 });
  assert.deepEqual(grid3.cells[1], { r: 0, c: 1 });
  assert.deepEqual(grid3.cells[5], { r: 2, c: 1 });

  const grid5 = buildGrid(5);
  assert.equal(grid5.cells.length, 10);

  const grid10 = buildGrid(10);
  assert.equal(grid10.cells.length, 20);

  // Edge cases
  assert.deepEqual(buildGrid(0), { rows: 1, cols: 2, cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }] });
  assert.deepEqual(buildGrid(-2), { rows: 1, cols: 2, cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }] });
  assert.deepEqual(buildGrid(null), { rows: 1, cols: 2, cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }] });
});

test('calculateLayout returns per-character rows and total', () => {
  const layout = calculateLayout(['戴', '维', '德'], { rowsPerChar: 5 });
  assert.deepEqual(layout.characters, ['戴', '维', '德']);
  assert.equal(layout.cellsPerRow, 2);
  assert.equal(layout.totalRows, 15); // 3 chars × 5 rows
  assert.equal(layout.perChar.length, 3);
  assert.deepEqual(layout.perChar[0], { char: '戴', rows: 5 });
  assert.deepEqual(layout.perChar[2], { char: '德', rows: 5 });

  // Clamps to 3–10
  const clampedLow = calculateLayout(['你'], { rowsPerChar: 1 });
  assert.equal(clampedLow.perChar[0].rows, 3);
  assert.equal(clampedLow.totalRows, 3);

  const clampedHigh = calculateLayout(['你'], { rowsPerChar: 15 });
  assert.equal(clampedHigh.perChar[0].rows, 10);
  assert.equal(clampedHigh.totalRows, 10);
});

test('CELL_SIZES has the expected keys and structure', () => {
  assert.ok(CELL_SIZES.small);
  assert.ok(CELL_SIZES.medium);
  assert.ok(CELL_SIZES.large);
  assert.equal(typeof CELL_SIZES.small.size, 'number');
  assert.equal(typeof CELL_SIZES.small.labelKey, 'string');
  assert.ok(CELL_SIZES.small.size < CELL_SIZES.medium.size);
  assert.ok(CELL_SIZES.medium.size < CELL_SIZES.large.size);
});

test('the real data has stroke counts for 戴 (17), 维 (11), 德 (15)', async () => {
  for (const [character, count] of Object.entries({ 戴: 17, 维: 11, 德: 15 })) {
    const set = await loader.load(character);
    assert.ok(set, `stroke data for ${character}`);
    assert.equal(set.strokes.length, count);
  }
});

test('strokeDiagramSvg is exported from strokes.js (smoke check)', async () => {
  const { strokeDiagramSvg } = await import('../src/learn/strokes.js');
  assert.equal(typeof strokeDiagramSvg, 'function');
});
test('I15: planCards lays out cards and shares one renderer with the PDF', async () => {
  const { planCards } = await import('../src/extras/worksheet-cards.js');
  const cards = [{ character: '戴', entry: { pinyinTone: 'dài', defs: ['to wear'] }, set: { strokes: new Array(17).fill('M0 0') } }];
  const plan = planCards(cards, { rowsPerChar: 5, showPinyin: true, showMeaning: true });
  assert.equal(plan.rowsPerChar, 5);
  assert.ok(plan.cellPt > 0);
  assert.equal(plan.blocks.length, 1);
  assert.equal(plan.blocks[0].pinyin, 'dài');
  assert.equal(plan.blocks[0].meaning, 'to wear');
  assert.equal(plan.blocks[0].strokes, 17);
  // Pinyin off stays off in the plan (so preview and PDF agree).
  const off = planCards(cards, { showPinyin: false });
  assert.equal(off.blocks[0].pinyin, '');
});
