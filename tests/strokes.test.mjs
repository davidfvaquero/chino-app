/**
 * Stroke order module: loader/parser + the geometry used by the practice check.
 * Browser-free on purpose — `render()` is exercised in the browser check, the
 * data path and the tolerance maths are pure and tested here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_STROKE_BASE,
  DEFAULT_TOLERANCE,
  createStrokeLoader,
  distanceToPolyline,
  isValidStrokeEntry,
  loadStrokes,
  matchStroke,
  medianToPath,
  normalizeCharacter,
  pathLengthFromMedian,
  pointToSegmentDistance,
  resamplePolyline,
  searchCharacters,
  toStrokeSet,
} from '../src/learn/strokes.js';

const DATA = new URL('../public/data/strokes/', import.meta.url);

/** fetchImpl that reads the real committed files, so the loader is tested as wired. */
const fetchFile = (url) => fs.readFile(fileURLToPath(url), 'utf8').then((text) => JSON.parse(text));
const loader = createStrokeLoader({ base: DATA, fetchImpl: fetchFile });

const rawEntry = async (character) => {
  const index = await loader.loadIndex();
  const shard = await fetchFile(new URL(index.shardFiles[index.lookup[character]], DATA).href);
  return shard.find((entry) => entry.character === character);
};

test('normalizeCharacter takes the first CJK char and survives junk', () => {
  assert.equal(normalizeCharacter('你'), '你');
  assert.equal(normalizeCharacter('  你好 '), '你');
  assert.equal(normalizeCharacter('%E4%BD%A0'), '你');
  assert.equal(normalizeCharacter('ni hao'), '');
  assert.equal(normalizeCharacter(''), '');
  assert.equal(normalizeCharacter(undefined), '');
  assert.equal(normalizeCharacter('%E4'), '');
});

test('isValidStrokeEntry / toStrokeSet reject malformed shards', () => {
  assert.equal(isValidStrokeEntry(null), false);
  assert.equal(isValidStrokeEntry({}), false);
  assert.equal(isValidStrokeEntry({ character: '你', strokes: ['M0 0'], medians: [] }), false);
  assert.equal(isValidStrokeEntry({ character: '你', strokes: ['M0 0'], medians: [[]] }), false);
  assert.equal(isValidStrokeEntry({ character: '你', strokes: ['M0 0', 'M1 1'], medians: [[[0, 0]]] }), false); // length mismatch
  assert.equal(isValidStrokeEntry({ character: '你', strokes: ['   '], medians: [[[0, 0]]] }), false);
  assert.equal(isValidStrokeEntry({ character: '你', strokes: ['M0 0'], medians: [[[0, 'x']]] }), false);
  assert.equal(isValidStrokeEntry({ character: '', strokes: ['M0 0'], medians: [[[0, 0]]] }), false);
  assert.equal(toStrokeSet({ character: '你', strokes: [1], medians: [[[0, 0]]] }), null);
  assert.equal(toStrokeSet(undefined), null);
});

test('toStrokeSet copies a valid entry without sharing arrays', () => {
  const entry = { character: ' 你 ', strokes: ['M0 0'], medians: [[[1, 2], [3, 4]]] };
  const set = toStrokeSet(entry);
  // medians are flipped to screen space: y' = 900 - y
  assert.deepEqual(set, { character: '你', strokes: ['M0 0'], medians: [[[1, 898], [3, 896]]] });
  entry.medians[0][0][0] = 999;
  assert.equal(set.medians[0][0][0], 1);
});

test('loader reads the real dataset: 你 has 7 strokes and 7 medians', async () => {
  const set = await loader.load('你');
  assert.equal(set.character, '你');
  assert.equal(set.strokes.length, 7);
  assert.equal(set.medians.length, 7);
  assert.match(set.strokes[0], /^M\s/);
  for (const median of set.medians) {
    assert.ok(median.length >= 2, 'median has at least two points');
    for (const [x, y] of median) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(x >= -200 && x <= 1224 && y >= -200 && y <= 1224, `point ${x},${y} inside the box`);
    }
  }
});

test('loader: unknown / non-hanzi / percent-encoded input', async () => {
  assert.equal(await loader.load('龘'), null, 'character missing from the dataset -> null');
  assert.equal(await loader.load('abc'), null);
  assert.equal(await loader.load(''), null);
  assert.equal((await loader.load('%E4%BD%A0')).character, '你');
  assert.equal((await loader.load(' 你 ')).character, '你');
});

test('loader index exposes lookup + shard files for the whole dataset', async () => {
  const index = await loader.loadIndex();
  assert.equal(Object.keys(index.lookup).length, index.characters);
  assert.equal(index.shardFiles.length, index.shards);
  assert.equal(index.lookup['你'], 2);
});

test('loader caches: one fetch per URL even when asked twice', async () => {
  const seen = [];
  const counting = createStrokeLoader({
    base: DATA,
    fetchImpl: (url) => {
      seen.push(url);
      return fetchFile(url);
    },
  });
  await counting.load('你');
  await counting.load('你');
  await counting.load('一');
  assert.equal(seen.filter((url) => url.endsWith('index.json')).length, 1);
  assert.equal(new Set(seen).size, seen.length);
});

