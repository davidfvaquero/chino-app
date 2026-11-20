/**
 * pinyin-chart.js — `#/learn/pinyin-chart`: the initial × final syllable table.
 *
 * Tap a syllable cell to see (and hear) its four tones. The audio is *not* the
 * bare pinyin — browsers pronounce "ma" badly — but the real character the build
 * script picked for that syllable+tone (public/data/pinyin-chart.json, see
 * scripts/build-pinyin-chart.mjs). Tones with no common character are marked
 * "no audio" and their button is disabled.
 *
 * Pinyin is always rendered through pinyinHtml() (src/tone.js) so the tone
 * colours / settings apply. Every string comes from t('pinyinchart.*')
 * (src/locales/en.d/pinyinchart.json) — no literal UI text.
 *
 * Screen contract (see src/screens/learn.js): `titleKey` + `render(container, ctx)`.
 *
 * Testability hooks on the container:
 *   container.dataset.state    = 'loading' | 'ready' | 'error'
 *   container.dataset.selected = the selected syllable ('ma')
 *   .pinyin-cell[data-syllable]  one button per valid syllable
 *   .pinyin-tone[data-tone]      the four tone rows of the selected syllable
 *   container.pinyinApi          { select(syllable), state() } for headless tests
 *
 * Public API:
 *   titleKey
 *   loadChart({base, fetchJson}) -> chart object (injectable for tests)
 *   render(container, ctx)
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { speak } from '../audio.js';
import { pinyinHtml } from '../tone.js';

export const titleKey = 'pinyinchart.title';

/** Where the generated chart lives (works in src/ and in the built dist/). */
export const DATA_BASE = new URL('../../data/pinyin-chart.json', import.meta.url);

const TONES = [1, 2, 3, 4];

const defaultFetchJson = async (url) => {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`pinyin-chart: ${res.status} for ${url}`);
  return res.json();
};

/** Load the generated chart. `fetchJson`/`base` are injectable for tests. */
export async function loadChart({ base = DATA_BASE, fetchJson = defaultFetchJson } = {}) {
  return fetchJson(base instanceof URL ? base.href : String(base));
}

/** The syllable a cell stands for ('' initial = the zero-initial group). */
export function syllableOf(initial, final) {
  return `${initial}${final}`;
}

