/**
 * strokematch — recognise a hand-drawn character from its strokes. No UI.
 *
 * Reference data: Make Me a Hanzi medians (public/data/strokes). Each median
 * is a polyline in a 1024 em box with y UP; drawings come in screen coords
 * (y DOWN) so medians are flipped on load.
 *
 *   await loadIndex({ levels: [1] });          // which chars to know
 *   match(strokes, { max: 10 })                // strokes = [[[x,y],...], ...]
 *     -> [{ char, score, distance }]           // best first, score 0..1
 *
 * Algorithm: bbox-normalise (aspect kept) -> resample every stroke to N
 * points -> prefilter reference chars by stroke count (±1) -> per candidate,
 * stroke-vs-stroke cost matrix (mean point distance + endpoint terms, so
 * direction counts) -> Hungarian assignment with a small stroke-order
 * penalty and a fixed price for one unmatched stroke.
 */

export const N_POINTS = 16;
/** Price of one unmatched stroke (drawn extra / reference missing). */
const UNMATCHED = 0.3;
/** Penalty per unit of stroke-order displacement (|i-j| / strokes). */
const ORDER_WEIGHT = 0.05;
/** Weight of the start/end point terms. */
const ENDS_WEIGHT = 0.25;
/** Candidates that survive the cheap pass and get the full assignment. */
const SHORTLIST = 60;
/** Stroke-count tolerance in the prefilter. */
const COUNT_SLACK = 1;

/** Data root resolved from this module: src/extras/ -> <site>/data/. */
export const DATA_BASE = new URL('../../data/', import.meta.url).href;

// ---------- geometry (pure) ----------

/** Resample a polyline to n points evenly spaced by arc length -> flat [x0,y0,x1,y1,...]. */
export function resample(points, n = N_POINTS) {
  const out = new Array(n * 2);
  const m = points.length;
  if (m === 0) return out.fill(0);
  const cum = [0];
  for (let i = 1; i < m; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  const total = cum[m - 1];
  let seg = 1;
  for (let k = 0; k < n; k++) {
    if (m === 1 || total === 0) {
      out[2 * k] = points[0][0];
      out[2 * k + 1] = points[0][1];
      continue;
    }
    const d = (total * k) / (n - 1);
    while (seg < m - 1 && cum[seg] < d) seg++;
    const span = cum[seg] - cum[seg - 1];
    const f = span > 0 ? (d - cum[seg - 1]) / span : 0;
    out[2 * k] = points[seg - 1][0] + (points[seg][0] - points[seg - 1][0]) * f;
    out[2 * k + 1] = points[seg - 1][1] + (points[seg][1] - points[seg - 1][1]) * f;
  }
  return out;
}

/** Fit all strokes in a 1x1 box (longest side = 1, aspect kept, centred). */
export function normalize(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    for (const [x, y] of s) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const side = Math.max(x1 - x0, y1 - y0) || 1;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return strokes.map((s) => s.map(([x, y]) => [(x - cx) / side + 0.5, (y - cy) / side + 0.5]));
}

/** strokes -> array of resampled flat point arrays, normalised. */
export function prepare(strokes) {
  return normalize(strokes.filter((s) => s.length > 0)).map((s) => resample(s));
}

/** Cost between two resampled strokes: mean point distance + endpoint terms. */
export function strokeDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 2) sum += Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]);
  const mean = sum / (a.length / 2);
  const last = a.length - 2;
  const ends = Math.hypot(a[0] - b[0], a[1] - b[1]) + Math.hypot(a[last] - b[last], a[last + 1] - b[last + 1]);
  return mean + (ENDS_WEIGHT * ends) / 2;
}

/** Hungarian algorithm, square matrix (e-maxx potentials). Returns total min cost. */
export function assign(cost) {
  const n = cost.length;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  let total = 0;
  for (let j = 1; j <= n; j++) total += cost[p[j] - 1][j - 1];
  return total;
}

/** 4 points of a resampled stroke (start, 1/3, 2/3, end) for the cheap prefilter. */
function coarsen(s) {
  const q = (s.length / 2 - 1) / 3;
  const out = [];
  for (let k = 0; k < 4; k++) {
    const i = Math.round(q * k) * 2;
    out.push(s[i], s[i + 1]);
  }
  return out;
}

/** Cheap one-to-many distance: each stroke to its nearest stroke on the other side, both ways. */
function proxyDistance(a, b) {
  let total = 0;
  for (const [xs, ys] of [[a, b], [b, a]]) {
    for (const s of xs) {
      let best = Infinity;
      for (const t of ys) {
        const d =
          Math.abs(s[0] - t[0]) + Math.abs(s[1] - t[1]) + Math.abs(s[2] - t[2]) + Math.abs(s[3] - t[3]) +
          Math.abs(s[4] - t[4]) + Math.abs(s[5] - t[5]) + Math.abs(s[6] - t[6]) + Math.abs(s[7] - t[7]);
        if (d < best) best = d;
      }
      total += best;
    }
  }
  return total / (a.length + b.length);
}

