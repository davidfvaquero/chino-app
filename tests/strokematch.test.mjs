import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  loadIndex, match, clearIndex, indexSize, resample, normalize, assign, prepare, strokeDistance,
} from '../src/extras/strokematch.js';

const BASE = fileURLToPath(new URL('../public/data/', import.meta.url)) + '/';
let fetches = [];
const fetchJson = async (path) => {
  fetches.push(path);
  return JSON.parse(await readFile(path, 'utf8'));
};

// ---- seeded randomness so the accuracy numbers are reproducible ----
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/** Fake a hand drawing from medians: re-sampled at random density, noisy, shifted, scaled, y-down. */
function synth(medians, r, { sigma = 0.02, extra = 0 } = {}) {
  const scale = 0.4 + r() * 1.6;
  const aspect = 0.9 + r() * 0.2;
  const dx = (r() - 0.5) * 600;
  const dy = (r() - 0.5) * 600;
  const SIDE = 900; // approx. char size in median units
  const strokes = medians.map((m) => {
    const k = 8 + Math.floor(r() * 18);
    const pts = resample(m, k);
    const out = [];
    for (let i = 0; i < k; i++) {
      const x = pts[2 * i] + gauss(r) * sigma * SIDE;
      const y = -pts[2 * i + 1] + gauss(r) * sigma * SIDE;
      out.push([x * scale * aspect + dx, y * scale + dy]);
    }
    return out;
  });
  if (extra) { // split one stroke in two (user lifted the pen)
    const i = Math.floor(r() * strokes.length);
    const s = strokes[i];
    if (s.length >= 4) strokes.splice(i, 1, s.slice(0, s.length >> 1), s.slice(s.length >> 1));
  }
  return strokes;
}

test('resample: n evenly spaced points, endpoints kept', () => {
  const r = resample([[0, 0], [10, 0], [10, 10]], 5);
  assert.deepEqual(r.map((v) => Math.round(v * 100) / 100), [0, 0, 5, 0, 10, 0, 10, 5, 10, 10]);
  assert.equal(resample([[3, 4]], 4).length, 8); // single point (dot) ok
});

test('normalize: translation and uniform scale invariant', () => {
  const a = normalize([[[0, 0], [10, 20]], [[5, 5], [8, 9]]]);
  const b = normalize([[[100, 50], [120, 90]], [[110, 60], [116, 68]]]);
  a.flat(2).forEach((v, i) => assert.ok(Math.abs(v - b.flat(2)[i]) < 1e-9));
});