const STYLE_ID = 'pinyinchart-style';
const CSS = `
.pinyinchart { display: flex; flex-direction: column; gap: 0.85rem; }
.pinyinchart-intro { margin: 0; color: var(--ink-soft); font-size: 0.95rem; line-height: 1.45; }
.pinyinchart-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid var(--line); border-radius: var(--r-md); }
.pinyinchart-table { border-collapse: collapse; font-size: 0.95rem; }
.pinyinchart-table th, .pinyinchart-table td { padding: 0; margin: 0; }
.pinyinchart-corner, .pinyinchart-final, .pinyinchart-initial {
  position: sticky; left: 0; z-index: 1; background: var(--bg);
  border-right: 1px solid var(--line); font-weight: 600;
}
.pinyinchart-corner, .pinyinchart-final { top: 0; z-index: 2; }
.pinyinchart-corner { left: 0; z-index: 3; }
.pinyinchart-final { padding: 0.35rem 0.5rem; text-align: center; font-weight: 600; color: var(--ink-soft); }
.pinyinchart-initial { padding: 0.35rem 0.55rem; text-align: left; color: var(--ink-soft); }
.pinyin-cell {
  display: block; width: 100%; min-width: 2.9rem; min-height: 2.75rem; padding: 0.2rem 0.3rem;
  border: 0; border-top: 1px solid var(--edge); border-left: 1px solid var(--edge);
  background: var(--surface); color: inherit; font: inherit; font-size: 1rem; cursor: pointer;
}
.pinyin-cell[aria-pressed="true"] { background: var(--accent-wash); font-weight: 600; }
.pinyin-cell:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
.pinyin-empty { display: block; min-width: 2.9rem; min-height: 2.75rem; border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
.pinyinchart-panel { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem; border: 1px solid var(--line); border-radius: var(--r-md); }
.pinyinchart-panel[hidden] { display: none; }
.pinyinchart-panel-title { margin: 0; font-size: 1.1rem; }
.pinyinchart-tones { display: grid; gap: 0.4rem; margin: 0; padding: 0; list-style: none; }
.pinyin-tone-btn {
  display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 0.6rem;
  width: 100%; min-height: 2.8rem; padding: 0.4rem 0.6rem; border: 1px solid var(--line);
  border-radius: var(--r-md); background: var(--surface); color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.pinyin-tone-btn[disabled] { opacity: 0.5; cursor: default; }
.pinyin-tone-num { font-size: 0.8rem; color: var(--ink-soft); }
.pinyin-tone-pinyin { font-size: 1.15rem; }
.pinyin-tone-hanzi { font-size: 1.5rem; font-weight: 600; }
.pinyin-tone-gloss { font-size: 0.85rem; color: var(--ink-soft); }
.pinyinchart-status { margin: 0; min-height: 1.2em; color: var(--ink-soft); font-size: 0.9rem; }
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
  const app = createChartApp(container, ctx);
  await app.load();
  return () => app.destroy();
}

function createChartApp(container, ctx) {
  const state = { chart: null, selected: null, destroyed: false };

  const intro = h('p', { class: 'pinyinchart-intro', text: t('pinyinchart.intro') });
  const table = h('table', { class: 'pinyinchart-table', 'aria-label': t('pinyinchart.tableLabel') });
  const scroll = h('div', { class: 'pinyinchart-scroll' }, table);
  const panelTitle = h('h3', { class: 'pinyinchart-panel-title' });
  const toneList = h('ul', { class: 'pinyinchart-tones' });
  const panel = h('section', { class: 'pinyinchart-panel', hidden: true, 'aria-live': 'polite' }, panelTitle, toneList);
  const status = h('p', { class: 'pinyinchart-status', role: 'status', 'aria-live': 'polite' });
  const section = h('section', { class: 'pinyinchart py-keep' }, intro, scroll, panel, status);

  reset(container).append(section);
  container.dataset.state = 'loading';

  const setStatus = (key) => {
    status.textContent = key ? t(key) : '';
  };

  /** One tone row of the selected syllable (plays its character, or disabled). */
  function toneRow(entry) {
    const hasAudio = Boolean(entry.hanzi);
    const button = h('button', {
      type: 'button',
      class: 'pinyin-tone-btn',
      disabled: !hasAudio,
      'data-tone': String(entry.tone),
      'data-hanzi': entry.hanzi ?? '',
      'aria-label': hasAudio ? t('pinyinchart.playTone', { hanzi: entry.hanzi }) : t('pinyinchart.noAudio'),
      onclick: () => play(entry),
    });
    button.append(
      h('span', { class: 'pinyin-tone-num', text: t(`pinyinchart.tone${entry.tone}`) }),
      h('span', { class: 'pinyin-tone-pinyin', html: pinyinHtml(entry.pinyin || '') }),
      h('span', { class: 'pinyin-tone-hanzi', text: entry.hanzi ?? '·' }),
      h('span', { class: 'pinyin-tone-gloss', text: entry.english ?? (hasAudio ? '' : t('pinyinchart.noAudio')) }),
    );
    return h('li', { class: 'pinyin-tone', 'data-tone': String(entry.tone) }, button);
  }

  /** Speak the character behind a tone (silently ignores audio-less tones). */
  async function play(entry) {
    if (!entry?.hanzi) return;
    const result = await speak(entry.hanzi, { lang: 'zh-CN' });
    if (state.destroyed) return;
    if (!result.ok) setStatus(result.reason === 'unsupported' ? 'pinyinchart.speakUnsupported' : 'pinyinchart.speakError');
    else setStatus(null);
  }

  /** Select a syllable: highlight its cell, show the four tones, play the first. */
  function select(syllable) {
    const record = state.chart?.syllables?.[syllable];
    if (!record) return false;
    state.selected = syllable;
    container.dataset.selected = syllable;

    for (const cell of table.querySelectorAll('.pinyin-cell')) {
      cell.setAttribute('aria-pressed', cell.dataset.syllable === syllable ? 'true' : 'false');
    }

    panelTitle.replaceChildren(h('span', { html: pinyinHtml(syllable) }));
    toneList.replaceChildren(...record.tones.map(toneRow));
    panel.hidden = false;
    setStatus(null);

    // "…and it sounds": play the first tone that actually has audio.
    const first = record.tones.find((entry) => entry.hanzi);
    if (first) play(first);
    return true;
  }

  function buildTable(chart) {
    const head = h('thead', {}, h('tr', {}, h('th', { class: 'pinyinchart-corner', scope: 'col', text: t('pinyinchart.cornerLabel') }),
      ...chart.finals.map((final) => h('th', { class: 'pinyinchart-final', scope: 'col', html: pinyinHtml(final) }))));

    const rows = chart.initials.map((initial) => {
      const label = initial === '' ? t('pinyinchart.noInitial') : initial;
      const cells = chart.finals.map((final) => {
        const syllable = syllableOf(initial, final);
        const record = chart.syllables[syllable];
        if (!record) return h('td', {}, h('span', { class: 'pinyin-empty', 'aria-hidden': 'true' }));
        const button = h('button', {
          type: 'button',
          class: 'pinyin-cell',
          'data-syllable': syllable,
          'aria-pressed': 'false',
          'aria-label': t('pinyinchart.cellLabel', { syllable }),
          onclick: () => select(syllable),
        });
        button.append(h('span', { html: pinyinHtml(syllable) }));
        return h('td', {}, button);
      });
      return h('tr', {}, h('th', { class: 'pinyinchart-initial', scope: 'row', html: pinyinHtml(label) }), ...cells);
    });

    table.replaceChildren(head, h('tbody', {}, ...rows));
  }

  async function load() {
    try {
      const chart = await loadChart();
      if (state.destroyed) return;
      state.chart = chart;
      buildTable(chart);
      container.dataset.state = 'ready';
      setStatus('pinyinchart.pickHint');
      const initial = ctx?.route?.segments?.[1];
      if (initial && chart.syllables[initial]) select(initial);
    } catch (err) {
      if (state.destroyed) return;
      console.error('pinyin-chart: load failed', err);
      container.dataset.state = 'error';
      reset(container).append(section);
      setStatus('pinyinchart.loadError');
    }
  }

  function destroy() {
    state.destroyed = true;
    if (container.pinyinApi) delete container.pinyinApi;
  }

  container.pinyinApi = {
    select: (syllable) => select(syllable),
    state: () => ({ state: container.dataset.state, selected: state.selected, syllables: Object.keys(state.chart?.syllables ?? {}).length }),
  };

  return { load, select, destroy };
}
