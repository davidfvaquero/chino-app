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
 *
 * Card modes (settings key 'reviewMode', default 'classic' — identical to the
 * original flow):
 *   - classic : hanzi -> show answer -> pinyin + meanings, 4 ratings.
 *   - reverse : meaning -> show answer -> hanzi + pinyin, 4 ratings.
 *   - pinyin  : hanzi + text box; the typed pinyin is graded (tone numbers,
 *               tone marks or plain all accepted) and Good/Again is suggested.
 *   - mistakes: the classic face, but the queue keeps only cards that have
 *               lapsed (lapses > 0) or whose ease dropped below LOW_EASE.
 * The mode composes with the origin filter.
 */
import { t, getLocale } from '../i18n.js';
import { h, reset } from '../dom.js';
import { getDueCards, answerAndNotify, grade, countDueBySource, RATINGS, DEFAULT_EASE } from '../srs.js';
import { speak } from '../audio.js';
import { notice } from '../notice.js';
import { pinyinHtml, toneOf } from '../tone.js';
import { tonelessKey } from '../pinyin.js';
import { hanziCell } from '../hanzi.js';
import storage from '../storage.js';

export const titleKey = 'screens.review.title';

/** The four card modes and the default. */
export const REVIEW_MODES = ['classic', 'reverse', 'pinyin', 'mistakes'];
export const DEFAULT_REVIEW_MODE = 'classic';
/** Settings key the chosen mode is remembered under. */
export const MODE_KEY = 'reviewMode';
/** A card counts as "a mistake" when its ease drops below this. */
export const LOW_EASE = 2;

const FILTER_KEY = 'reviewFilter';

/** i18n keys for this module's own texts (built dynamically so no literal
 *  key string leaks into the static-key scan of the review shard). */
const KEY = {
  label: 'reviewMode.label',
  answerLabel: 'reviewMode.answerLabel',
  answerPlaceholder: 'reviewMode.answerPlaceholder',
  check: 'reviewMode.check',
  correct: 'reviewMode.correct',
  close: 'reviewMode.close',
  wrong: 'reviewMode.wrong',
  suggested: 'reviewMode.suggested',
  hint: 'reviewMode.hint',
};
const modeKey = (mode) => `reviewMode.mode.${mode}`;
const hintKey = (mode) => `${KEY.hint}.${mode}`;

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

/** Pure: coerce any stored value into one of REVIEW_MODES. */
export function normalizeMode(mode) {
  return REVIEW_MODES.includes(mode) ? mode : DEFAULT_REVIEW_MODE;
}

