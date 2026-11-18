/**
 * Draw a character — canvas + stroke matching.
 *
 * Contract: `titleKey` + `render(container, ctx)` (see src/main.js).
 * No literal UI text: every string comes from t() with a draw.* key
 * (src/locales/en.d/draw.json).
 *
 * Exports for tests:
 *   - collectPoints(event, canvas) -> [{x,y},...]
 *   - normaliseStroke(points, canvas) -> [[x,y],...]  (screen -> normalised 0..1, y UP)
 *   - prepareForMatch(strokes) -> prepared strokes (uses strokematch.prepare)
 *   - fireDrawUsed()
 */

import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { href, navigate } from '../router.js';
import { loadIndex, match, normalize, resample } from './strokematch.js';

export const titleKey = 'draw.title';

const STYLE_ID = 'draw-style';
const CSS = `
.draw-wrap { display: flex; flex-direction: column; gap: 0.5rem; height: 100%; }
.draw-canvas-wrap { position: relative; flex: 1; min-height: 240px; }
.draw-canvas {
  width: 100%; height: 100%; min-height: 240px; max-height: 50vh;
  border: 2px solid var(--line); border-radius: var(--radius);
  background: var(--bg); touch-action: none; display: block;
}
.draw-canvas:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
.draw-grid { position: absolute; inset: 0; pointer-events: none; opacity: 0.15; }
.draw-toolbar { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.draw-btn {
  flex: 1; min-width: 90px; padding: 0.6rem 0.9rem;
  border: 1px solid var(--line); border-radius: var(--radius);
  background: var(--bg); color: var(--fg); font: inherit;
}
.draw-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.draw-btn.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.draw-status { min-height: 1.25rem; color: var(--fg-soft); font-size: 0.875rem; }
.draw-candidates { margin-top: 0.5rem; }
.draw-candidates-list { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.35rem; }
.draw-candidate {
  display: inline-flex; flex-direction: column; align-items: center; gap: 0.2rem;
  padding: 0.5rem 0.75rem; border: 1px solid var(--line); border-radius: var(--radius);
  background: var(--bg); color: var(--fg); font: inherit; text-decoration: none;
  min-width: 60px;
}
.draw-candidate .char { font-size: 1.5rem; font-weight: 600; line-height: 1; }
.draw-candidate .score { font-size: 0.7rem; color: var(--fg-soft); }
.draw-limit { margin-top: 0.75rem; padding: 0.6rem; border-radius: var(--radius); background: var(--bg-soft); border: 1px solid var(--line); font-size: 0.8125rem; color: var(--fg-soft); }
@media (prefers-color-scheme: dark) {
  .draw-grid { opacity: 0.1; }
}
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/** Grid lines for the canvas (center + diagonals). */
function drawGrid(ctx, w, h) {
  ctx.save();
  ctx.strokeStyle = 'currentColor';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  // center cross
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  // diagonals
  ctx.moveTo(0, 0);
  ctx.lineTo(w, h);
  ctx.moveTo(w, 0);
  ctx.lineTo(0, h);
  ctx.stroke();
  ctx.restore();
}

/**
 * Collect raw points from a pointer event sequence.
 * @param {PointerEvent} event
 * @param {HTMLCanvasElement} canvas
 * @returns {{x: number, y: number}}
 */
export function collectPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * Normalise a stroke from screen coordinates to the 0..1 box (y UP)
 * that strokematch expects.
 * @param {{x:number,y:number}[]} points
 * @param {HTMLCanvasElement} canvas
 * @returns {number[][]} [[x,y],...] in 0..1, y UP
 */
export function normaliseStroke(points, canvas) {
  if (!points.length) return [];
  const w = canvas.width;
  const h = canvas.height;
  return points.map((p) => [p.x / w, 1 - p.y / h]);
}

/**
 * Prepare strokes for matching using the strokematch.prepare pipeline
 * (normalise + resample). This is a thin wrapper so tests can call it directly.
 * @param {number[][][]} strokes
 * @returns {number[][]}
 */
export function prepareForMatch(strokes) {
  return strokes.filter((s) => s.length > 0).map((s) => resample(normalize([s])[0]));
}

/** Fire the cross-module event. */
export function fireDrawUsed() {
  globalThis.dispatchEvent(new CustomEvent('chino:draw_used'));
}

/** Debounce helper. */
function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export async function render(container, ctx) {
  ensureStyles(document);

  // State
  const strokes = [];          // each stroke = [{x,y},...] in screen coords
  const currentStroke = [];    // points being collected
  let canvas = null;
  let ctx2d = null;
  let candidatesEl = null;
  let statusEl = null;
  let undoBtn = null;
  let clearBtn = null;
  let indexed = false;
  let alive = true;

  // UI skeleton
  const canvasWrap = h('div', { class: 'draw-canvas-wrap' });
  canvas = h('canvas', {
    class: 'draw-canvas',
    tabindex: 0,
    'aria-label': t('draw.canvasAria'),
  });
  const grid = h('canvas', { class: 'draw-grid', 'aria-hidden': 'true' });
  canvasWrap.append(canvas, grid);

  const toolbar = h('div', { class: 'draw-toolbar' });
  undoBtn = h('button', {
    type: 'button',
    class: 'draw-btn',
    text: t('draw.undo'),
    disabled: true,
    onclick: () => {
      if (strokes.length) {
        strokes.pop();
        redraw();
        updateControls();
      }
    },
  });
  clearBtn = h('button', {
    type: 'button',
    class: 'draw-btn',
    text: t('draw.clear'),
    disabled: true,
    onclick: () => {
      strokes.length = 0;
      redraw();
      updateControls();
      showCandidates([]);
      setStatus('');
    },
  });
  toolbar.append(undoBtn, clearBtn);

  statusEl = h('p', { class: 'draw-status', 'aria-live': 'polite' });

  candidatesEl = h('div', { class: 'draw-candidates', hidden: true },
    h('p', { class: 'draw-status', text: t('draw.candidates') }),
    h('div', { class: 'draw-candidates-list' }),
  );

  const limitNotice = h('p', { class: 'draw-limit', text: t('draw.limitNotice') });

  reset(container).append(
    h('section', { class: 'draw-wrap' },
      canvasWrap,
      toolbar,
      statusEl,
      candidatesEl,
      limitNotice,
    ),
  );

  // Canvas setup
  function resize() {
    const wrap = canvasWrap;
    const w = wrap.clientWidth;
    const h = Math.max(240, Math.min(w, window.innerHeight * 0.45));
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    grid.width = w * devicePixelRatio;
    grid.height = h * devicePixelRatio;
    grid.style.width = w + 'px';
    grid.style.height = h + 'px';
    const gctx = grid.getContext('2d');
    gctx.scale(devicePixelRatio, devicePixelRatio);
    drawGrid(gctx, w, h);
    ctx2d = canvas.getContext('2d');
    ctx2d.scale(devicePixelRatio, devicePixelRatio);
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';
    ctx2d.lineWidth = 3;
    ctx2d.strokeStyle = 'var(--fg)';
    redraw();
  }

  function redraw() {
    if (!ctx2d) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx2d.clearRect(0, 0, w, h);
    for (const s of strokes) {
      if (s.length < 2) continue;
      ctx2d.beginPath();
      ctx2d.moveTo(s[0].x, s[0].y);
      for (let i = 1; i < s.length; i++) ctx2d.lineTo(s[i].x, s[i].y);
      ctx2d.stroke();
    }
    // current stroke in progress
    if (currentStroke.length >= 2) {
      ctx2d.beginPath();
      ctx2d.moveTo(currentStroke[0].x, currentStroke[0].y);
      for (let i = 1; i < currentStroke.length; i++) ctx2d.lineTo(currentStroke[i].x, currentStroke[i].y);
      ctx2d.stroke();
    }
  }

  function updateControls() {
    undoBtn.disabled = strokes.length === 0;
    clearBtn.disabled = strokes.length === 0 && currentStroke.length === 0;
  }

  function setStatus(key, params) {
    statusEl.textContent = key ? t(key, params) : '';
  }

  function showCandidates(list) {
    const listEl = candidatesEl.querySelector('.draw-candidates-list');
    if (!list.length) {
      candidatesEl.hidden = true;
      return;
    }
    listEl.replaceChildren(
      ...list.map(({ char, score }) => {
        const pct = Math.round(score * 100);
        return h('a', {
          class: 'draw-candidate',
          href: href(`dictionary?q=${encodeURIComponent(char)}`),
          onclick: (e) => {
            // Also allow opening stroke order view via a modifier or second action
            // For now, click = dictionary. Could add a context menu or long-press for strokes.
          },
        },
          h('span', { class: 'char', text: char }),
          h('span', { class: 'score', text: `${pct}%` }),
        );
      }),
    );
    candidatesEl.hidden = false;
  }

  // Pointer handling
  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return; // only primary
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    currentStroke.length = 0;
    currentStroke.push(collectPoint(event, canvas));
    redraw();
  }

  function onPointerMove(event) {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    currentStroke.push(collectPoint(event, canvas));
    redraw();
  }

  function onPointerUp(event) {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    currentStroke.push(collectPoint(event, canvas));
    canvas.releasePointerCapture(event.pointerId);
    if (currentStroke.length >= 2) {
      strokes.push([...currentStroke]);
      updateControls();
      runMatch();
    }
    currentStroke.length = 0;
    redraw();
  }

  function onPointerCancel(event) {
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    currentStroke.length = 0;
    redraw();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerCancel);

  // Keyboard: Enter/Space to focus canvas for accessibility
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      canvas.focus({ preventScroll: true });
    }
  });

  // Debounced matching after each stroke
  const runMatch = debounce(async () => {
    if (!alive) return;
    if (!strokes.length) {
      showCandidates([]);
      setStatus('');
      return;
    }

    if (!indexed) {
      setStatus('draw.loading');
      try {
        // Load HSK 1 characters by default (same as strokematch default)
        await loadIndex({ levels: [1] });
        indexed = true;
      } catch (err) {
        console.error('draw: failed to load stroke index', err);
        setStatus('draw.indexError');
        return;
      }
    }

    // Convert strokes to normalised format for strokematch
    const normalised = strokes.map((s) => normaliseStroke(s, canvas));
    const results = match(normalised, { max: 10 });

    if (!alive) return;

    if (!results.length) {
      showCandidates([]);
      setStatus('draw.noCandidates');
      return;
    }

    showCandidates(results);
    setStatus('draw.candidatesCount', { count: results.length });
    fireDrawUsed();
  }, 120);

  // Initial load notice
  setStatus('draw.noCandidates');

  // Resize handling
  const ro = new ResizeObserver(resize);
  ro.observe(canvasWrap);

  container.focus({ preventScroll: true });

  return () => {
    alive = false;
    ro.disconnect();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('pointerleave', onPointerCancel);
  };
}