/**
 * Stats screen — #/extras/stats
 *
 * Summary cards + a hand-rolled SVG bar chart (no library) of the last 14 days.
 * Reads src/stats.js only, so it renders seeded data even when attach() has not
 * been wired up yet (attach lives in src/main.js, owned by the integration task).
 *
 * Contract: `titleKey` + `render(container, ctx)` (see src/main.js).
 * No literal UI text: every string comes from t() with a stats.* key
 * (src/locales/en.d/stats.json).
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { flush, getRange, getSummary } from '../stats.js';

export const titleKey = 'stats.title';
export const CHART_DAYS = 14;

const SVG_NS = 'http://www.w3.org/2000/svg';
const VB_W = 320; // logical chart width
const VB_H = 140;
const PAD_TOP = 16; // room for the value labels
const PAD_BOTTOM = 20; // room for the date labels
const PAD_X = 4;
const BAR_RATIO = 0.7;

const STYLE_ID = 'stats-style';
const CSS = `
.stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
.stats-card { text-align: center; padding: 0.6rem; }
.stats-value { font-size: 1.6rem; font-weight: 700; line-height: 1.2; }
.stats-label { font-size: 0.75rem; color: var(--ink-soft); letter-spacing: 0.05em; }
.stats-chart { margin-top: 0.75rem; }
.stats-svg { display: block; width: 100%; height: auto; }
.stats-bar { fill: var(--ink-soft); }
.stats-bar[data-today="true"] { fill: var(--accent); }
.stats-axis { stroke: var(--line); stroke-width: 1; }
.stats-text { fill: var(--ink-soft); font-size: 7px; text-anchor: middle; }
.stats-text-top { fill: var(--ink); font-size: 7px; font-weight: 600; text-anchor: middle; }
.stats-empty { text-align: center; color: var(--ink-soft); padding: 1.5rem 0; }
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
    node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) if (child) node.append(child);
  return node;
}

/** 'YYYY-MM-DD' -> 'MM/DD' for the x axis. */
const shortDate = (dateStr) => dateStr.slice(5).replace('-', '/');

/** One bar: rect + optional value label + date label + accessible title. */
function bar(day, index, { slot, barWidth, max }) {
  const minutes = day.minutes ?? 0;
  const x = PAD_X + index * slot + (slot - barWidth) / 2;
  const height = minutes > 0 ? Math.max(1, (minutes / max) * (VB_H - PAD_TOP - PAD_BOTTOM)) : 0;
  const baseline = VB_H - PAD_BOTTOM;
  const label = t('stats.chart.bar', { date: shortDate(day.date), minutes });

  return svgEl(
    'g',
    { class: 'stats-bar', 'data-date': day.date, 'data-minutes': minutes, 'data-today': String(index === 0) },
    svgEl('title', {}, label),
    svgEl('rect', {
      x: x.toFixed(1),
      y: (baseline - height).toFixed(1),
      width: barWidth.toFixed(1),
      height: height.toFixed(1),
      rx: 1,
    }),
    minutes > 0 ? svgEl('text', { class: 'stats-text-top', x: (x + barWidth / 2).toFixed(1), y: (baseline - height - 3).toFixed(1) }, minutes) : null,
    // Date under every other bar (14 labels would collide on a phone).
    index % 2 === 0 || index === CHART_DAYS - 1
      ? svgEl('text', { class: 'stats-text', x: (x + barWidth / 2).toFixed(1), y: VB_H - 6 }, shortDate(day.date))
      : null,
  );
}

/** Bar chart of `days` (newest first, so reversed to read left -> right). */
function chart(days) {
  const data = [...days].reverse();
  const max = Math.max(1, ...data.map((d) => d.minutes ?? 0));
  const slot = (VB_W - PAD_X * 2) / data.length;
  const barWidth = slot * BAR_RATIO;
  const baseline = VB_H - PAD_BOTTOM;

  return svgEl(
    'svg',
    {
      class: 'stats-svg',
      viewBox: `0 0 ${VB_W} ${VB_H}`,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': t('stats.chart.aria', { days: data.length, minutes: max }),
    },
    svgEl('line', { class: 'stats-axis', x1: PAD_X, y1: baseline, x2: VB_W - PAD_X, y2: baseline }),
    svgEl('text', { class: 'stats-text', x: PAD_X + 14, y: PAD_TOP - 6, 'text-anchor': 'start' }, t('stats.chart.axis', { minutes: max })),
    ...data.map((day, index) => bar(day, index, { slot, barWidth, max })),
  );
}

export async function render(container, ctx) {
  ensureStyles(document);

  await flush(); // persist anything attach() measured but has not written yet
  const [days, summary] = await Promise.all([getRange(CHART_DAYS), getSummary()]);

  reset(container);
  const root = h('section', { class: 'screen stats' });

  const cards = [
    ['stats.summary.known', summary.known],
    ['stats.summary.learning', summary.learning],
    ['stats.summary.total', summary.total],
    ['stats.summary.minutes', summary.minutesTotal],
    ['stats.summary.days', summary.daysStudied],
  ];
  root.append(
    h(
      'div',
      { class: 'stats-grid', 'data-known': String(summary.known), 'data-learning': String(summary.learning) },
      ...cards.map(([key, value]) =>
        h(
          'div',
          { class: 'card stats-card' },
          h('div', { class: 'stats-value', text: String(value) }),
          h('div', { class: 'stats-label', text: t(key) }),
        ),
      ),
    ),
  );

  const hasData = days.some((d) => (d.minutes ?? 0) > 0 || d.reviews || d.lessons || d.readings || d.strokes);
  const chartBox = h('section', { class: 'card stats-chart' }, h('h2', { text: t('stats.chart.title') }));
  chartBox.append(hasData ? chart(days) : h('p', { class: 'stats-empty', text: t('stats.chart.empty') }));
  root.append(chartBox);

  container.append(root);
  container.dataset.state = hasData ? 'ready' : 'empty';
  container.focus({ preventScroll: true });
}
