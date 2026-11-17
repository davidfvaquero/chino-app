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
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { getDueCards, answer as saveAnswer, grade, RATINGS } from '../srs.js';
import { speak, isTtsAvailable } from '../audio.js';

export const titleKey = 'screens.review.title';

const BUTTON =
  'min-height:2.75rem;padding:0 0.75rem;border:1px solid var(--line);border-radius:var(--radius);' +
  'background:var(--bg);color:inherit;font:inherit;cursor:pointer';
const RATE_BUTTON =
  `${BUTTON};display:flex;flex-direction:column;align-items:center;justify-content:center;` +
  'gap:0.15rem;padding:0.4rem;font-size:0.875rem';
const HANZI = 'margin:0;font-size:3rem;line-height:1.25;font-weight:600';
const PINYIN = 'margin:0 0 0.25rem;font-size:1.125rem';

/**
 * Pure: how many days each rating would push the card out.
 * `{again, hard, good, easy}` — the numbers printed on the buttons.
 */
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

export function render(container, ctx = {}) {
  const state = { queue: [], index: 0, done: 0, flipped: false, busy: false, ready: false, alive: true };
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
    try {
      state.queue = await getDueCards();
    } catch (err) {
      console.error('review: cannot read the deck', err);
      state.queue = [];
    }
    if (!state.alive) return;
    state.ready = true;
    paint();
  }

  function paint() {
    if (!state.alive) return;
    root.replaceChildren();
    if (!state.ready) return root.append(h('p', { text: t('common.loading') }));
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
        h('p', { style: PINYIN, text: card.pinyin ?? '' }),
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
    root.append(
      h(
        'div',
        { class: 'card' },
        h('h2', { text: t(empty ? 'review.empty.title' : 'review.done.title') }),
        h('p', { text: empty ? t('review.empty.body') : t('review.done.body', { count: state.done }) }),
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
    root.append(actions);
  }

  load();
  return () => {
    state.alive = false;
  };
}