/** Distance between a prepared drawing and a prepared reference (lower = closer). */
export function charDistance(drawn, ref) {
  const n = drawn.length;
  const m = ref.length;
  const k = Math.max(n, m);
  const cost = [];
  for (let i = 0; i < k; i++) {
    const row = new Array(k);
    for (let j = 0; j < k; j++) {
      row[j] =
        i < n && j < m
          ? strokeDistance(drawn[i], ref[j]) + (ORDER_WEIGHT * Math.abs(i - j)) / k
          : UNMATCHED;
    }
    cost.push(row);
  }
  return assign(cost) / k;
}

// ---------- index ----------

/** stroke count -> [{ char, strokes: prepared }]. */
const byCount = new Map();
const known = new Set();
/** shard id -> Promise<array>, so concurrent loads share one fetch. */
const shardCache = new Map();
let strokesLookup = null;

/** Add reference entries ({ character, medians } as in the data shards). */
export function addEntries(entries) {
  for (const e of entries) {
    if (known.has(e.character) || !e.medians || !e.medians.length) continue;
    known.add(e.character);
    const strokes = prepare(e.medians.map((m) => m.map(([x, y]) => [x, -y])));
    const n = strokes.length;
    if (!byCount.has(n)) byCount.set(n, []);
    byCount.get(n).push({ char: e.character, strokes, coarse: strokes.map(coarsen) });
  }
}

/** Drop everything loaded (tests). */
export function clearIndex() {
  byCount.clear();
  known.clear();
  shardCache.clear();
  strokesLookup = null;
}

export function indexSize() {
  return known.size;
}

async function defaultFetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`strokematch: ${url} -> ${res.status}`);
  return res.json();
}

/**
 * Load reference chars. Which ones: `chars` (string or array), else HSK
 * `levels` (default [1]), or `all: true` (every char, ~30 MB — desktop/tests).
 * Only the stroke shards holding those chars are fetched, once each.
 * `fetchJson(url)` and `base` are injectable (tests run on node + fs).
 * Resolves to the number of chars indexed.
 */
export async function loadIndex({ chars, levels = [1], all = false, base = DATA_BASE, fetchJson = defaultFetchJson } = {}) {
  if (!strokesLookup) strokesLookup = (await fetchJson(`${base}strokes/index.json`)).lookup;
  let wanted;
  if (all) {
    wanted = Object.keys(strokesLookup);
  } else if (chars) {
    wanted = [...chars];
  } else {
    wanted = [];
    for (const lv of levels) {
      const list = await fetchJson(`${base}hsk/${lv}.json`);
      for (const item of list.items) wanted.push(...item.hanzi);
    }
  }
  const shards = new Set();
  for (const c of wanted) {
    if (!known.has(c) && strokesLookup[c] !== undefined) shards.add(strokesLookup[c]);
  }
  // A shard also holds unrequested neighbours: index only the requested chars.
  const set = new Set(wanted);
  await Promise.all(
    [...shards].map(async (id) => {
      if (!shardCache.has(id)) {
        const name = String(id).padStart(3, '0');
        // Keep medians only: the SVG outlines are most of the payload.
        shardCache.set(
          id,
          fetchJson(`${base}strokes/shards/${name}.json`).then((list) =>
            list.map(({ character, medians }) => ({ character, medians })),
          ),
        );
      }
      const entries = await shardCache.get(id);
      addEntries(entries.filter((e) => set.has(e.character)));
    }),
  );
  return known.size;
}

// ---------- match ----------

/**
 * Rank indexed chars for a drawing.
 * @param {number[][][]} strokes  drawn strokes, each a list of [x,y] (screen coords, any scale)
 * @param {{max?: number}} opts
 * @returns {{char: string, score: number, distance: number}[]} best first; score in (0,1]
 */
export function match(strokes, { max = 10 } = {}) {
  const drawn = prepare(strokes);
  if (!drawn.length) return [];
  const coarse = drawn.map(coarsen);
  const cands = [];
  for (let c = drawn.length - COUNT_SLACK; c <= drawn.length + COUNT_SLACK; c++) {
    for (const ref of byCount.get(c) || []) {
      cands.push({ ref, proxy: proxyDistance(coarse, ref.coarse) });
    }
  }
  // Cheap pass over everything, expensive assignment only on the best few.
  cands.sort((a, b) => a.proxy - b.proxy);
  const out = cands
    .slice(0, Math.max(SHORTLIST, max))
    .map(({ ref }) => ({ char: ref.char, distance: charDistance(drawn, ref.strokes) }));
  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, max).map((r) => ({ char: r.char, distance: r.distance, score: Math.exp(-6 * r.distance) }));
}
