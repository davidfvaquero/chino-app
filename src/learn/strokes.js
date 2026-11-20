/**
 * Stroke order — `#/learn/strokes` (character search) and
 * `#/learn/strokes/<hanzi>` (stroke-by-stroke animation + tracing practice).
 *
 * Own SVG renderer, zero dependencies. Drawings come from `public/data/strokes/`
 * (Make Me a Hanzi — see CREDITS.md): `index.json` maps a character to a shard
 * file, and each entry is `{ character, strokes: [svgPath], medians: [[[x, y]]] }`
 * in a 1024 box with y UP (baseline at y=900). `toStrokeSet` flips the medians
 * to screen space (y DOWN); outline paths get `OUTLINE_FLIP` in every SVG.
 *
 * Screen contract: `titleKey` + `render(container, ctx)` (returns a cleanup fn).
 *
 * Pure, browser-free helpers (covered by tests/strokes.test.mjs):
 *   toStrokeSet(entry)                    -> {character, strokes, medians} | null
 *   isValidStrokeEntry(entry)             -> boolean
 *   medianToPath(median)                  -> 'M x y L x y ...'
 *   pathLengthFromMedian(median)          -> number
 *   pointToSegmentDistance(p, a, b)       -> number
 *   distanceToPolyline(point, polyline)   -> number
 *   resamplePolyline(polyline, count)     -> [[x, y], ...]
 *   matchStroke(drawn, median, opts)      -> {ok, score, coverage, startDistance, endDistance, ordered}
 *   searchCharacters(query, lookup, opts) -> string[]
 *   createStrokeLoader({base, fetchImpl}) -> {loadIndex(), load(char), search(query)}
 *   loadStrokeIndex() / loadStrokes(char) -> default loader (DEFAULT_STROKE_BASE,
 *                                            i.e. `/data/strokes/` at runtime)
 *
 * Wiring with the rest of the app (only these three imports):
 *   - review: `addToReview({hanzi, source: 'strokes'})` (src/srs.js), idempotent.
 *   - audio: `speak(character, {lang: 'zh-CN'})` (src/audio.js), never throws.
 *   - `window` event `chino:stroke_done`, `detail: {character, strokes, mode}`,
 *     fired once per tracing practice completed stroke by stroke.
 *   - The screen element exposes `element.strokesApi`
 *     `{play, pause, replay, setPractice, traceStroke(points), state()}` so a
 *     headless test can drive the animation and the practice without pointers.
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { speak } from '../audio.js';
import { addToReview } from '../srs.js';
import { renderEtymology } from '../etymology.js';

export const titleKey = 'hubs.learn.strokes';

/** Side of the square viewBox the stroke data lives in. */
export const VIEW_BOX_SIZE = 1024;
/** Make Me a Hanzi baseline: the data is y UP, screen is y DOWN. */
const BASELINE_Y = 900;
/** Same flip as hanzi-writer; applied to every outline path (medians are flipped in `toStrokeSet`). */
export const OUTLINE_FLIP = `scale(1,-1) translate(0,-${BASELINE_Y})`;
/** Practice tolerance in viewBox units (~12% of the box) — deliberately loose. */
export const DEFAULT_TOLERANCE = 120;
/** Fraction of the median the drawing must cover to count as the right stroke. */
export const MIN_COVERAGE = 0.6;
const CHILD_TOLERANCE = 1.5; // start/end may be sloppier than the middle
const SAMPLE_COUNT = 24;
const MIN_DRAWN_POINTS = 2;
const SHARD_PAD = 3;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Where the browser build serves the stroke shards from (next to `src/`). */
export const DEFAULT_STROKE_BASE = new URL('../../data/strokes/', import.meta.url);

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const isPoint = (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
const round1 = (value) => Math.round(value * 10) / 10;

/** First CJK character of a route segment / search box, decoded or not. */
export function normalizeCharacter(value) {
  if (value === undefined || value === null) return '';
  let text = String(value).trim();
  if (!text) return '';
  try {
    text = decodeURIComponent(text);
  } catch {
    /* malformed escape: use the raw text */
  }
  const match = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u);
  return match ? match[0] : '';
}

/** Every CJK character of a route segment / search box, in order. */
export function hanziCharacters(value) {
  if (value === undefined || value === null) return [];
  return String(value).match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu) || [];
}

