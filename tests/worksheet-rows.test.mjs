/**
 * Rows-style worksheet: pure layout (one row per character, step strip,
 * copies, pagination). Canvas drawing is exercised by the headless check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  A4,
  DEFAULT_COPIES,
  MAX_COPIES,
  MIN_COPIES,
  clampCopies,
  planStepStrip,
  planWorksheet,
} from '../src/extras/worksheet-rows.js';

const cards = (strokes) =>
  strokes.map((count, index) => ({
    character: `字${index}`,
    pinyin: `pin${index}`,
    strokes: count,
  }));

test('clampCopies keeps 0..8 and defaults to 4', () => {
  assert.equal(DEFAULT_COPIES, 4);
  assert.equal(MIN_COPIES, 0);
  assert.equal(MAX_COPIES, 8);
  for (let n = 0; n <= 8; n += 1) assert.equal(clampCopies(n), n);
  assert.equal(clampCopies(-3), 0);
  assert.equal(clampCopies(20), 8);
  assert.equal(clampCopies('6'), 6);
  assert.equal(clampCopies(undefined), 4);
  assert.equal(clampCopies(3.9), 3);
});

test('planStepStrip: one step per stroke, N glyphs for N strokes', () => {
  const strip = planStepStrip(7, { availW: 430 });
  assert.equal(strip.steps, 7);
  assert.equal(strip.lines, 1);
  assert.equal(strip.stepPt, 15); // full height, 7 glyphs fit easily
  assert.ok(strip.perLine >= 7);
  assert.equal(planStepStrip(0, { availW: 430 }).steps, 0);
});

test('planStepStrip shrinks for long characters and splits past ~30 strokes', () => {
  const wide = planStepStrip(30, { availW: 430, stepH: 15 });
  assert.equal(wide.lines, 1);
  assert.ok(wide.stepPt < 15);
  assert.ok(wide.stepPt * wide.perLine <= 430);

  const huge = planStepStrip(40, { availW: 430, stepH: 15 });
  assert.equal(huge.lines, 2);
  assert.ok(huge.perLine * 2 >= 40);
});

test('planWorksheet makes N steps per character, last step = all strokes', () => {
  const plan = planWorksheet(cards([7, 17]), { copies: 4 });
  assert.equal(plan.rows.length, 2);
  const [first, last] = plan.rows;
  assert.equal(first.steps.length, 7);
  assert.equal(last.steps.length, 17);
  assert.deepEqual(last.steps.at(-1).strokes, Array.from({ length: 17 }, (_, i) => i));
  assert.equal(last.steps.at(-1).newStroke, 16);
  assert.deepEqual(first.steps.at(-1).strokes, Array.from({ length: 7 }, (_, i) => i));
  // every step k holds strokes 0..k
  first.steps.forEach((step, k) => assert.equal(step.strokes.length, k + 1));
});

test('planWorksheet: model + copies + empty cells (copies 0..8)', () => {
  for (let copies = 0; copies <= 8; copies += 1) {
    const plan = planWorksheet(cards([5]), { copies });
    const cells = plan.rows[0].cells;
    assert.equal(cells.length, plan.cellsPerRow);
    assert.equal(cells[0], 'model');
    assert.equal(cells.filter((k) => k === 'copy').length, copies);
    assert.equal(cells.filter((k) => k === 'empty').length, plan.cellsPerRow - 1 - copies);
  }
  // cellsPerRow stays in the 12..14 range the sheet asks for
  const plan = planWorksheet(cards([5]), {});
  assert.ok(plan.cellsPerRow >= 12 && plan.cellsPerRow <= 14);
});

test('planWorksheet paginates A4: 12+ rows per page, 20 chars -> 2 pages', () => {
  const plan = planWorksheet(cards(Array.from({ length: 20 }, () => 8)), { copies: 4 });
  assert.equal(plan.pages.length, 2);
  assert.ok(plan.rowsPerPage >= 12 && plan.rowsPerPage <= 13, `rowsPerPage=${plan.rowsPerPage}`);
  plan.pages.forEach((page) => assert.ok(page.length <= plan.rowsPerPage));
  assert.equal(plan.pages.flat().length, 20);
  // rows never overflow the printable box
  plan.pages.forEach((page) => {
    const used = page.reduce((sum, row) => sum + row.height, 0);
    assert.ok(used <= plan.usableH + 0.001, `${used} > ${plan.usableH}`);
  });
  // 10 characters fit on a single page
  assert.equal(planWorksheet(cards(Array.from({ length: 10 }, () => 8))).pages.length, 1);
  // A4 portrait
  assert.equal(plan.pageW, A4.width);
  assert.equal(plan.pageH, A4.height);
});

test('planWorksheet respects pinyin and step switches', () => {
  const off = planWorksheet(cards([7]), { showPinyin: false });
  assert.equal(off.rows[0].pinyin, '');
  assert.equal(off.pinyinW, 0);
  assert.ok(off.availW > planWorksheet(cards([7])).availW);

  const noSteps = planWorksheet(cards([7]), { showSteps: false });
  assert.equal(noSteps.rows[0].steps.length, 0);
  assert.ok(noSteps.rows[0].height < planWorksheet(cards([7])).rows[0].height);
});