test('the default loader is wired to the runtime data path', () => {
  // The browser serves the shards at /data/strokes/ (public/ is copied to the
  // site root); the real end-to-end fetch of this default loader is checked in
  // the headless browser run, not here.
  assert.ok(DEFAULT_STROKE_BASE.pathname.endsWith('/data/strokes/'), DEFAULT_STROKE_BASE.href);
  assert.equal(typeof loadStrokes, 'function');
});

test('searchCharacters finds by prefix and honours the limit', async () => {
  const index = await loader.loadIndex();
  const hits = searchCharacters('你', index.lookup);
  assert.equal(hits[0], '你', 'the exact character comes first');
  assert.ok(hits.length <= 12);
  const limited = searchCharacters('你', index.lookup, { limit: 3 });
  assert.ok(limited.length <= 3);
  assert.equal(limited[0], '你');
  assert.deepEqual(searchCharacters('', index.lookup), []);
  assert.deepEqual(searchCharacters(null, index.lookup), []);
  assert.deepEqual(searchCharacters('你', null), []);
});

test('medianToPath / pathLengthFromMedian', () => {
  assert.equal(medianToPath([[0, 0], [10, 0], [10, 10]]), 'M 0 0 L 10 0 L 10 10');
  assert.equal(medianToPath([]), '');
  assert.equal(pathLengthFromMedian([[0, 0], [10, 0], [10, 10]]), 20);
  assert.equal(pathLengthFromMedian([[5, 5]]), 0);
  assert.equal(pathLengthFromMedian(null), 0);
});

test('pointToSegmentDistance projects onto the segment', () => {
  assert.equal(pointToSegmentDistance([5, 5], [0, 0], [10, 0]), 5);
  assert.equal(pointToSegmentDistance([5, 0], [0, 0], [10, 0]), 0);
  assert.equal(pointToSegmentDistance([-5, 0], [0, 0], [10, 0]), 5); // clamps to the start
  assert.equal(pointToSegmentDistance([3, 4], [0, 0], [0, 0]), 5);
});

test('distanceToPolyline', () => {
  const line = [[0, 0], [10, 0], [10, 10]];
  assert.equal(distanceToPolyline([5, 2], line), 2);
  assert.equal(distanceToPolyline([10, 10], line), 0);
  assert.equal(distanceToPolyline([0, 0], []), Infinity);
  assert.equal(distanceToPolyline(null, line), Infinity);
});

test('resamplePolyline spreads points evenly by arc length', () => {
  const line = [[0, 0], [10, 0], [10, 10]];
  const points = resamplePolyline(line, 5);
  assert.equal(points.length, 5);
  assert.deepEqual(points[0], [0, 0]);
  assert.deepEqual(points[4], [10, 10]);
  assert.ok(Math.abs(points[2][1]) < 1e-9, 'midpoint sits at the corner');
  const gaps = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1]));
  for (const gap of gaps) assert.ok(Math.abs(gap - 5) < 1e-6, `gap ${gap}`);
  assert.deepEqual(resamplePolyline([[1, 2]], 4), [[1, 2]]);
  assert.deepEqual(resamplePolyline([], 4), []);
  assert.deepEqual(resamplePolyline(line, 1), [[0, 0]]);
});

test('matchStroke accepts the real median and is tolerant to sloppy tracing', async () => {
  const set = await loader.load('你');
  const median = set.medians[0];

  const exact = matchStroke(median, median);
  assert.equal(exact.ok, true);
  assert.equal(exact.score, 1);

  const reversed = matchStroke([...median].reverse(), median);
  assert.equal(reversed.ok, false, 'strokes must be traced in order');

  const shifted = median.map(([x, y]) => [x + 40, y + 30]);
  const shiftedResult = matchStroke(shifted, median);
  assert.equal(shiftedResult.ok, true, 'a sloppy trace is forgiven');
  assert.equal(shiftedResult.ordered, true);

  const far = median.map(([x, y]) => [x + 400, y]);
  assert.equal(matchStroke(far, median).ok, false);

  const half = resamplePolyline(median, 24).slice(0, 12);
  assert.equal(matchStroke(half, median).ok, false, 'half the stroke does not count');

  assert.equal(matchStroke([[10, 10]], median).ok, false, 'needs at least two points');
  assert.equal(matchStroke([], median).ok, false);
  assert.equal(matchStroke(median, []).ok, false);
  assert.equal(DEFAULT_TOLERANCE > 0, true);
});

test('matchStroke on every stroke of 你 with the median itself', async () => {
  const set = await loader.load('你');
  set.medians.forEach((median, index) => {
    const result = matchStroke(median, median);
    assert.equal(result.ok, true, `stroke ${index}`);
    assert.ok(result.coverage === 1);
  });
});

test('every entry of the committed dataset normalises through toStrokeSet', async () => {
  const index = await loader.loadIndex();
  let entries = 0;
  for (const file of index.shardFiles) {
    const shard = await fetchFile(new URL(file, DATA).href);
    assert.ok(Array.isArray(shard), `${file} is an array`);
    for (const entry of shard) {
      const set = toStrokeSet(entry);
      assert.ok(set, `${entry?.character} in ${file} normalises`);
      assert.equal(set.strokes.length, set.medians.length);
      entries += 1;
    }
  }
  assert.equal(entries, index.characters);
});
