/**
 * strokes-svg.js — SVG building blocks and the single stroke animation engine
 * (docs/REVIEW-2.md I14).
 *
 * Before the split there were two copies of the tick loop: one in
 * `createStrokeAnimation` (used by the multi-character sheet) and one inside the
 * single-character app. Now there is ONE engine, `createStrokeEngine`, and both
 * screens drive it — the sheet through `createStrokeAnimation` (which builds its
 * own pen SVG) and the app through `paint` on its existing ink layers.
 */
import { VIEW_BOX_SIZE, OUTLINE_FLIP, SVG_NS } from './strokes-data.js';
import { clamp01, medianToPath, pathLengthFromMedian } from './strokes-geometry.js';

const ANIM_PER_STROKE_MS = 420;
const TICK_MS = 16;

export function svgEl(tag, attrs = {}, ...children) {
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
 * The single stroke animation engine: one timer that advances `count` strokes,
 * calling `paint(index, progress)` every frame and `onState({ state, index,
 * progress })` on every change. `reduced` paints the finished drawing at once
 * (prefers-reduced-motion). Returns `{ play, pause, toggle, stop, state }`.
 */
export function createStrokeEngine({
  count = 0,
  paint,
  perStrokeMs = ANIM_PER_STROKE_MS,
  tickMs = TICK_MS,
  onState,
  reduced = false,
} = {}) {
  let state = 'idle';
  let timer = null;
  let lastTick = 0;
  let elapsed = 0;

  const clear = () => {
    clearTimeout(timer);
    timer = null;
  };
  const progressNow = () => (count ? Math.min(count - 1, Math.floor(elapsed)) : 0);
  const report = () => onState?.({ state, index: progressNow(), progress: count ? elapsed - Math.floor(elapsed) : 1 });

  function tick() {
    if (state !== 'playing') return;
    if (!count) {
      state = 'done';
      report();
      return;
    }
    const now = Date.now();
    elapsed += (now - lastTick) / perStrokeMs;
    lastTick = now;
    if (elapsed >= count) {
      for (let index = 0; index < count; index += 1) paint(index, 1);
      clear();
      state = 'done';
      onState?.({ state, index: Math.max(0, count - 1), progress: 1 });
      return;
    }
    const done = Math.floor(elapsed);
    for (let index = 0; index < done; index += 1) paint(index, 1);
    paint(done, elapsed - done);
    onState?.({ state, index: done, progress: elapsed - done });
    timer = setTimeout(tick, tickMs);
  }

  const play = () => {
    clear();
    elapsed = 0;
    lastTick = Date.now();
    for (let index = 0; index < count; index += 1) paint(index, 0);
    if (!count) {
      state = 'done';
      onState?.({ state, index: 0, progress: 1 });
      return;
    }
    state = 'playing';
    onState?.({ state, index: 0, progress: 0 });
    if (reduced) {
      for (let index = 0; index < count; index += 1) paint(index, 1);
      state = 'done';
      onState?.({ state, index: count - 1, progress: 1 });
      return;
    }
    tick();
  };

  const pause = () => {
    if (state !== 'playing') return;
    clear();
    state = 'paused';
    report();
  };

  const toggle = () => {
    if (state === 'playing') pause();
    else if (state === 'paused') {
      state = 'playing';
      lastTick = Date.now();
      tick();
    } else play();
  };

  const stop = () => {
    clear();
    state = 'idle';
  };

  return { play, pause, toggle, stop, state: () => state };
}

/**
 * Convenience wrapper for the multi-character sheet: a `<svg>` of pen paths
 * (one per median) plus the shared engine painting their dash offset. `onState`
 * lets the host reset its Play button when the animation ends (I14).
 */
export function createStrokeAnimation(set, { perStrokeMs = ANIM_PER_STROKE_MS, tickMs = TICK_MS, onState } = {}) {
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
  const lengths = (set?.medians ?? []).map((median) => Math.max(1, pathLengthFromMedian(median)));

  const engine = createStrokeEngine({
    count: inks.length,
    perStrokeMs,
    tickMs,
    onState,
    paint: (index, progress) => {
      const ink = inks[index];
      if (!ink) return;
      ink.style.strokeDasharray = String(lengths[index]);
      ink.style.strokeDashoffset = String(lengths[index] * (1 - clamp01(progress)));
    },
  });

  return { svg, ...engine };
}

export { ANIM_PER_STROKE_MS, TICK_MS };
