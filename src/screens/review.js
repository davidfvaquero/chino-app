/**
 * Review screen: the due-card queue.
 *
 * Builds on src/srs.js (SM-2 deck) and src/audio.js (TTS); no gamification
 * here — after every answer it dispatches a DOM event on `window` and another
 * module listens:
 *
 *   window.addEventListener('chino:review_done', (e) => e.detail)
 *   detail = { id, rating, interval, due, reviews, remaining }
 *
 * Flow: origin picker -> front (hanzi + audio) -> "show answer" -> back
 * (pinyin + meanings, audio) -> 4 rating buttons, each showing the next
 * interval. When the queue runs out the screen shows the empty state (nothing
 * was due) or the session summary. Rendering is local: `render()` reloads the
 * queue from storage.
 *
 * Filter: before starting, a picker lets the user choose "All" or one origin
 * (dictionary, lesson, theme, ...), with due counts. Choosing starts the
 * review with getDueCards({ source }). The choice is remembered in storage
 * settings (key 'reviewFilter') and highlighted next time. When nothing is due
 * anywhere the picker is skipped.
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { getDueCards, answer as saveAnswer, grade, countDueBySource, RATINGS } from '../srs.js';
import { speak, isTtsAvailable } from '../audio.js';
import { pinyinHtml } from '../tone.js';
import storage from '../storage.js';

export const titleKey = 'screens.review.title';

const BUTTON =
  'min-height:2.75rem;padding:0 0.75rem;border:1px solid var(--line);border-radius:var(--radius);' +
  'background:var(--bg);color:inherit;font:inherit;cursor:pointer';
const RATE_BUTTON =
  `${BUTTON};display:flex;flex-direction:column;align-items:center;justify-content:center;` +
  'gap:0.15rem;padding:0.4rem;font-size:0.875rem';
const HANZI = 'margin:0;font-size:3rem;line-height:1.25;font-weight:600';
const PINYIN = 'margin:0 0 0.25rem;font-size:1.125rem';

/** Pure: how many days each rating would push the card out.
 * `{again, hard, good, easy}` — the numbers printed on the buttons. */
export function previewIntervals(card, now = Date.now()) {
  const out = {};
  for (const rating of RATINGS) out[rating] = grade(card, rating, now).interval;
  return out;
}

/** Pure: text key + params for an interval in days ("1d", "2mo", "1y"). */
export function intervalText(days) {
  const n = Math.max(1, Math.round(Number(days) || 1));
  if (n >= 365) return { key: 'review.interval.years', params: { n: Math.round(n / 365) } };
  if (n >= 30) return { key: 'review.interval.months', params: { n: Math.round(n / 30) } };
  return { key: 'review.interval.days', params: { n } };
}

const FILTER_KEY = 'reviewFilter';

/** Pure: getDueCards options for a filter `{ source }` ('all' = no restriction). */
export function queryFor(filter, now = Date.now()) {
  return !filter || filter.source === 'all' ? { now } : { now, source: filter.source };
}

/** Saved filter from settings, or null when the user never chose one. */
export async function loadFilter() {
  try {
    const raw = await storage.get('settings', FILTER_KEY);
    return raw && typeof raw === 'object' && raw.source ? { source: raw.source } : null;
  } catch {
    return null;
  }
}

async function saveFilter(filter) {
  try {
    await storage.set('settings', FILTER_KEY, filter);
  } catch (err) {
    console.warn('review: could not save filter', err);
  }
}

/** Due cards per source: `{ [source]: n }`. */
async function getSourceCounts() {
  try {
    return await countDueBySource();
  } catch (err) {
    console.error('review: cannot count by source', err);
    return {};
  }
}

