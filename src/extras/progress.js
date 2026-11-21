/**
 * Progress screen — #/extras/progress
 *
 * Study calendar (last 12 weeks), a weekly summary with a comparison against
 * the previous week, and the free streak freeze. Reads src/gamification.js
 * (getStats) and src/day.js only; the calendar is plain CSS grid (no chart
 * library). Blocked/locked states never rely on colour alone.
 *
 * Contract: `titleKey` + `render(container, ctx)` (see src/screens/extras.js).
 * No literal UI text: every string comes from t() with a progress.* key
 * (src/locales/{en,es}.d/progress.json).
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { getStats } from '../gamification.js';
import { localDayNumber, localDayKeyFromNumber, weekStartNumber } from '../day.js';

export const titleKey = 'hubs.extras.progress';
export const WEEKS = 12;

/** Singular/plural key selector: `<base>.one` / `<base>.other`. Pure. */
export function pluralKey(base, n) {
  return `${base}.${Number(n) === 1 ? 'one' : 'other'}`;
}

/** Event count -> intensity bucket 0..4 (0 = no study). Pure. */
export function dayIntensity(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n === 0) return 0;
  if (n === 1) return 1;
  if (n <= 3) return 2;
  if (n <= 6) return 3;
  return 4;
}

/** 'YYYY-MM-DD' -> local day number (no UTC drift). */
function dayNumberFromKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return localDayNumber(new Date(y, m - 1, d));
}

/**
 * 7 rows (Mon..Sun) x `weeks` columns, oldest -> newest, last column = the
 * current week. Cells: { day, date, count, intensity, future, today }. Pure.
 */
export function calendarRows(daysStudied, todayNumber, weeks = WEEKS) {
  const counts = new Map();
  for (const entry of daysStudied ?? []) counts.set(dayNumberFromKey(entry.date), entry.count ?? 0);
  const start = weekStartNumber(todayNumber) - (weeks - 1) * 7;
  const rows = Array.from({ length: 7 }, () => []);
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let w = 0; w < weeks; w += 1) {
      const day = start + w * 7 + weekday;
      const future = day > todayNumber;
      const count = counts.get(day) ?? 0;
      rows[weekday].push({
        day,
        date: localDayKeyFromNumber(day),
        count,
        intensity: future ? 0 : dayIntensity(count),
        future,
        today: day === todayNumber,
      });
    }
  }
  return rows;
}

