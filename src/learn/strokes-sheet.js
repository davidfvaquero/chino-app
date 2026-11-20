/**
 * strokes-sheet.js — multi-character stroke-order sheet.
 * Routes: `#/learn/strokes` (input box) and `#/learn/strokes/<texto>`
 * (e.g. `#/learn/strokes/戴维德`). Dispatched here by src/learn/strokes.js when
 * the route carries more than one hanzi; a single character keeps the old
 * animation + practice screen.
 *
 * One card per character: pinyin (src/tone.js pinyinHtml) + meaning
 * (src/dictionary.js), stroke count, a horizontally scrollable row of steps
 * (step k = first k strokes, the new one in red), a Play button reusing the
 * SVG renderer/animation exported by src/learn/strokes.js, the approximate
 * stroke types from the median direction, "Copy as text" and "Add all to review".
 *
 * Pure, browser-free helpers (tests/strokes-sheet.test.mjs):
 *   parseCharacters(text, {max})  -> {characters, total, overflow}
 *   buildSteps(count)             -> [{number, strokes:[0..k], newStroke}]
 *   classifyStroke(median)        -> 'horizontal'|'vertical'|'left-falling'|
 *                                    'right-falling'|'dot'|'turn'|'hook'|null
 *   sheetLines(cards)             -> [{character, strokes, hasData, types}]
 *
 * Screen contract: `titleKey` + `render(container, ctx)` (returns cleanup).
 * `container.strokesSheetApi.state()` exposes the loaded cards for headless checks.
 */
import { t, getLocale } from '../i18n.js';
import { h, reset } from '../dom.js';
import { lookup } from '../dictionary.js';
import { addToReview } from '../srs.js';
import { pinyinHtml } from '../tone.js';
import { loadStrokes, createStrokeAnimation, strokeDiagramSvg } from './strokes.js';
import { renderEtymology } from '../etymology.js';

export const titleKey = 'strokesSheet.title';
export const MAX_CHARACTERS = 20;
const STYLE_ID = 'strokes-sheet-style';
const HANZI_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu;
const DOT_MAX_LENGTH = 350;

/* ------------------------------------------------------------- pure logic -- */

/** Hanzi of `text`, in order, capped at `max`; `overflow` when more were typed. */
export function parseCharacters(text, { max = MAX_CHARACTERS } = {}) {
  const all = String(text ?? '').match(HANZI_RE) || [];
  const limit = Math.max(0, Number(max) || 0);
  return { characters: all.slice(0, limit), total: all.length, overflow: all.length > limit };
}

/** One step per stroke; step k holds the first k stroke indices (0-based). */
export function buildSteps(count) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  return Array.from({ length: total }, (_, index) => ({
    number: index + 1,
    strokes: Array.from({ length: index + 1 }, (_, i) => i),
    newStroke: index,
  }));
}

function medianLength(median) {
  let total = 0;
  for (let index = 1; index < median.length; index += 1) {
    total += Math.hypot(median[index][0] - median[index - 1][0], median[index][1] - median[index - 1][1]);
  }
  return total;
}

/** Direction of the two halves of the median (split by arc length). */
function medianHalves(median) {
  const total = medianLength(median);
  if (total === 0) return null;
  let walked = 0;
  for (let index = 1; index < median.length; index += 1) {
    const from = median[index - 1];
    const to = median[index];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (walked + length < total / 2) {
      walked += length;
      continue;
    }
    const ratio = length ? (total / 2 - walked) / length : 0;
    const mid = [from[0] + ratio * (to[0] - from[0]), from[1] + ratio * (to[1] - from[1])];
    const end = median[median.length - 1];
    return {
      first: [mid[0] - median[0][0], mid[1] - median[0][1]],
      second: [end[0] - mid[0], end[1] - mid[1]],
    };
  }
  return null;
}

const vectorLength = (v) => Math.hypot(v[0], v[1]);