export function isValidStrokeEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.character !== 'string' || entry.character.trim() === '') return false;
  const { strokes, medians } = entry;
  if (!Array.isArray(strokes) || !Array.isArray(medians)) return false;
  if (strokes.length === 0 || strokes.length !== medians.length) return false;
  if (!strokes.every((path) => typeof path === 'string' && path.trim() !== '')) return false;
  return medians.every((median) => Array.isArray(median) && median.length > 0 && median.every(isPoint));
}

/** Normalises a raw shard entry; returns null when it is not usable. Medians come out in screen space (y DOWN). */
export function toStrokeSet(entry) {
  if (!isValidStrokeEntry(entry)) return null;
  return {
    character: entry.character.trim(),
    strokes: entry.strokes.slice(),
    medians: entry.medians.map((median) => median.map((point) => [point[0], BASELINE_Y - point[1]])),
  };
}

/** Polyline through the stroke median, as an SVG path (the animated pen line). */
export function medianToPath(median) {
  const points = (Array.isArray(median) ? median : []).filter(isPoint);
  if (!points.length) return '';
  const [first, ...rest] = points;
  return `M ${round1(first[0])} ${round1(first[1])}${rest
    .map((point) => ` L ${round1(point[0])} ${round1(point[1])}`)
    .join('')}`;
}

/** Length of the median polyline (also the animation fallback when the DOM cannot measure). */
export function pathLengthFromMedian(median) {
  const points = (Array.isArray(median) ? median : []).filter(isPoint);
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
  }
  return total;
}

export function pointToSegmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const ratio = clamp01(((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared);
  return Math.hypot(point[0] - (start[0] + ratio * dx), point[1] - (start[1] + ratio * dy));
}

/** Shortest distance from a point to a polyline (Infinity for an empty one). */
export function distanceToPolyline(point, polyline) {
  const points = (Array.isArray(polyline) ? polyline : []).filter(isPoint);
  if (!isPoint(point) || !points.length) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return Math.hypot(point[0] - points[0][0], point[1] - points[0][1]);
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    best = Math.min(best, pointToSegmentDistance(point, points[index - 1], points[index]));
  }
  return best;
}

/** `count` points spread evenly along the polyline by arc length. */
export function resamplePolyline(polyline, count = SAMPLE_COUNT) {
  const points = (Array.isArray(polyline) ? polyline : []).filter(isPoint);
  if (!points.length) return [];
  if (points.length === 1 || count < 2) return [[points[0][0], points[0][1]]];
  const total = pathLengthFromMedian(points);
  if (total === 0) return Array.from({ length: count }, () => [points[0][0], points[0][1]]);

  const step = total / (count - 1);
  const out = [[points[0][0], points[0][1]]];
  let segment = 1;
  let walked = 0;
  let target = 1;
  while (target < count && segment < points.length) {
    const from = points[segment - 1];
    const to = points[segment];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length === 0) {
      segment += 1;
      continue;
    }
    if (walked + length >= target * step) {
      const ratio = (target * step - walked) / length;
      out.push([from[0] + ratio * (to[0] - from[0]), from[1] + ratio * (to[1] - from[1])]);
      target += 1;
    } else {
      walked += length;
      segment += 1;
    }
  }
  while (out.length < count) out.push([points[points.length - 1][0], points[points.length - 1][1]]);
  return out;
}

/**
 * Tolerant check that a drawn polyline is the given stroke: the median must be
 * covered by the drawing, which has to start near the median's start and end
 * near its end (a stroke drawn backwards does not count — order matters here).
 */
export function matchStroke(drawn, median, { tolerance = DEFAULT_TOLERANCE, minCoverage = MIN_COVERAGE } = {}) {
  const drawnPoints = (Array.isArray(drawn) ? drawn : []).filter(isPoint);
  const medianPoints = (Array.isArray(median) ? median : []).filter(isPoint);
  const empty = { ok: false, score: 0, coverage: 0, startDistance: Infinity, endDistance: Infinity };
  if (medianPoints.length < 1 || drawnPoints.length < MIN_DRAWN_POINTS) return empty;

  const samples = resamplePolyline(medianPoints, SAMPLE_COUNT);
  const covered = samples.filter((sample) => distanceToPolyline(sample, drawnPoints) <= tolerance).length;
  const coverage = covered / samples.length;
  const first = drawnPoints[0];
  const last = drawnPoints[drawnPoints.length - 1];
  const medianStart = medianPoints[0];
  const medianEnd = medianPoints[medianPoints.length - 1];
  const startDistance = distanceToPolyline(first, medianPoints);
  const endDistance = distanceToPolyline(last, medianPoints);
  const reach = tolerance * CHILD_TOLERANCE;
  // Direction: the drawing must begin nearer the median's start than its end
  // (and vice versa) — a reversed stroke fails, sloppy but ordered ones pass.
  const ordered =
    pointDistance(first, medianStart) <= pointDistance(first, medianEnd) &&
    pointDistance(last, medianEnd) <= pointDistance(last, medianStart);
  const ok = coverage >= minCoverage && startDistance <= reach && endDistance <= reach && ordered;

  return { ok, score: Math.round(coverage * 100) / 100, coverage, startDistance, endDistance, ordered };
}

const pointDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Characters of `lookup` matching `query` (exact hit first). Dataset keys only. */
export function searchCharacters(query, lookup, { limit = 12 } = {}) {
  const text = String(query ?? '').trim();
  if (!text || !lookup || typeof lookup !== 'object') return [];
  const keys = Object.keys(lookup);
  const exact = keys.filter((key) => key === text);
  const rest = keys.filter((key) => key !== text && key.includes(text));
  return exact.concat(rest).slice(0, limit);
}

/** Loader for `public/data/strokes/` (index + one shard per character). */
export function createStrokeLoader({ base = DEFAULT_STROKE_BASE, fetchImpl } = {}) {
  const root = toBaseUrl(base);
  const cache = new Map();

  const fetchJson = async (url) => {
    if (cache.has(url)) return cache.get(url);
    const pending = (async () => {
      if (fetchImpl) return fetchImpl(url);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`strokes: HTTP ${response.status} for ${url}`);
      return response.json();
    })();
    cache.set(url, pending);
    try {
      return await pending;
    } catch (error) {
      cache.delete(url);
      throw error;
    }
  };

  const loadIndex = () => fetchJson(new URL('index.json', root).href);

  const load = async (character) => {
    const char = normalizeCharacter(character);
    if (!char) return null;
    const index = await loadIndex();
    const shardId = index?.lookup?.[char];
    if (shardId === undefined || shardId === null) return null;
    const file = index.shardFiles?.[shardId] ?? `shards/${String(shardId).padStart(SHARD_PAD, '0')}.json`;
    const shard = await fetchJson(new URL(file, root).href);
    const raw = Array.isArray(shard) ? shard.find((entry) => entry?.character === char) : shard?.[char];
    return toStrokeSet(raw);
  };

  const search = async (query, options) => {
    const index = await loadIndex();
    return searchCharacters(query, index?.lookup ?? {}, options);
  };

  return { loadIndex, load, search };
}

const defaultLoader = createStrokeLoader();

/** Index of the whole stroke dataset (`{lookup, shardFiles, ...}`). */
export const loadStrokeIndex = () => defaultLoader.loadIndex();
/** Stroke set of one character, or null when the dataset has none. */
export const loadStrokes = (character) => defaultLoader.load(character);

function toBaseUrl(base) {
  if (base instanceof URL) return base;
  const text = String(base ?? DEFAULT_STROKE_BASE.href);
  try {
    return new URL(text);
  } catch {
    return new URL(text.endsWith('/') ? text : `${text}/`, DEFAULT_STROKE_BASE);
  }
}

/* ------------------------------------------------------------------ *
 * Screen: search box + animated character + tracing practice
 * ------------------------------------------------------------------ */

const STYLE_ID = 'strokes-style';
const STROKE_WIDTH = 46;
const PEN_WIDTH = 34;
const ANIM_PER_STROKE_MS = 420;
const TICK_MS = 16;
const MOVE_MIN_DISTANCE = 5;
const SEARCH_DEBOUNCE_MS = 150;
const WRONG_FLASH_MS = 600;

