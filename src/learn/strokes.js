/**
 * strokes.js — Stroke order: `#/learn/strokes` (character search) and
 * `#/learn/strokes/<hanzi>` (stroke-by-stroke animation + tracing practice).
 *
 * Own SVG renderer, zero dependencies. The module was split for readability
 * (docs/REVIEW-2.md I14): pure geometry lives in `strokes-geometry.js`, the
 * dataset loader in `strokes-data.js` and the single animation engine + SVG
 * helpers in `strokes-svg.js`. This file keeps the screen (createStrokeApp,
 * render) and re-exports the old public surface so callers/tests do not move.
 *
 * Screen contract: `titleKey` + `render(container, ctx)` (returns a cleanup fn).
 *
 * Wiring with the rest of the app (only these imports):
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
import { VIEW_BOX_SIZE, OUTLINE_FLIP, hanziCharacters, createStrokeLoader } from './strokes-data.js';
import { clamp01, medianToPath, matchStroke, pathLengthFromMedian } from './strokes-geometry.js';
import { svgEl, createStrokeEngine } from './strokes-svg.js';
import { ensureStrokesStyles } from './strokes-ui.css.js';

export const titleKey = 'hubs.learn.strokes';

/* ---- public surface (kept stable for the sheet, the worksheet and tests) -- */
export {
  VIEW_BOX_SIZE,
  OUTLINE_FLIP,
  DEFAULT_STROKE_BASE,
  BASELINE_Y,
  normalizeCharacter,
  hanziCharacters,
  isValidStrokeEntry,
  toStrokeSet,
  searchCharacters,
  createStrokeLoader,
  loadStrokeIndex,
  loadStrokes,
} from './strokes-data.js';
export {
  DEFAULT_TOLERANCE,
  MIN_COVERAGE,
  medianToPath,
  pathLengthFromMedian,
  pointToSegmentDistance,
  distanceToPolyline,
  resamplePolyline,
  matchStroke,
} from './strokes-geometry.js';
export { svgEl, strokeDiagramSvg, createStrokeAnimation, createStrokeEngine } from './strokes-svg.js';

const defaultLoader = createStrokeLoader();

/* ------------------------------------------------------------------
 * Screen: search box + animated character + tracing practice
 * ------------------------------------------------------------------ */

const ANIM_PER_STROKE_MS = 420;
const TICK_MS = 16;
const MOVE_MIN_DISTANCE = 5;
const SEARCH_DEBOUNCE_MS = 150;
const WRONG_FLASH_MS = 600;

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
  ensureStrokesStyles(document);

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

  // P2-7: the empty state is not a blank box — one line and three example
  // characters that fill the field and open their stroke order.
  const EXAMPLE_CHARS = ['你', '好', '妈'];
  const exampleHint = h('p', { class: 'strokes-hint', text: t('strokes.exampleHint') });
  const examples = h(
    'div',
    { class: 'strokes-examples' },
    ...EXAMPLE_CHARS.map((ch) =>
      h('button', {
        type: 'button',
        class: 'chip',
        lang: 'zh-Hans',
        text: ch,
        onclick: () => ctx.navigate?.(`learn/strokes/${encodeURIComponent(ch)}`),
      }),
    ),
  );

  const playPauseBtn = h('button', { type: 'button', class: 'strokes-play', text: t('strokes.pause'), onclick: togglePlay });
  const replayBtn = h('button', { type: 'button', class: 'btn ghost strokes-replay', text: t('strokes.replay'), onclick: () => start() });
  const practiceBtn = h('button', {
    type: 'button',
    class: 'strokes-practice-btn',
    text: t('strokes.practice'),
    onclick: () => setPractice(!state.practice),
  });
  const speakBtn = h('button', { type: 'button', class: 'btn ghost strokes-speak', text: t('strokes.speak'), onclick: onSpeak });
  const reviewBtn = h('button', { type: 'button', class: 'btn ghost strokes-review', text: t('strokes.addToReview'), onclick: onAddToReview });

  const actions = h('div', { class: 'strokes-actions' }, playPauseBtn, replayBtn, practiceBtn, speakBtn, reviewBtn);
  const board = h('div', { class: 'strokes-board' }, svg);
  const section = h('section', { class: 'strokes' }, form, results, exampleHint, examples, empty, board, progress, actions, hint);

  const state = {
    set: null,
    playState: 'idle',
    anim: { index: 0, progress: 0, length: 1 },
    practice: false,
    practiceIndex: 0,
    practiceDone: 0,
    drawn: null,
    drawnEl: null,
    searchTimer: null,
    destroyed: false,
  };
  /** The single animation engine (strokes-svg.js), rebuilt per character. */
  let anim = null;

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

  function buildAnim() {
    anim?.stop();
    anim = createStrokeEngine({
      count: strokeCount(),
      perStrokeMs: ANIM_PER_STROKE_MS,
      tickMs: TICK_MS,
      reduced: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
      paint: paintStroke,
      onState: ({ state: engineState, index, progress: value }) => {
        state.anim = { index, progress: value, total: strokeCount() };
        if (engineState === 'playing') updateProgress(Math.min(strokeCount(), index + 1));
        else if (engineState === 'done') finish();
      },
    });
  }

  function start() {
    if (!state.set || state.destroyed) return;
    setPractice(false);
    buildAnim();
    setHint('');
    setPlayState('playing');
    anim.play();
  }

  function finish() {
    const total = strokeCount();
    state.anim = { index: Math.max(0, total - 1), progress: 1, total };
    for (let index = 0; index < total; index += 1) paintStroke(index, 1);
    updateProgress(total);
    setPlayState('done');
    setHint('strokes.animationDone');
  }

  function pause() {
    if (state.playState !== 'playing') return;
    anim?.pause();
    setPlayState('paused');
  }

  function togglePlay() {
    if (state.playState === 'playing') pause();
    else if (state.playState === 'paused') {
      setPlayState('playing');
      anim?.toggle();
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
              lang: 'zh-Hans',
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
    exampleHint.hidden = true;
    examples.hidden = true;
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
    exampleHint.hidden = false;
    examples.hidden = false;
    board.hidden = true;
    actions.hidden = true;
    progress.hidden = true;
    empty.hidden = true;
    hint.textContent = '';
    input.focus({ preventScroll: true });
  }

  function destroy() {
    state.destroyed = true;
    anim?.stop();
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