function angleBetween(a, b) {
  const la = vectorLength(a);
  const lb = vectorLength(b);
  if (!la || !lb) return 0;
  const cos = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Rough stroke type from the median direction. Expects screen-space medians
 * (y DOWN), as `toStrokeSet` returns them. Returns null when nothing is certain.
 */
export function classifyStroke(median) {
  const points = (Array.isArray(median) ? median : []).filter(
    (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]),
  );
  if (points.length < 2) return null;
  const length = medianLength(points);
  if (length < 1) return null;

  const start = points[0];
  const end = points[points.length - 1];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const ax = Math.abs(dx) / length;
  const ay = Math.abs(dy) / length;

  const halves = medianHalves(points);
  if (halves) {
    const l1 = vectorLength(halves.first);
    const l2 = vectorLength(halves.second);
    const turn = angleBetween(halves.first, halves.second);
    if (turn > 55 && l1 > 90 && l2 > 70) return l2 < 0.5 * l1 ? 'hook' : 'turn';
  }

  if (length < DOT_MAX_LENGTH && ax < 0.85 && ay < 0.85) return 'dot';
  if (ax >= 0.8) return 'horizontal';
  if (ay >= 0.8 && ax < 0.15) return 'vertical';
  if (dy > 0) return dx < 0 ? 'left-falling' : 'right-falling';
  return null;
}

/** Copy/aggregate shape of the cards (no UI text here). */
export function sheetLines(cards) {
  return (Array.isArray(cards) ? cards : []).map((card) => {
    const hasData = Number.isFinite(card?.strokes) && card.strokes > 0;
    return {
      character: String(card?.character ?? ''),
      strokes: hasData ? card.strokes : 0,
      hasData,
      types: hasData ? (card.types ?? []).map((type) => type ?? null) : [],
    };
  });
}

/* ---------------------------------------------------------------- screen -- */