const CSS = `
.strokes { display: flex; flex-direction: column; gap: 0.75rem; }
.strokes [hidden] { display: none !important; }
.strokes-search { display: flex; gap: 0.5rem; align-items: center; }
.strokes-search input { flex: 1; min-width: 0; padding: 0.6rem 0.7rem; font-size: 1.05rem; min-height: 48px; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: var(--ink); }
.strokes-search .strokes-go { min-height: 44px; padding: 0.6rem 1rem; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: var(--ink); font-size: var(--fs-base); }
.strokes-results { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0; padding: 0; list-style: none; }
.strokes-results button { font-size: 1.4rem; line-height: 1; min-height: 44px; padding: 0.35rem 0.55rem; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: var(--ink); }
.strokes-board { position: relative; width: 100%; max-width: 22rem; margin: 0 auto; }
.strokes-svg { display: block; width: 100%; aspect-ratio: 1 / 1; touch-action: none; border-radius: 0.75rem; background: var(--surface); }
.strokes-guide { stroke: var(--edge); stroke-width: 2; fill: none; }
.strokes-ghost { fill: var(--ink-soft); opacity: 0.7; }
.strokes-ink { fill: none; stroke: var(--ink); stroke-width: ${STROKE_WIDTH}; stroke-linecap: round; stroke-linejoin: round; }
.strokes-trace-guide { fill: none; stroke: var(--accent); stroke-width: 10; stroke-linecap: round; stroke-dasharray: 18 22; opacity: 0.8; }
.strokes-trace-guide[data-current="true"] { opacity: 1; stroke-width: 14; }
.strokes-trace-done { fill: var(--ink); opacity: 0.85; }
.strokes-trace-drawn { fill: none; stroke: var(--tone3); stroke-width: ${PEN_WIDTH}; stroke-linecap: round; stroke-linejoin: round; }
.strokes-trace-drawn[data-result="wrong"] { stroke: var(--danger); }
.strokes-progress { margin: 0; text-align: center; font-variant-numeric: tabular-nums; opacity: 0.8; }
.strokes-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; }
.strokes-actions button { min-height: 44px; padding: 0.55rem 0.8rem; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: var(--ink); font-size: 0.95rem; }
.strokes-actions button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
.strokes-hint, .strokes-empty { margin: 0; text-align: center; min-height: 1.2em; }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child) node.append(child);
  return node;
}

/**
 * SVG diagram of `upTo` strokes of a set, the last one accented. Shared with
 * the multi-character sheet (src/learn/strokes-sheet.js) so the drawing lives
 * in one place.
 */
export function strokeDiagramSvg(set, { upTo = set?.strokes?.length ?? 0, accent = upTo - 1 } = {}) {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}`,
    preserveAspectRatio: 'xMidYMid meet',
    'aria-hidden': 'true',
  });
  (set?.strokes ?? []).slice(0, upTo).forEach((path, index) => {
    svg.append(
      svgEl('path', {
        class: index === accent ? 'stroke-part stroke-part-new' : 'stroke-part',
        d: path,
        transform: OUTLINE_FLIP,
        'data-index': index,
      }),
    );
  });
  return svg;
}

/**
 * Tiny reusable stroke-by-stroke animation (median pen lines). Returns the SVG
 * plus play/pause/toggle/stop so a host screen only wires buttons.
 */