/** Reviews this week vs last week -> { current, previous, delta, direction }. Pure. */
export function weekComparison(current = {}, previous = {}) {
  const cur = Math.max(0, Number(current.reviews) || 0);
  const prev = Math.max(0, Number(previous.reviews) || 0);
  const delta = cur - prev;
  return { current: cur, previous: prev, delta, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same' };
}

/** Freeze state for the current week: { available, usedDay }. Pure. */
export function freezeStatus(freezesUsed, todayNumber) {
  const week = weekStartNumber(todayNumber);
  const used = (freezesUsed ?? []).find((f) => f?.week === week) ?? null;
  return { available: !used, usedDay: used ? used.day : null };
}

const STYLE_ID = 'progress-style';
const CSS = `
.progress-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 3px; margin-top: 0.5rem; }
.progress-cell { aspect-ratio: 1; border-radius: 3px; background: var(--inset); }
.progress-cell[data-intensity="1"] { background: color-mix(in srgb, var(--accent) 30%, var(--surface)); }
.progress-cell[data-intensity="2"] { background: color-mix(in srgb, var(--accent) 55%, var(--surface)); }
.progress-cell[data-intensity="3"] { background: color-mix(in srgb, var(--accent) 78%, var(--surface)); }
.progress-cell[data-intensity="4"] { background: var(--accent); }
.progress-cell[data-future="true"] { background: transparent; box-shadow: inset 0 0 0 1px var(--line); }
.progress-cell[data-today="true"] { box-shadow: inset 0 0 0 2px var(--ink); }
.progress-legend { display: flex; align-items: center; gap: 0.35rem; margin-top: 0.6rem; color: var(--ink-soft); font-size: var(--fs-sm); }
.progress-swatch { width: 0.85rem; height: 0.85rem; border-radius: 3px; background: var(--inset); }
.progress-swatch[data-intensity="1"] { background: color-mix(in srgb, var(--accent) 30%, var(--surface)); }
.progress-swatch[data-intensity="2"] { background: color-mix(in srgb, var(--accent) 55%, var(--surface)); }
.progress-swatch[data-intensity="3"] { background: color-mix(in srgb, var(--accent) 78%, var(--surface)); }
.progress-swatch[data-intensity="4"] { background: var(--accent); }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

function calendarCard(rows, daysStudied) {
  const hasData = daysStudied.length > 0;
  const card = h('section', { class: 'card' }, h('h2', { text: t('progress.calendar.title') }));
  if (!hasData) {
    card.append(h('p', { class: 'hint', text: t('progress.calendar.empty') }));
    return card;
  }
  const grid = h(
    'div',
    {
      class: 'progress-grid',
      role: 'group',
      'data-role': 'calendar',
      'aria-label': t('progress.calendar.group', { days: daysStudied.length }),
    },
    ...rows.flat().map((cell) =>
      h('span', {
        class: 'progress-cell',
        'data-intensity': String(cell.intensity),
        'data-future': String(cell.future),
        'data-today': String(cell.today),
        role: 'img',
        'aria-label': t('progress.calendar.day', { date: cell.date, count: cell.count }),
      }),
    ),
  );
  const legend = h(
    'div',
    { class: 'progress-legend', 'aria-hidden': 'true' },
    h('span', { text: t('progress.calendar.legend.less') }),
    ...[0, 1, 2, 3, 4].map((level) => h('span', { class: 'progress-swatch', 'data-intensity': String(level) })),
    h('span', { text: t('progress.calendar.legend.more') }),
  );
  card.append(grid, legend);
  return card;
}

function summaryCard(week = {}) {
  const cmp = weekComparison(week.current, week.previous);
  const delta = String(cmp.delta);
  return h(
    'section',
    { class: 'card', 'data-role': 'week-summary' },
    h('h2', { text: t('progress.summary.title') }),
    h('p', { class: 'muted', text: t('progress.summary.reviews', { current: cmp.current }) }),
    h('p', { class: 'muted', 'data-role': 'week-compare', text: t(`progress.summary.compare.${cmp.direction}`, { delta }) }),
    h('p', { class: 'muted', text: t('progress.summary.points', { points: week.current?.points ?? 0 }) }),
  );
}

function freezeCard(freezesUsed, todayNumber) {
  const freeze = freezeStatus(freezesUsed, todayNumber);
  return h(
    'section',
    { class: 'card', 'data-role': 'freeze' },
    h('h2', { text: t('progress.freeze.title') }),
    h('p', {
      class: 'muted',
      'data-state': freeze.available ? 'available' : 'used',
      text: freeze.available ? t('progress.freeze.available') : t('progress.freeze.used', { date: freeze.usedDay }),
    }),
  );
}

export async function render(container, ctx) {
  ensureStyles(document);
  let stats;
  try {
    stats = await getStats();
  } catch (err) {
    console.error('progress screen', err);
    reset(container).append(h('p', { class: 'hint', text: t('progress.calendar.empty') }));
    return;
  }
  const today = localDayNumber(new Date());
  const daysStudied = stats.daysStudied ?? [];
  reset(container);
  const root = h(
    'section',
    { class: 'screen progress-screen' },
    calendarCard(calendarRows(daysStudied, today), daysStudied),
    summaryCard(stats.week),
    freezeCard(stats.freezesUsed, today),
  );
  container.append(root);
  container.dataset.state = daysStudied.length ? 'ready' : 'empty';
  container.focus({ preventScroll: true });
}