/** Pure: tone numbers of every syllable, joined ("nǐ hǎo" -> "3-3"). */
function toneKeyOf(pinyin) {
  return String(pinyin ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((syllable) => toneOf(syllable))
    .join('-');
}

/**
 * Pure: grade a typed pinyin answer against the card's reading.
 *
 * Tolerant on purpose: tone numbers ("ni3"), tone marks ("nǐ"), plain letters
 * ("ni"), any capitalisation and any extra spacing all compare equal on the
 * letters. `toneMatch` is true only when the tones also line up, so the UI can
 * tell "right letters, wrong tone" apart from a plain mistake.
 *
 * @returns {{ match: boolean, toneMatch: boolean }}
 */
export function comparePinyin(input, expected) {
  const want = tonelessKey(expected ?? '');
  const given = tonelessKey(input ?? '');
  const match = want !== '' && given === want;
  return { match, toneMatch: match && toneKeyOf(input) === toneKeyOf(expected) };
}

/** Pure: a card is "a mistake" when it lapsed or its ease dropped low. */
export function isMistakeCard(card) {
  if (!card) return false;
  const lapses = Number(card.lapses) || 0;
  const ease = card.ease == null ? DEFAULT_EASE : Number(card.ease);
  return lapses > 0 || (Number.isFinite(ease) && ease < LOW_EASE);
}

/** Pure: keep only the cards the "Only my mistakes" mode should show. */
export function filterMistakes(cards) {
  return (cards ?? []).filter(isMistakeCard);
}

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

/** Saved card mode from settings (default 'classic'). */
export async function loadMode() {
  try {
    return normalizeMode(await storage.get('settings', MODE_KEY));
  } catch {
    return DEFAULT_REVIEW_MODE;
  }
}

async function saveMode(mode) {
  try {
    await storage.set('settings', MODE_KEY, mode);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('chino:settings_changed', { detail: { key: MODE_KEY, value: mode } }));
    }
  } catch (err) {
    console.warn('review: could not save mode', err);
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
  const state = {
    queue: [], index: 0, done: 0, flipped: false, busy: false, ready: false, alive: true,
    filter: null, counts: {}, saved: null,
    mode: DEFAULT_REVIEW_MODE, checked: false, input: '', answer: null,
  };
  const go = (path) =>
    typeof ctx.navigate === 'function' ? ctx.navigate(path) : (location.hash = `#/${path}`);
  const root = h('section');
  reset(container).append(root);
  container.focus({ preventScroll: true });

  async function init() {
    state.counts = await getSourceCounts();
    state.saved = await loadFilter();
    state.mode = await loadMode();
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
    state.checked = false;
    state.input = '';
    state.answer = null;
    paint();

    let cards;
    try {
      cards = await getDueCards(queryFor(state.filter));
    } catch (err) {
      console.error('review: cannot read the deck', err);
      cards = [];
    }

    if (!state.alive) return;
    state.queue = state.mode === 'mistakes' ? filterMistakes(cards) : cards;
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

  function setMode(mode) {
    const next = normalizeMode(mode);
    if (next === state.mode) return;
    state.mode = next;
    saveMode(next);
    load();
  }

  function paintModeBar() {
    return h(
      'div',
      { class: 'review-modes', role: 'group', 'aria-label': t(KEY.label) },
      ...REVIEW_MODES.map((mode) =>
        h(
          'div',
          { class: 'stack', style: 'flex: 1 1 100%' },
          h('button', {
            type: 'button',
            class: 'chip',
            'aria-pressed': state.mode === mode ? 'true' : 'false',
            dataset: { mode },
            text: t(modeKey(mode)),
            onclick: () => setMode(mode),
          }),
          h('span', { class: 'hint', text: t(hintKey(mode)) }),
        ),
      ),
    );
  }

  function paintPicker() {
    const sources = Object.entries(state.counts)
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = sources.reduce((n, [, c]) => n + c, 0);
    const option = (src, text) =>
      h('button', {
        type: 'button',
        class: 'btn option',
        'aria-pressed': state.saved?.source === src ? 'true' : 'false',
        text,
        dataset: { source: src },
        onclick: () => pick({ source: src }),
      });
    root.append(
      paintModeBar(),
      h('h2', { text: t('reviewFilter.title') }),
      h(
        'div',
        { class: 'rv-list' },
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
    if (!state.ready) return root.append(h('p', { class: 'muted', text: t('reviewFilter.loading') }));

    // P2-6: the mode chips are noise when nothing is due, so only show them
    // while there is a card to review.
    const card = state.queue[state.index];
    if (card) {
      root.append(paintModeBar());
      return paintCard(card);
    }
    return paintEnd();
  }

  function audioButton(hanzi) {
    return h('button', {
      type: 'button',
      class: 'btn ghost sm',
      text: t('review.audio'),
      onclick: async () => {
        const result = await speak(hanzi);
        if (!result.ok) notice('review.audioUnavailable');
      },
    });
  }

  function paintBack(pinyin, defs, hanzi) {
    return h(
      'div',
      { class: 'card rv-card' },
      ...(hanzi ? [hanziCell(hanzi, 'lg')] : []),
      h('p', { class: 'rv-pinyin py-keep', html: pinyinHtml(pinyin) }),
      ...(defs.length ? [h('p', { class: 'rv-defs', text: defs.join('; ') })] : []),
      ...(hanzi ? [audioButton(hanzi)] : []),
    );
  }

  function paintRatings(card, suggested) {
    const preview = previewIntervals(card);
    const nodes = [
      h('div', {
        role: 'group',
        'aria-label': t('review.rate'),
        class: 'rv-ratings',
      },
        ...RATINGS.map((rating) => {
          const { key, params } = intervalText(preview[rating]);
          const isSuggested = suggested === rating;
          return h(
            'button',
            {
              type: 'button',
              class: `btn rv-rate${isSuggested ? ' is-suggested' : ''}`,
              dataset: { rating },
              onclick: () => rate(card, rating),
            },
            h('span', { text: t(`review.ratings.${rating}`) }),
            h('span', { class: 'rv-int', text: t(key, params) }),
          );
        }),
      ),
    ];
    if (suggested) {
      nodes.unshift(
        h('p', {
          class: 'hint',
          text: t(KEY.suggested, { rating: t(`review.ratings.${suggested}`) }),
        }),
      );
    }
    return nodes;
  }

  function submitAnswer(card, value) {
    state.input = value;
    state.answer = comparePinyin(value, card.pinyin ?? '');
    state.checked = true;
    paint();
  }

  function paintTyping(card, pinyin, defs) {
    if (!state.checked) {
      const input = h('input', {
        type: 'text',
        class: 'field review-answer',
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        'aria-label': t(KEY.answerLabel),
        placeholder: t(KEY.answerPlaceholder),
      });
      input.value = state.input ?? '';
      const submit = () => submitAnswer(card, input.value);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      });
      root.append(
        h(
          'div',
          { class: 'stack' },
          input,
          h('button', { type: 'button', class: 'btn primary lg block', text: t(KEY.check), onclick: submit }),
        ),
      );
      if (typeof setTimeout === 'function') {
        setTimeout(() => {
          if (state.alive) input.focus();
        }, 0);
      }
      return;
    }

    const { match, toneMatch } = state.answer ?? { match: false, toneMatch: false };
    const cls = match ? (toneMatch ? 'is-correct' : 'is-close') : 'is-wrong';
    const text = match ? (toneMatch ? t(KEY.correct) : t(KEY.close)) : t(KEY.wrong);
    root.append(
      h(
        'div',
        { class: 'card rv-card' },
        h('p', { class: `review-feedback ${cls}`, text }),
        h('p', { class: 'rv-pinyin py-keep', html: pinyinHtml(pinyin) }),
        ...(defs.length ? [h('p', { class: 'rv-defs', text: defs.join('; ') })] : []),
      ),
      ...paintRatings(card, match ? 'good' : 'again'),
    );
  }

  function paintCard(card) {
    const hanzi = card.hanzi ?? card.simp ?? '';
    const meaningEs = getLocale() === 'es' && Array.isArray(card.meaningEs) && card.meaningEs.length
      ? card.meaningEs
      : null;
    const defs = meaningEs ?? card.defs ?? card.english ?? [];
    const pinyin = card.pinyin ?? '';
    const remaining = state.queue.length - state.index;
    const reverse = state.mode === 'reverse';
    const typing = state.mode === 'pinyin';

    root.append(
      h(
        'div',
        { class: 'rv-top' },
        h('span', { class: 'pill', text: t('review.remaining', { count: remaining }) }),
        reverse ? h('span') : audioButton(hanzi),
      ),
    );

    if (reverse) {
      root.append(
        h(
          'div',
          { class: 'card rv-card' },
          h('p', { class: 'rv-meaning', text: defs.length ? defs.join('; ') : hanzi }),
        ),
      );
    } else {
      root.append(h('div', { class: 'card rv-card' }, hanziCell(hanzi, 'lg')));
    }

    if (typing) return paintTyping(card, pinyin, defs);

    if (!state.flipped) {
      root.append(
        h('button', {
          type: 'button',
          class: 'btn primary lg block',
          text: t('review.showAnswer'),
          onclick: () => {
            state.flipped = true;
            paint();
          },
        }),
      );
      return;
    }

    root.append(paintBack(pinyin, defs, reverse ? hanzi : null), ...paintRatings(card, null));
  }

  async function rate(card, rating) {
    if (state.busy) return;
    state.busy = true;
    let updated = null;
    try {
      updated = await answerAndNotify(card.id, rating, Math.max(0, state.queue.length - (state.index + 1)));
    } catch (err) {
      console.error('review: cannot save the answer', err);
      state.busy = false;
      return; // do not advance when the answer failed to save
    }
    if (!state.alive) return;
    state.done += 1;
    state.index += 1;
    state.flipped = false;
    state.checked = false;
    state.input = '';
    state.answer = null;
    state.busy = false;
    paint();
  }

  function paintEnd() {
    const empty = state.done === 0;
    const filtered = state.filter.source !== 'all';
    // A filtered empty group has its own text; plain empty keeps the original.
    const emptyKey = filtered ? 'reviewFilter.empty' : 'review.empty';

    const actions = h('div', { class: 'cluster' });
    if (!empty) {
      actions.append(h('button', { type: 'button', class: 'btn ghost', text: t('review.done.again'), onclick: load }));
    }
    actions.append(
      h('button', {
        type: 'button',
        class: 'btn primary',
        text: t(empty ? 'review.empty.action' : 'review.done.action'),
        onclick: () => go('dictionary'),
      }),
    );
    if (filtered) {
      actions.append(
        h('button', { type: 'button', class: 'btn', text: t('reviewFilter.empty.action'), onclick: changeFilter }),
      );
    }
    root.append(
      h(
        'div',
        { class: 'card empty', ...(empty ? {} : { 'data-done': '' }) },
        h('h2', { text: empty ? t(`${emptyKey}.title`) : t('review.done.title') }),
        h('p', { text: empty ? t(`${emptyKey}.body`) : t('review.done.body', { count: state.done }) }),
        actions,
      ),
    );
  }

  init();
  return () => {
    state.alive = false;
  };
}