export function createStrokeAnimation(set, { perStrokeMs = ANIM_PER_STROKE_MS, tickMs = TICK_MS } = {}) {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}`,
    preserveAspectRatio: 'xMidYMid meet',
    'aria-hidden': 'true',
  });
  const inks = (set?.medians ?? []).map((median, index) =>
    svgEl('path', {
      class: 'stroke-pen',
      d: medianToPath(median),
      'data-index': index,
      style: 'stroke-dasharray:1;stroke-dashoffset:1',
    }),
  );
  inks.forEach((ink) => svg.append(ink));

  let state = 'idle';
  let timer = null;
  let lastTick = 0;
  let elapsed = 0;

  const paint = (index, progress) => {
    const ink = inks[index];
    if (!ink) return;
    const length = Math.max(1, pathLengthFromMedian(set.medians[index]));
    ink.style.strokeDasharray = String(length);
    ink.style.strokeDashoffset = String(length * (1 - clamp01(progress)));
  };

  const stop = () => {
    clearTimeout(timer);
    timer = null;
  };

  function tick() {
    if (state !== 'playing') return;
    if (!inks.length) {
      state = 'done';
      return;
    }
    const now = Date.now();
    elapsed += (now - lastTick) / perStrokeMs;
    lastTick = now;
    if (elapsed >= inks.length) {
      inks.forEach((_, index) => paint(index, 1));
      stop();
      state = 'done';
      return;
    }
    const done = Math.floor(elapsed);
    for (let index = 0; index < done; index += 1) paint(index, 1);
    paint(done, elapsed - done);
    timer = setTimeout(tick, tickMs);
  }

  const play = () => {
    stop();
    if (!inks.length) return;
    elapsed = 0;
    lastTick = Date.now();
    inks.forEach((_, index) => paint(index, 0));
    state = 'playing';
    tick();
  };

  const pause = () => {
    if (state !== 'playing') return;
    stop();
    state = 'paused';
  };

  const toggle = () => {
    if (state === 'playing') pause();
    else if (state === 'paused') {
      state = 'playing';
      lastTick = Date.now();
      tick();
    } else play();
  };

  return {
    svg,
    play,
    pause,
    toggle,
    stop: () => {
      stop();
      state = 'idle';
    },
    state: () => state,
  };
}

/** Wires the whole screen into `container`; resolves once the character is loaded. */
export async function render(container, ctx = {}) {
  const characters = hanziCharacters(ctx?.route?.segments?.[1]);
  if (characters.length > 1) {
    const sheet = await import('./strokes-sheet.js');
    return sheet.render(container, ctx);
  }
  const app = createStrokeApp(container, ctx);
  const character = characters[0] ?? '';
  if (character) await app.show(character);
  else app.showSearch();
  // One-liner hook (MNEMO task): mnemonic hint under the board, single-char view.
  renderEtymology(character).then((box) => { const board = container.querySelector('.strokes-board'); if (box && board) board.after(box); }).catch(() => {});
  return () => app.destroy();
}

function createStrokeApp(container, ctx) {
  ensureStyles(document);

  const input = h('input', {
    type: 'search',
    class: 'strokes-input',
    name: 'character',
    autocomplete: 'off',
    'aria-label': t('strokes.searchLabel'),
    placeholder: t('strokes.searchPlaceholder'),
  });
  const results = h('ul', { class: 'strokes-results', 'aria-label': t('strokes.searchResults') });
  const form = h(
    'form',
    { class: 'strokes-search', onsubmit: onSubmit },
    input,
    h('button', { type: 'submit', class: 'strokes-go', text: t('strokes.searchButton') }),
  );

  const guides = svgEl(
    'g',
    { class: 'strokes-guides' },
    svgEl('line', { class: 'strokes-guide', x1: 0, y1: 512, x2: 1024, y2: 512 }),
    svgEl('line', { class: 'strokes-guide', x1: 512, y1: 0, x2: 512, y2: 1024 }),
  );
  const ghostLayer = svgEl('g', { class: 'strokes-ghosts' });
  const inkLayer = svgEl('g', { class: 'strokes-inks' });
  const traceGuideLayer = svgEl('g', { class: 'strokes-trace-guides' });
  const traceDoneLayer = svgEl('g', { class: 'strokes-trace-done-layer' });
  const traceDrawnLayer = svgEl('g', { class: 'strokes-trace-drawn-layer' });
  const svg = svgEl(
    'svg',
    {
      class: 'strokes-svg',
      viewBox: `0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}`,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': t('strokes.boardLabel'),
    },
    guides,
    ghostLayer,
    inkLayer,
    traceGuideLayer,
    traceDoneLayer,
    traceDrawnLayer,
  );
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);

  const progress = h('p', { class: 'strokes-progress' });
  const hint = h('p', { class: 'strokes-hint' });
  const empty = h('p', { class: 'strokes-empty', hidden: true });

  const playPauseBtn = h('button', { type: 'button', class: 'strokes-play', text: t('strokes.pause'), onclick: togglePlay });
  const replayBtn = h('button', { type: 'button', class: 'strokes-replay', text: t('strokes.replay'), onclick: () => start() });
  const practiceBtn = h('button', {
    type: 'button',
    class: 'strokes-practice-btn',
    text: t('strokes.practice'),
    onclick: () => setPractice(!state.practice),
  });
  const speakBtn = h('button', { type: 'button', class: 'strokes-speak', text: t('strokes.speak'), onclick: onSpeak });
  const reviewBtn = h('button', { type: 'button', class: 'strokes-review', text: t('strokes.addToReview'), onclick: onAddToReview });

  const actions = h('div', { class: 'strokes-actions' }, playPauseBtn, replayBtn, practiceBtn, speakBtn, reviewBtn);
  const board = h('div', { class: 'strokes-board' }, svg);
  const section = h('section', { class: 'strokes' }, form, results, empty, board, progress, actions, hint);

  const state = {
    set: null,
    playState: 'idle',
    anim: { index: 0, progress: 0, length: 1 },
    practice: false,
    practiceIndex: 0,
    practiceDone: 0,
    timer: null,
    lastTick: 0,
    drawn: null,
    drawnEl: null,
    searchTimer: null,
    destroyed: false,
  };

  const inkEl = (index) => inkLayer.children[index];
  const strokeCount = () => state.set?.strokes.length ?? 0;

  function setHint(key, params) {
    hint.textContent = key ? t(key, params) : '';
  }

  function setPlayState(next) {
    state.playState = next;
    container.dataset.playState = next;
    playPauseBtn.textContent = t(next === 'playing' ? 'strokes.pause' : 'strokes.play');
    playPauseBtn.setAttribute('aria-pressed', next === 'playing' ? 'true' : 'false');
  }

  function updateProgress(current = state.anim.index + 1) {
    progress.textContent = state.set ? t('strokes.progress', { current, total: strokeCount() }) : '';
  }

  function stopTimer() {
    clearTimeout(state.timer);
    state.timer = null;
  }

  /* ---- animation ---- */

  function strokeLength(index) {
    const el = inkEl(index);
    try {
      const measured = el?.getTotalLength?.();
      if (Number.isFinite(measured) && measured > 0) return measured;
    } catch {
      /* not a layouted SVG — fall back to the median length */
    }
    return Math.max(1, pathLengthFromMedian(state.set?.medians[index] ?? []));
  }

  function paintStroke(index, progressValue) {
    const el = inkEl(index);
    if (!el) return;
    const length = strokeLength(index);
    el.style.strokeDasharray = String(length);
    el.style.strokeDashoffset = String(length * (1 - clamp01(progressValue)));
  }

  function start() {
    if (!state.set || state.destroyed) return;
    setPractice(false);
    const total = strokeCount();
    state.anim = { index: 0, progress: 0, total: 0 };
    for (let index = 0; index < total; index += 1) paintStroke(index, 0);
    updateProgress(1);
    setHint('');
    setPlayState('playing');
    state.lastTick = Date.now();
    tick();
  }

  /**
   * One timer for the whole character: it accumulates elapsed time in "stroke
   * units", so a slow/throttled timer (background tab) jumps several strokes
   * instead of stretching the animation.
   */
  function tick() {
    if (state.destroyed || state.playState !== 'playing') return;
    const now = Date.now();
    const elapsed = now - state.lastTick;
    state.lastTick = now;
    const total = strokeCount();
    state.anim.total += elapsed / ANIM_PER_STROKE_MS;
    if (state.anim.total >= total) {
      for (let index = 0; index < total; index += 1) paintStroke(index, 1);
      state.anim.index = total - 1;
      state.anim.progress = 1;
      finish();
      return;
    }
    const done = Math.floor(state.anim.total);
    for (let index = 0; index < done; index += 1) paintStroke(index, 1);
    state.anim.index = done;
    state.anim.progress = state.anim.total - done;
    paintStroke(done, state.anim.progress);
    updateProgress(done + 1);
    state.timer = setTimeout(tick, TICK_MS);
  }

  function finish() {
    state.anim.progress = 1;
    state.anim.index = Math.max(0, strokeCount() - 1);
    paintStroke(state.anim.index, 1);
    updateProgress(strokeCount());
    stopTimer();
    setPlayState('done');
    setHint('strokes.animationDone');
  }

  function pause() {
    if (state.playState !== 'playing') return;
    stopTimer();
    setPlayState('paused');
  }

  function togglePlay() {
    if (state.playState === 'playing') pause();
    else if (state.playState === 'paused') {
      setPlayState('playing');
      state.lastTick = Date.now();
      tick();
    } else start();
  }

  function clearLayers() {
    ghostLayer.replaceChildren();
    inkLayer.replaceChildren();
    traceGuideLayer.replaceChildren();
    traceDoneLayer.replaceChildren();
    traceDrawnLayer.replaceChildren();
  }

  function renderCharacter(set) {
    state.set = set;
    clearLayers();
    set.strokes.forEach((path, index) => {
      ghostLayer.append(svgEl('path', { class: 'strokes-ghost', d: path, transform: OUTLINE_FLIP, 'data-index': index }));
      inkLayer.append(
        svgEl('path', {
          class: 'strokes-ink',
          d: medianToPath(set.medians[index]),
          'data-index': index,
          style: 'stroke-dasharray:1;stroke-dashoffset:1',
        }),
      );
    });
    container.dataset.character = set.character;
    container.dataset.strokeCount = String(set.strokes.length);
    container.dataset.practiceDone = '0';
    delete container.dataset.practiceState;
    empty.hidden = true;
    board.hidden = false;
    actions.hidden = false;
    progress.hidden = false;
    updateProgress(1);
  }

  /* ---- practice ---- */

  function drawTraceGuides() {
    traceGuideLayer.replaceChildren();
    if (!state.set) return;
    state.set.medians.forEach((median, index) => {
      if (index < state.practiceIndex) return;
      traceGuideLayer.append(
        svgEl('path', {
          class: 'strokes-trace-guide',
          d: medianToPath(median),
          'data-index': index,
          'data-current': String(index === state.practiceIndex),
        }),
      );
    });
  }

  function clearDrawn() {
    state.drawn = null;
    state.drawnEl?.remove();
    state.drawnEl = null;
  }

  function setPractice(on) {
    state.practice = Boolean(on);
    container.dataset.practice = state.practice ? 'on' : 'off';
    practiceBtn.textContent = t(state.practice ? 'strokes.practiceExit' : 'strokes.practice');
    practiceBtn.setAttribute('aria-pressed', state.practice ? 'true' : 'false');
    // In practice the finished animation would hide the guides, so hide it.
    inkLayer.style.display = state.practice ? 'none' : '';
    traceDoneLayer.replaceChildren();
    clearDrawn();
    if (!state.practice || !state.set) {
      traceGuideLayer.replaceChildren();
      if (!state.practice) setHint(state.playState === 'done' ? 'strokes.animationDone' : '');
      return;
    }
    pause();
    state.practiceIndex = 0;
    state.practiceDone = 0;
    container.dataset.practiceDone = '0';
    delete container.dataset.practiceState;
    drawTraceGuides();
    setHint('strokes.practiceHint', { current: 1, total: strokeCount() });
  }

  function toViewBoxPoint(event) {
    const matrix = svg.getScreenCTM?.();
    if (matrix && typeof svg.createSVGPoint === 'function') {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const local = point.matrixTransform(matrix.inverse());
      return [local.x, local.y];
    }
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / VIEW_BOX_SIZE || 1;
    return [(event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale];
  }

  function onPointerDown(event) {
    if (!state.practice || !state.set) return;
    event.preventDefault();
    const point = toViewBoxPoint(event);
    state.drawn = [point];
    state.drawnEl = svgEl('path', { class: 'strokes-trace-drawn', d: medianToPath([point]) });
    traceDrawnLayer.append(state.drawnEl);
    try {
      svg.setPointerCapture?.(event.pointerId);
    } catch {
      /* synthetic pointer events have no active pointer to capture */
    }
  }

  function onPointerMove(event) {
    if (!state.drawn || !state.drawnEl) return;
    event.preventDefault();
    const point = toViewBoxPoint(event);
    const last = state.drawn[state.drawn.length - 1];
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) < MOVE_MIN_DISTANCE) return;
    state.drawn.push(point);
    state.drawnEl.setAttribute('d', medianToPath(state.drawn));
  }

  function onPointerUp() {
    if (!state.drawn) return;
    const points = state.drawn;
    state.drawn = null; // keep drawnEl so the verdict stays visible
    completeTrace(points);
  }

  /** Shared by real pointers and by `strokesApi.traceStroke`. */
  function completeTrace(points) {
    const set = state.set;
    if (!set || !state.practice) return { ok: false, score: 0 };
    const index = state.practiceIndex;
    const result = matchStroke(points, set.medians[index]);
    if (!state.drawnEl) {
      state.drawnEl = svgEl('path', { class: 'strokes-trace-drawn' });
      traceDrawnLayer.append(state.drawnEl);
    }
    state.drawnEl.setAttribute('d', medianToPath(points));
    if (!result.ok) {
      state.drawnEl.dataset.result = 'wrong';
      const wrong = state.drawnEl;
      state.drawnEl = null;
      setTimeout(() => wrong.remove(), WRONG_FLASH_MS);
      setHint('strokes.practiceWrong');
      return result;
    }
    state.drawnEl.remove();
    state.drawnEl = null;
    traceDoneLayer.append(svgEl('path', { class: 'strokes-trace-done', d: set.strokes[index], transform: OUTLINE_FLIP, 'data-index': index }));
    state.practiceIndex = index + 1;
    state.practiceDone += 1;
    container.dataset.practiceDone = String(state.practiceDone);
    if (state.practiceIndex >= set.strokes.length) {
      traceGuideLayer.replaceChildren();
      container.dataset.practiceState = 'done';
      setHint('strokes.practiceDone');
      window.dispatchEvent(
        new CustomEvent('chino:stroke_done', {
          detail: { character: set.character, strokes: set.strokes.length, mode: 'practice' },
        }),
      );
    } else {
      drawTraceGuides();
      setHint('strokes.practiceHint', { current: state.practiceIndex + 1, total: set.strokes.length });
    }
    return result;
  }

  /* ---- actions ---- */

  async function onSpeak() {
    if (!state.set) return;
    const result = await speak(state.set.character, { lang: 'zh-CN' });
    if (!result?.ok && result?.reason !== 'empty') {
      setHint(result?.reason === 'unsupported' ? 'strokes.speakUnsupported' : 'strokes.speakError');
    }
  }

  async function onAddToReview() {
    if (!state.set) return;
    try {
      await addToReview({ hanzi: state.set.character, source: 'strokes' });
      container.dataset.review = 'added';
      setHint('strokes.addedToReview');
    } catch (error) {
      console.error('strokes: add to review failed', error);
      setHint('strokes.reviewError');
    }
  }

  /* ---- search / routing ---- */

  function onSubmit(event) {
    event.preventDefault();
    const characters = hanziCharacters(input.value);
    if (!characters.length) {
      setHint('strokes.searchNoHanzi');
      return;
    }
    const capped = characters.slice(0, 20);
    const tooMany = characters.length > capped.length;
    if (tooMany) setHint('strokesSheet.tooMany', { max: 20 });
    input.value = capped.join('');
    ctx.navigate?.(`learn/strokes/${encodeURIComponent(capped.join(''))}${tooMany ? '?overflow=1' : ''}`);
  }

  function onSearchInput() {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(async () => {
      const characters = hanziCharacters(input.value);
      results.replaceChildren();
      if (characters.length !== 1) return;
      const query = characters[0];
      let hits = [];
      try {
        hits = await defaultLoader.search(query, { limit: 12 });
      } catch {
        hits = [];
      }
      if (state.destroyed) return;
      results.replaceChildren(
        ...hits.map((hit) =>
          h(
            'li',
            {},
            h('button', {
              type: 'button',
              text: hit,
              'data-character': hit,
              onclick: () => ctx.navigate?.(`learn/strokes/${encodeURIComponent(hit)}`),
            }),
          ),
        ),
      );
    }, SEARCH_DEBOUNCE_MS);
  }
  input.addEventListener('input', onSearchInput);

  async function show(character) {
    input.value = character;
    results.replaceChildren();
    container.dataset.character = character;
    if (!state.set || state.set.character !== character) {
      board.hidden = false;
      actions.hidden = true;
      progress.hidden = true;
      setHint('strokes.loading');
      let set = null;
      try {
        set = await defaultLoader.load(character);
      } catch (error) {
        console.error('strokes: loading failed', error);
        if (state.destroyed) return;
        empty.hidden = false;
        empty.textContent = t('strokes.loadError');
        board.hidden = true;
        setHint('');
        return;
      }
      if (state.destroyed) return;
      if (!set) {
        state.set = null;
        empty.hidden = false;
        empty.textContent = t('strokes.notFound', { char: character });
        board.hidden = true;
        actions.hidden = true;
        progress.hidden = true;
        setHint('');
        return;
      }
      renderCharacter(set);
    }
    start();
  }

  function showSearch() {
    reset(container).append(section);
    container.dataset.character = '';
    board.hidden = true;
    actions.hidden = true;
    progress.hidden = true;
    empty.hidden = true;
    hint.textContent = '';
    input.focus({ preventScroll: true });
  }

  function destroy() {
    state.destroyed = true;
    stopTimer();
    clearTimeout(state.searchTimer);
    if (container.strokesApi) delete container.strokesApi;
  }

  reset(container).append(section);
  container.strokesApi = {
    play: () => start(),
    pause: () => pause(),
    replay: () => start(),
    setPractice,
    traceStroke: (points) => {
      if (!state.practice) setPractice(true);
      return completeTrace(points);
    },
    state: () => ({
      character: state.set?.character ?? null,
      strokes: strokeCount(),
      playState: state.playState,
      practice: state.practice,
      practiceIndex: state.practiceIndex,
      practiceDone: state.practiceDone,
    }),
  };

  return { show, showSearch, destroy };
}