export function render(container, ctx = {}) {
  const state = { queue: [], index: 0, done: 0, flipped: false, busy: false, ready: false, alive: true, filter: null, counts: {}, saved: null };
  const go = (path) =>
    typeof ctx.navigate === 'function' ? ctx.navigate(path) : (location.hash = `#/${path}`);
  const root = h('section');
  reset(container).append(root);
  container.focus({ preventScroll: true });

  async function init() {
    state.counts = await getSourceCounts();
    state.saved = await loadFilter();
    if (!state.alive) return;
    // Nothing due anywhere: skip the picker, show the plain empty state.
    if (!Object.values(state.counts).some((c) => c > 0)) state.filter = { source: 'all' };
    return state.filter ? load() : paint();
  }

  async function load() {
    state.ready = false;
    state.queue = [];
    state.index = 0;
    state.done = 0;
    state.flipped = false;
    state.busy = false;
    paint();

    let cards;
    try {
      cards = await getDueCards(queryFor(state.filter));
    } catch (err) {
      console.error('review: cannot read the deck', err);
      cards = [];
    }

    if (!state.alive) return;
    state.queue = cards;
    state.ready = true;
    paint();
  }

  function pick(filter) {
    state.filter = filter;
    state.saved = filter;
    saveFilter(filter);
    load();
  }

  async function changeFilter() {
    state.counts = await getSourceCounts();
    if (!state.alive) return;
    state.filter = null;
    paint();
  }

  function paintPicker() {
    const sources = Object.entries(state.counts)
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = sources.reduce((n, [, c]) => n + c, 0);
    const option = (src, text) =>
      h('button', {
        type: 'button',
        style: `${BUTTON};width:100%;text-align:left;padding:0.75rem 1rem;${state.saved?.source === src ? 'background:var(--accent);color:var(--accent-fg);' : ''}`,
        text,
        dataset: { source: src },
        onclick: () => pick({ source: src }),
      });
    root.append(
      h('h2', { text: t('reviewFilter.title') }),
      h(
        'div',
        { style: 'display:flex;flex-direction:column;gap:0.5rem' },
        option('all', t('reviewFilter.all', { count: total })),
        ...sources.map(([src, count]) => {
          const key = `reviewFilter.source.${src}`;
          const label = t(key, { count });
          return option(src, label === key ? `${src} (${count})` : label);
        }),
      ),
    );
  }

  function paint() {
    if (!state.alive) return;
    root.replaceChildren();
    if (state.filter === null) return paintPicker();
    if (!state.ready) return root.append(h('p', { text: t('reviewFilter.loading') }));

    const card = state.queue[state.index];
    if (card) return paintCard(card);
    return paintEnd();
  }

  function audioButton(hanzi) {
    const available = isTtsAvailable();
    return h('button', {
      type: 'button',
      style: `${BUTTON};font-size:0.875rem`,
      title: available ? t('review.audio') : t('review.audioUnavailable'),
      disabled: !available,
      text: t('review.audio'),
      onclick: () => speak(hanzi),
    });
  }

  function paintCard(card) {
    const hanzi = card.hanzi ?? card.simp ?? '';
    const defs = card.defs ?? card.english ?? [];
    const remaining = state.queue.length - state.index;

    root.append(
      h(
        'div',
        { style: 'display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin:0 0 0.75rem' },
        h('span', { class: 'pill', text: t('review.remaining', { count: remaining }) }),
        audioButton(hanzi),
      ),
      h('div', { class: 'card', style: 'text-align:center' }, h('p', { style: HANZI, text: hanzi })),
    );

    if (!state.flipped) {
      root.append(
        h('button', {
          type: 'button',
          style: `${BUTTON};width:100%`,
          text: t('review.showAnswer'),
          onclick: () => {
            state.flipped = true;
            paint();
          },
        }),
      );
      return;
    }

    root.append(
      h(
        'div',
        { class: 'card' },
        h('p', { style: PINYIN, html: pinyinHtml(card.pinyin ?? '') }),
        ...(defs.length ? [h('p', { text: defs.join('; ') })] : []),
      ),
    );

    const preview = previewIntervals(card);
    root.append(
      h(
        'div',
        {
          role: 'group',
          'aria-label': t('review.rate'),
          style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem',
        },
        ...RATINGS.map((rating) => {
          const { key, params } = intervalText(preview[rating]);
          return h(
            'button',
            { type: 'button', style: RATE_BUTTON, dataset: { rating }, onclick: () => rate(card, rating) },
            h('span', { text: t(`review.ratings.${rating}`) }),
            h('span', { style: 'color:var(--fg-soft);font-size:0.75rem', text: t(key, params) }),
          );
        }),
      ),
    );
  }

  async function rate(card, rating) {
    if (state.busy) return;
    state.busy = true;
    let updated = null;
    try {
      updated = await saveAnswer(card.id, rating);
    } catch (err) {
      console.error('review: cannot save the answer', err);
    }
    if (!state.alive) return;
    state.done += 1;
    state.index += 1;
    state.flipped = false;
    state.busy = false;
    if (updated) {
      window.dispatchEvent(
        new CustomEvent('chino:review_done', {
          detail: {
            id: updated.id,
            rating,
            interval: updated.interval,
            due: updated.due,
            reviews: updated.reviews,
            remaining: Math.max(0, state.queue.length - state.index),
          },
        }),
      );
    }
    paint();
  }

  function paintEnd() {
    const empty = state.done === 0;
    const filtered = state.filter.source !== 'all';
    // A filtered empty group has its own text; plain empty keeps the original.
    const emptyKey = filtered ? 'reviewFilter.empty' : 'review.empty';

    root.append(
      h(
        'div',
        { class: 'card' },
        h('h2', { text: empty ? t(`${emptyKey}.title`) : t('review.done.title') }),
        h('p', { text: empty ? t(`${emptyKey}.body`) : t('review.done.body', { count: state.done }) }),
      ),
    );

    const actions = h('div', { style: 'display:flex;flex-wrap:wrap;gap:0.5rem' });
    if (!empty) {
      actions.append(h('button', { type: 'button', style: BUTTON, text: t('review.done.again'), onclick: load }));
    }
    actions.append(
      h('button', {
        type: 'button',
        style: BUTTON,
        text: t(empty ? 'review.empty.action' : 'review.done.action'),
        onclick: () => go('dictionary'),
      }),
    );
    if (filtered) {
      actions.append(
        h('button', { type: 'button', style: BUTTON, text: t('reviewFilter.empty.action'), onclick: changeFilter }),
      );
    }
    root.append(actions);
  }

  init();
  return () => {
    state.alive = false;
  };
}
