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
 * Flow: front (hanzi + audio) -> "show answer" -> back (pinyin + meanings,
 * audio) -> 4 rating buttons, each showing the next interval. When the queue
 * runs out the screen shows the empty state (nothing was due) or the session
 * summary. Rendering is local: `render()` reloads the queue from storage.
 *
 * Filter: before starting, a selector lets the user pick what to review:
 * "All" or by source (dictionary, lesson, theme, reading, strokes-sheet,
 * sentences, dictation...), and if data exists, by specific theme/lesson.
 * Shows due counts per group. The filter is remembered in storage settings
 * (key 'reviewFilter'). Default "All" behaves identically to the original.
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

/** Build the filter key stored in settings. */
const FILTER_KEY = 'reviewFilter';

/** Default filter = "all" (no source restriction). */
const DEFAULT_FILTER = { source: 'all' };

/** Normalize a stored filter to a valid shape. */
function normalizeFilter(raw) {
  if (!raw || typeof raw !== 'object') return DEFAULT_FILTER;
  const source = raw.source ?? 'all';
  const sourceDetail = raw.sourceDetail ?? null;
  return { source, sourceDetail };
}

/** Load the saved filter from settings. */
async function loadFilter() {
  try {
    const raw = await storage.get('settings', FILTER_KEY);
    return normalizeFilter(raw);
  } catch {
    return DEFAULT_FILTER;
  }
}

/** Save the filter to settings. */
async function saveFilter(filter) {
  try {
    await storage.set('settings', FILTER_KEY, filter);
  } catch (err) {
    console.warn('review: could not save filter', err);
  }
}

/** Get a display label for a source key. */
function sourceLabel(source) {
  switch (source) {
    case 'dictionary': return 'dictionary';
    case 'lesson': return 'lesson';
    case 'theme': return 'theme';
    case 'reading': return 'reading';
    case 'strokes-sheet': return 'strokesSheet';
    case 'sentences': return 'sentences';
    case 'dictation': return 'dictation';
    default: return source;
  }
}

/** Fetch all sources that have due cards, with counts. */
async function getSourceCounts() {
  try {
    return await countDueBySource();
  } catch (err) {
    console.error('review: cannot count by source', err);
    return {};
  }
}

/** Build the filter UI: shows "All" + sources with counts. Returns a Promise resolving to the chosen filter. */
async function chooseFilter(container, goBack) {
  const counts = await getSourceCounts();
  const saved = await loadFilter();

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const sources = Object.entries(counts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);

  return new Promise((resolve) => {
    const root = h('section');

    const renderOptions = () => {
      root.replaceChildren();

      const header = h('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin:0 0 1rem' },
        h('h2', { text: t('reviewFilter.title') }),
        h('button', {
          type: 'button',
          style: BUTTON,
          text: t('reviewFilter.back'),
          onclick: () => { resolve(null); goBack(); },
        })
      );
      root.append(header);

      const list = h('div', { style: 'display:flex;flex-direction:column;gap:0.5rem' });

      // "All" option
      const allActive = saved.source === 'all';
      list.append(h('button', {
        type: 'button',
        style: `${BUTTON};width:100%;text-align:left;padding:0.75rem 1rem;${allActive ? 'background:var(--accent);color:var(--accent-fg);' : ''}`,
        text: t('reviewFilter.all', { count: total }),
        onclick: () => resolve({ source: 'all' }),
      }));

      // Each source with due cards
      for (const [src, count] of sources) {
        const srcActive = saved.source === src && saved.sourceDetail === null;
        const labelKey = `reviewFilter.source.${src}`;
        const hasLabel = t(labelKey, { count }) !== labelKey;
        const label = hasLabel ? t(labelKey, { count }) : `${src} (${count})`;
        list.append(h('button', {
          type: 'button',
          style: `${BUTTON};width:100%;text-align:left;padding:0.75rem 1rem;${srcActive ? 'background:var(--accent);color:var(--accent-fg);' : ''}`,
          text: label,
          onclick: () => {
            if (src === 'unknown') {
              resolve({ source: 'unknown' });
            } else {
              // If this source has sourceDetail variants, offer sub-filter
              resolve({ source: src });
            }
          },
        }));
      }

      root.append(list);
    };

    renderOptions();
    reset(container).append(root);
    container.focus({ preventScroll: true });
  });
}

