// Stroke colours on the dark theme. Canvas 2D cannot read CSS variables, so the
// draw canvas must hand it a concrete colour (see src/extras/draw.js canvasInk).
// Real pixel contrast is measured by scripts/check-strokes-dark.mjs (needs Chrome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canvasInk } from '../src/extras/draw.js';

test('canvasInk keeps concrete colours from getComputedStyle', () => {
  assert.equal(canvasInk('rgb(232, 239, 235)'), 'rgb(232, 239, 235)');
  assert.equal(canvasInk('rgba(22, 35, 38, 0.5)'), 'rgba(22, 35, 38, 0.5)');
  assert.equal(canvasInk('#e8efeb'), '#e8efeb');
  assert.equal(canvasInk('  hsl(170 40% 60%)  '), 'hsl(170 40% 60%)');
});

test('canvasInk rejects values canvas cannot resolve', () => {
  for (const value of ['var(--ink)', 'light-dark(#162326, #e8efeb)', 'currentColor', 'CanvasText', '', null, undefined]) {
    assert.equal(canvasInk(value), null, `expected null for ${String(value)}`);
  }
});

test('draw.js never assigns a CSS variable or currentColor to a canvas stroke', async () => {
  const source = await readFile(new URL('../src/extras/draw.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /strokeStyle\s*=\s*['"](var\(|currentColor)/);
  assert.doesNotMatch(source, /fillStyle\s*=\s*['"](var\(|currentColor)/);
});