test('assign: finds the optimal permutation', () => {
  assert.equal(assign([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), 5); // 1+2+2
  assert.equal(assign([[1]]), 1);
});

test('strokeDistance: direction matters', () => {
  const s = prepare([[[0, 0], [1, 1]], [[0, 1], [1, 0]]])[0];
  const rev = prepare([[[1, 1], [0, 0]], [[0, 1], [1, 0]]])[0];
  assert.ok(strokeDistance(s, s) < 1e-9);
  assert.ok(strokeDistance(s, rev) > 0.3);
});

test('loadIndex: only fetches shards of the requested chars, once', async () => {
  clearIndex();
  fetches = [];
  const n = await loadIndex({ chars: '一二人', base: BASE, fetchJson });
  assert.equal(n, 3);
  const shardFetches = fetches.filter((f) => f.includes('/shards/'));
  assert.ok(shardFetches.length >= 1 && shardFetches.length <= 3);
  const before = fetches.length;
  await loadIndex({ chars: '一二人', base: BASE, fetchJson });
  assert.equal(fetches.length, before); // nothing new: chars known, lookup cached
  assert.equal(indexSize(), 3);
});

test('match: empty drawing, and unknown stroke count, give no candidates', () => {
  assert.deepEqual(match([]), []);
  assert.deepEqual(match(Array(40).fill([[0, 0], [1, 1]])), []);
});

test('match: tolerates reordered strokes and a split stroke', async () => {
  clearIndex();
  await loadIndex({ levels: [1], base: BASE, fetchJson });
  const shard = JSON.parse(await readFile(`${BASE}strokes/shards/${String(await lookup('我')).padStart(3, '0')}.json`, 'utf8'));
  const medians = shard.find((e) => e.character === '我').medians;
  const r = rng(7);
  const drawn = synth(medians, r, { sigma: 0.01 });
  assert.equal(match(drawn)[0].char, '我');
  // swap two neighbouring strokes (order differs a bit)
  const swapped = drawn.slice();
  [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
  assert.ok(match(swapped, { max: 3 }).some((c) => c.char === '我'));
  // pen lifted mid-stroke: one extra stroke
  const split = synth(medians, rng(9), { sigma: 0.01, extra: 1 });
  assert.equal(split.length, drawn.length + 1);
  assert.ok(match(split, { max: 3 }).some((c) => c.char === '我'));
});

async function lookup(ch) {
  return (await fetchJson(`${BASE}strokes/index.json`)).lookup[ch];
}

test('accuracy: 100 HSK1 chars, synthetic noisy drawings, against ALL 9574 chars', async () => {
  clearIndex();
  const t0 = performance.now();
  const total = await loadIndex({ all: true, base: BASE, fetchJson });
  const loadMs = performance.now() - t0;

  // raw medians of the first 100 distinct HSK1 chars
  const hsk = JSON.parse(await readFile(`${BASE}hsk/1.json`, 'utf8'));
  const chars = [];
  for (const it of hsk.items) for (const c of it.hanzi) if (!chars.includes(c)) chars.push(c);
  const lookupMap = (await fetchJson(`${BASE}strokes/index.json`)).lookup;
  const picked = chars.filter((c) => lookupMap[c] !== undefined).slice(0, 100);
  assert.equal(picked.length, 100);
  const shards = new Map();
  const medians = {};
  for (const c of picked) {
    const id = lookupMap[c];
    if (!shards.has(id)) shards.set(id, JSON.parse(await readFile(`${BASE}strokes/shards/${String(id).padStart(3, '0')}.json`, 'utf8')));
    medians[c] = shards.get(id).find((e) => e.character === c).medians;
  }

  const r = rng(20240601);
  let top1 = 0, top5 = 0, worst = 0, sumMs = 0;
  const misses = [];
  for (const c of picked) {
    const drawing = synth(medians[c], r);
    const t = performance.now();
    const res = match(drawing, { max: 5 });
    const ms = performance.now() - t;
    sumMs += ms;
    worst = Math.max(worst, ms);
    if (res[0]?.char === c) top1++;
    if (res.some((x) => x.char === c)) top5++;
    else misses.push(`${c}->${res.map((x) => x.char).join('')}`);
  }
  console.log(
    `strokematch accuracy (pool=${total} chars, 100 HSK1 chars, sigma 2%): top1=${top1}% top5=${top5}% ` +
      `| match avg ${(sumMs / 100).toFixed(1)} ms, worst ${worst.toFixed(1)} ms | load ${loadMs.toFixed(0)} ms | top5 misses: ${misses.join(' ')}`,
  );
  assert.ok(top5 >= 85, `top-5 ${top5}% < 85%`);
  assert.ok(top1 >= 60, `top-1 ${top1}% < 60%`);
  assert.ok(worst < 150, `worst query ${worst.toFixed(0)} ms >= 150 ms`);

  // Harder variant (informational + loose floor): 5% noise and one split stroke.
  const r2 = rng(99);
  let h1 = 0, h5 = 0;
  for (const c of picked) {
    const res = match(synth(medians[c], r2, { sigma: 0.05, extra: 1 }), { max: 5 });
    if (res[0]?.char === c) h1++;
    if (res.some((x) => x.char === c)) h5++;
  }
  console.log(`strokematch hard (sigma 5% + split stroke): top1=${h1}% top5=${h5}%`);
  assert.ok(h5 >= 50, `hard top-5 ${h5}% < 50%`);
});