const CSS = `
.strokes-sheet { display: flex; flex-direction: column; gap: 0.9rem; }
.strokes-sheet [hidden] { display: none !important; }
.sheet-form { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.sheet-form input { flex: 1 1 12rem; min-width: 0; padding: 0.6rem 0.7rem; font-size: 1.05rem; min-height: 48px; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: var(--ink); }
.sheet-form button, .sheet-actions button { min-height: 44px; padding: 0.55rem 0.8rem; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: var(--ink); font-size: 0.95rem; }
.sheet-warning, .sheet-empty { margin: 0; color: var(--danger); }
.sheet-card { border: 1px solid var(--line); border-radius: var(--r-lg); padding: 0.75rem; display: flex; flex-direction: column; gap: 0.55rem; break-inside: avoid; }
.sheet-head { display: flex; flex-direction: column; align-items: flex-start; gap: 0.3rem; }
.sheet-char { font-size: 2.6rem; line-height: 1; }
.sheet-pinyin { font-size: 1.1rem; }
.sheet-meaning { display: block; opacity: 0.8; font-size: 0.9rem; }
.sheet-count { opacity: 0.8; font-variant-numeric: tabular-nums; }
.sheet-steps { display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 0.3rem; -webkit-overflow-scrolling: touch; }
.sheet-step { flex: 0 0 auto; margin: 0; display: flex; flex-direction: column; align-items: center; gap: 0.15rem; }
.sheet-step svg, .sheet-player svg { display: block; width: 4.5rem; height: 4.5rem; background: var(--surface); border-radius: var(--r-sm); }
.sheet-step figcaption { font-size: 0.75rem; opacity: 0.7; font-variant-numeric: tabular-nums; }
.sheet-step .stroke-part { fill: var(--ink-soft); opacity: 0.7; }
.sheet-step .stroke-part-new { fill: var(--accent); opacity: 1; }
.sheet-player { align-self: flex-start; margin-top: 0.2rem; }
.sheet-player svg { width: 9rem; height: 9rem; }
.sheet-player .stroke-pen { fill: none; stroke: var(--ink); stroke-width: 46; stroke-linecap: round; stroke-linejoin: round; }
.sheet-types { margin: 0; font-size: 0.85rem; opacity: 0.85; }
.sheet-types-summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; font-size: 0.85rem; }
.sheet-card > button { align-self: flex-start; min-height: 44px; padding: 0.45rem 0.9rem; border: 1.5px solid var(--edge); border-radius: var(--r-md); background: var(--surface); color: var(--ink); font-size: 0.95rem; }
.sheet-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.sheet-actions button[disabled] { opacity: 0.5; }
.sheet-hint { margin: 0; min-height: 1.2em; opacity: 0.8; }
@media print {
  .sheet-form, .sheet-actions, .sheet-hint { display: none !important; }
  .sheet-card { border-color: #999; page-break-inside: avoid; }
  .sheet-steps { flex-wrap: wrap; overflow: visible; }
  .sheet-step svg { width: 3.4rem; height: 3.4rem; }
}
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

export async function render(container, ctx = {}) {
  ensureStyles(document);

  const initial = parseCharacters(ctx?.route?.segments?.[1]);
  const routeOverflow = initial.overflow || ctx?.route?.params?.overflow === '1';
  const input = h('input', {
    type: 'text',
    name: 'characters',
    autocomplete: 'off',
    value: initial.characters.join(''),
    'aria-label': t('strokesSheet.inputLabel'),
    placeholder: t('strokesSheet.inputPlaceholder'),
  });
  const form = h(
    'form',
    { class: 'sheet-form', onsubmit: onSubmit },
    input,
    h('button', { type: 'submit', text: t('strokesSheet.show') }),
  );
  const warning = h('p', { class: 'sheet-warning', hidden: !routeOverflow });
  if (routeOverflow) warning.textContent = t('strokesSheet.tooMany', { max: MAX_CHARACTERS });
  const hint = h('p', { class: 'sheet-hint' });
  const cardsBox = h('div', { class: 'sheet-cards' });
  const copyBtn = h('button', { type: 'button', text: t('strokesSheet.copy'), onclick: onCopy });
  const reviewBtn = h('button', { type: 'button', text: t('strokesSheet.addAll'), onclick: onAddAll });
  const actions = h('div', { class: 'sheet-actions' }, copyBtn, reviewBtn);
  const section = h('section', { class: 'strokes-sheet' }, form, warning, hint, actions, cardsBox);

  const state = { cards: [], anims: [], destroyed: false };

  reset(container).append(section);
  container.dataset.cards = '0';

  function onSubmit(event) {
    event.preventDefault();
    const parsed = parseCharacters(input.value);
    if (!parsed.characters.length) {
      hint.textContent = t('strokesSheet.empty');
      return;
    }
    warning.hidden = !parsed.overflow;
    if (parsed.overflow) warning.textContent = t('strokesSheet.tooMany', { max: MAX_CHARACTERS });
    ctx.navigate?.(`learn/strokes/${encodeURIComponent(parsed.characters.join(''))}${parsed.overflow ? '?overflow=1' : ''}`);
  }

  async function onCopy() {
    const text = state.cards
      .map((card) => {
        if (!card.hasData) return t('strokesSheet.summaryNoData', { char: card.character });
        const types = card.types
          .map((type, index) => (type ? `${index + 1}. ${t(`strokesSheet.types.${type}`)}` : null))
          .filter(Boolean)
          .join(', ');
        return `${t('strokesSheet.summaryLine', { char: card.character, count: card.strokes })}${types ? `\n  ${types}` : ''}`;
      })
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      hint.textContent = t('strokesSheet.copied');
    } catch (error) {
      console.error('strokes-sheet: copy failed', error);
      hint.textContent = t('strokesSheet.copyError');
    }
  }

  async function onAddAll() {
    const list = state.cards.filter((card) => card.entry);
    let count = 0;
    try {
      for (const card of list) {
        await addToReview({
          hanzi: card.character,
          pinyin: card.entry.pinyinTone,
          english: card.entry.defs,
          source: 'strokes-sheet',
        });
        count += 1;
      }
      hint.textContent = t('strokesSheet.added', { count });
    } catch (error) {
      console.error('strokes-sheet: add to review failed', error);
      hint.textContent = t('strokesSheet.reviewError');
    }
  }

  function playButton(card, animBox) {
    const button = h('button', { type: 'button', text: t('strokesSheet.play') });
    button.addEventListener('click', () => {
      if (!card.anim) {
        card.anim = createStrokeAnimation(card.set);
        card.anim.svg.classList.add('sheet-player-svg');
        animBox.append(card.anim.svg);
        state.anims.push(card.anim);
      }
      animBox.hidden = false;
      card.anim.toggle();
      const now = card.anim.state();
      button.textContent = t(now === 'playing' ? 'strokesSheet.pause' : 'strokesSheet.play');
      button.dataset.state = now;
      container.dataset.playState = now;
    });
    return button;
  }

  function cardNode(card) {
    // Spanish gloss when the locale is es and the entry carries one; otherwise
    // the English CC-CEDICT defs are labelled as such (P1-1).
    const es = getLocale() === 'es';
    const defsEs = es && Array.isArray(card.entry?.defsEs) ? card.entry.defsEs : [];
    const defs = defsEs.length ? defsEs : (card.entry?.defs ?? []);
    const meaning = defs.slice(0, 2).join('; ');
    const meaningText = meaning && !defsEs.length && es ? `${t('strokesSheet.meaningEnglish')} ${meaning}` : meaning;
    const head = h(
      'div',
      { class: 'sheet-head' },
      h('span', { class: 'sheet-char', lang: 'zh-Hans', text: card.character }),
      card.entry ? h('span', { class: 'sheet-pinyin', html: pinyinHtml(card.entry.pinyinTone) }) : null,
      meaningText ? h('span', { class: 'sheet-meaning', text: meaningText }) : null,
      card.hasData ? h('span', { class: 'sheet-count', text: t('strokesSheet.strokesCount', { count: card.strokes }) }) : null,
    );
    const node = h('article', { class: 'sheet-card' }, head);
    node.dataset.character = card.character;
    renderEtymology(card.character).then((box) => { if (box) node.append(box); }).catch(() => {});
    if (!card.hasData) {
      node.append(h('p', { class: 'sheet-empty', text: t('strokesSheet.noData', { char: card.character }) }));
      return node;
    }
    node.dataset.strokes = String(card.strokes);
    node.dataset.steps = String(card.steps.length);

    const steps = h('div', { class: 'sheet-steps', role: 'list' });
    card.steps.forEach((step) => {
      const figure = h(
        'figure',
        { class: 'sheet-step', role: 'listitem' },
        strokeDiagramSvg(card.set, { upTo: step.strokes.length, accent: step.newStroke }),
        h('figcaption', { text: t('strokesSheet.stepLabel', { number: step.number }) }),
      );
      figure.setAttribute('aria-label', t('strokesSheet.stepLabel', { number: step.number }));
      steps.append(figure);
    });
    node.append(steps);

    const animBox = h('div', { class: 'sheet-player', hidden: true });
    const types = card.types
      .map((type, index) => (type ? `${index + 1} ${t(`strokesSheet.types.${type}`)}` : null))
      .filter(Boolean)
      .join(' · ');
    if (types) {
      node.append(
        h(
          'details',
          { class: 'sheet-types-wrap' },
          h('summary', { class: 'sheet-types-summary', text: t('strokesSheet.typesTitle') }),
          h('p', { class: 'sheet-types', text: `${t('strokesSheet.approxLabel')} ${types}` }),
        ),
      );
    }
    node.append(playButton(card, animBox), animBox);
    return node;
  }

  async function load(text) {
    const parsed = parseCharacters(text);
    state.cards = [];
    cardsBox.replaceChildren();
    container.dataset.cards = '0';
    container.dataset.characters = parsed.characters.join('');
    if (!parsed.characters.length) {
      hint.textContent = t('strokesSheet.empty');
      actions.hidden = true;
      return;
    }
    actions.hidden = false;
    hint.textContent = t('strokesSheet.loading');
    warning.hidden = !(parsed.overflow || routeOverflow);

    const loaded = await Promise.all(
      parsed.characters.map(async (character) => {
        const [set, entry] = await Promise.all([
          loadStrokes(character).catch((error) => {
            console.error('strokes-sheet: stroke load failed', character, error);
            return null;
          }),
          lookup(character, { spanish: getLocale() === 'es' }).catch(() => null),
        ]);
        const types = set ? set.medians.map(classifyStroke) : [];
        return {
          character,
          set,
          entry,
          hasData: Boolean(set?.strokes.length),
          strokes: set?.strokes.length ?? 0,
          steps: buildSteps(set?.strokes.length ?? 0),
          types,
        };
      }),
    );
    if (state.destroyed) return;
    state.cards = loaded;
    cardsBox.replaceChildren(...loaded.map(cardNode));
    container.dataset.cards = String(loaded.length);
    reviewBtn.disabled = !loaded.some((card) => card.entry);
    hint.textContent = '';
  }

  container.strokesSheetApi = {
    state: () => ({
      characters: state.cards.map((card) => card.character),
      cards: state.cards.map((card) => ({
        character: card.character,
        strokes: card.strokes,
        hasData: card.hasData,
        steps: card.steps.length,
        types: card.types,
      })),
    }),
  };

  await load(initial.characters.join(''));

  return () => {
    state.destroyed = true;
    state.anims.forEach((anim) => anim.stop());
    if (container.strokesSheetApi) delete container.strokesSheetApi;
  };
}