/** Build the sub-filter UI for a specific source (by sourceDetail). */
async function chooseSourceDetail(container, source, goBack) {
  const cards = await getDueCards({ source, now: Date.now() });
  const saved = await loadFilter();

  // Group by sourceDetail
  const detailCounts = {};
  for (const card of cards) {
    const key = card.sourceDetail ?? 'none';
    detailCounts[key] = (detailCounts[key] ?? 0) + 1;
  }

  const details = Object.entries(detailCounts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);

  return new Promise((resolve) => {
    const root = h('section');

    const renderOptions = () => {
      root.replaceChildren();

      const header = h('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin:0 0 1rem' },
        h('h2', { text: t('reviewFilter.detail.title', { source: t(`reviewFilter.source.${source}`) || source }) }),
        h('button', {
          type: 'button',
          style: BUTTON,
          text: t('reviewFilter.back'),
          onclick: () => { resolve({ action: 'back' }); },
        })
      );
      root.append(header);

      const list = h('div', { style: 'display:flex;flex-direction:column;gap:0.5rem' });

      // "All in this source" option
      const allActive = saved.source === source && saved.sourceDetail === null;
      list.append(h('button', {
        type: 'button',
        style: `${BUTTON};width:100%;text-align:left;padding:0.75rem 1rem;${allActive ? 'background:var(--accent);color:var(--accent-fg);' : ''}`,
        text: t('reviewFilter.detail.allInSource', { source: t(`reviewFilter.source.${source}`) || source, count: cards.length }),
        onclick: () => resolve({ source, sourceDetail: null }),
      }));

      // Each detail item
      for (const [detail, count] of details) {
        if (detail === 'none') continue; // skip cards without detail
        const detailActive = saved.source === source && saved.sourceDetail === detail;
        list.append(h('button', {
          type: 'button',
          style: `${BUTTON};width:100%;text-align:left;padding:0.75rem 1rem;${detailActive ? 'background:var(--accent);color:var(--accent-fg);' : ''}`,
          text: t('reviewFilter.detail.item', { name: detail, count }),
          onclick: () => resolve({ source, sourceDetail: detail }),
        }));
      }

      root.append(list);
    };

    renderOptions();
    reset(container).append(root);
    container.focus({ preventScroll: true });
  });
}

export function render(container, ctx = {}) {
  const state = { queue: [], index: 0, done: 0, flipped: false, busy: false, ready: false, alive: true, filter: null, filterStage: 'main' };
  const go = (path) =>
    typeof ctx.navigate === 'function' ? ctx.navigate(path) : (location.hash = `#/${path}`);
  const root = h('section');
  reset(container).append(root);
  container.focus({ preventScroll: true });

  async function load() {
    state.ready = false;
    state.queue = [];
    state.index = 0;
    state.done = 0;
    state.flipped = false;
    state.busy = false;
    paint();

    const filter = state.filter ?? await loadFilter();
    state.filter = filter;

    let cards;
    try {
      const opts = { now: Date.now() };
      if (filter.source !== 'all') {
        opts.source = filter.source;
        if (filter.sourceDetail !== undefined && filter.sourceDetail !== null) {
          opts.sourceDetail = filter.sourceDetail;
        }
      }
      cards = await getDueCards(opts);
    } catch (err) {
      console.error('review: cannot read the deck', err);
      cards = [];
    }

    if (!state.alive) return;
    state.queue = cards;
    state.ready = true;
    paint();
  }

  function paint() {
    if (!state.alive) return;
    root.replaceChildren();

    // If no filter chosen yet, show the filter picker
    if (state.filter === null) {
      showFilterPicker();
      return;
    }

    if (!state.ready) return root.append(h('p', { text: t('reviewFilter.loading') }));

    const card = state.queue[state.index];
    if (card) return paintCard(card);
    return paintEnd();
  }

  function showFilterPicker() {
    const goBack = () => { state.filter = null; paint(); };

    if (state.filterStage === 'main') {
      chooseFilter(container, goBack).then((chosen) => {
        if (!state.alive) return;
        if (chosen === null) {
          // User pressed back — go to dictionary
          go('dictionary');
          return;
        }
        state.filter = chosen;
        // If source has detail options, offer sub-filter
        if (chosen.source !== 'all' && chosen.source !== 'unknown') {
          state.filterStage = 'detail';
          paint();
        } else {
          // No detail needed, save and load
          saveFilter(chosen).then(load);
        }
      });
    } else if (state.filterStage === 'detail') {
      chooseSourceDetail(container, state.filter.source, goBack).then((result) => {
        if (!state.alive) return;
        if (result?.action === 'back') {
          state.filterStage = 'main';
          state.filter = null;
          paint();
          return;
        }
        state.filter = result;
        state.filterStage = 'main';
        saveFilter(result).then(load);
      });
    }
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
    const filter = state.filter ?? DEFAULT_FILTER;

    if (empty) {
      // Friendly empty state for the current filter
      let emptyKey = 'review.empty';
      if (filter.source !== 'all') {
        emptyKey = 'reviewFilter.empty';
      }
      const sourceName = filter.source !== 'all' && filter.source !== 'unknown'
        ? t(`reviewFilter.source.${filter.source}`) || filter.source
        : '';

      root.append(
        h(
          'div',
          { class: 'card' },
          h('h2', { text: t(`${emptyKey}.title`) }),
          h('p', { text: t(`${emptyKey}.body`, { source: sourceName }) }),
        ),
      );
    } else {
      root.append(
        h(
          'div',
          { class: 'card' },
          h('h2', { text: t('review.done.title') }),
          h('p', { text: t('review.done.body', { count: state.done }) }),
        ),
      );
    }

    const actions = h('div', { style: 'display:flex;flex-wrap:wrap;gap:0.5rem' });
    if (!empty) {
      actions.append(h('button', { type: 'button', style: BUTTON, text: t('review.done.again'), onclick: load }));
    }
    actions.append(
      h('button', {
        type: 'button',
        style: BUTTON,
        text: empty ? t('reviewFilter.empty.action') : t('review.done.action'),
        onclick: () => go('dictionary'),
      }),
    );
    // Add a "Change filter" button when a filter was applied
    if (filter.source !== 'all') {
      actions.append(
        h('button', {
          type: 'button',
          style: BUTTON,
          text: t('reviewFilter.empty.action'),
          onclick: () => { state.filter = null; state.filterStage = 'main'; paint(); },
        }),
      );
    }
    root.append(actions);
  }

  load();
  return () => {
    state.alive = false;
  };
}