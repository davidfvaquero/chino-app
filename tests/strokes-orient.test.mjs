/**
 * Orientation of the stroke data: Make Me a Hanzi is y UP, the screen is y DOWN.
 * Without the flip every glyph and every median came out upside down; a drawn
 * 十 was matched against an upside-down reference. Fails if either side flips
 * on its own.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createStrokeLoader, OUTLINE_FLIP, toStrokeSet } from '../src/learn/strokes.js';
import { classifyStroke } from '../src/learn/strokes-sheet.js';
import { addEntries, match } from '../src/extras/strokematch.js';
import { normaliseStroke } from '../src/extras/draw.js';

const DATA = new URL('../public/data/strokes/', import.meta.url);
const fetchFile = (url) => fs.readFile(fileURLToPath(url), 'utf8').then((text) => JSON.parse(text));
const loader = createStrokeLoader({ base: DATA, fetchImpl: fetchFile });

/** Raw shard entry (y UP, as committed). */
const rawEntry = async (character) => {
  const index = await loader.loadIndex();
  const shard = await fetchFile(new URL(index.shardFiles[index.lookup[character]], DATA).href);
  return shard.find((entry) => entry.character === character);
};

test('OUTLINE_FLIP is the hanzi-writer flip: y -> 900 - y', () => {
  assert.equal(OUTLINE_FLIP, 'scale(1,-1) translate(0,-900)');
});

test('toStrokeSet puts medians in screen space: 你 first stroke (丿) starts at the top', async () => {
  const raw = await rawEntry('你');
  const set = toStrokeSet(raw);
  assert.equal(set.medians[0][0][1], 900 - raw.medians[0][0][1]);
  assert.ok(set.medians[0][0][1] < 450, 'first point of 丿 is in the upper half');
  assert.ok(set.medians[0][0][1] < set.medians[0].at(-1)[1], '丿 goes downwards');
  assert.equal(set.strokes[0], raw.strokes[0], 'outlines are not rewritten, flipped by transform');
});

test('the real medians keep their direction after the flip (十: 一 left->right, 丨 top->bottom)', async () => {
  const set = await loader.load('十');
  const [horizontal, vertical] = set.medians;
  assert.equal(classifyStroke(horizontal), 'horizontal');
  assert.ok(horizontal[0][0] < horizontal.at(-1)[0], '一 goes left to right');
  assert.equal(classifyStroke(vertical), 'vertical');
  assert.ok(vertical[0][1] < vertical.at(-1)[1], '丨 goes top to bottom');
});

test('a 十 drawn on the screen is recognised as 十 (strokematch refs vs draw.js input)', async () => {
  const chars = ['十', '人', '一', '丨'];
  addEntries(await Promise.all(chars.map(rawEntry)));
  const canvas = { width: 300, height: 300 };
  const set = await loader.load('十');
  // Drawn as the user sees it: screen points, y DOWN.
  const drawn = set.medians.map((median) =>
    median.map(([x, y]) => ({ x: (x / 1024) * canvas.width, y: (y / 1024) * canvas.height })),
  );
  const results = match(drawn.map((stroke) => normaliseStroke(stroke, canvas)), { max: 3 });
  assert.equal(results[0].char, '十');
});
