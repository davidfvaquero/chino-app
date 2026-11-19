/**
 * hardwords screen: `#/learn/hardwords`.
 * List of hard words (src/hardwords.js) with audio, coloured pinyin and meaning,
 * plus a "Practice" session (front/back, again/good via srs.answer) over just those.
 * Fires 'chino:review_done' after each answer, same detail as the review screen.
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { getHardWords } from '../hardwords.js';
import { answer as saveAnswer } from '../srs.js';
import { speak, isTtsAvailable } from '../audio.js';
import { pinyinHtml } from '../tone.js';

export const titleKey = 'hardwords.title';

const CSS = `
.hw-btn{min-height:2.75rem;padding:0 0.75rem;border:1px solid var(--line);border-radius:var(--r-md);background:var(--bg);color:inherit;font:inherit;cursor:pointer}
.hw-btn:disabled{opacity:.5;cursor:default}
.hw-row{display:flex;align-items:center;gap:0.75rem;margin:0 0 0.5rem}
.hw-row .hw-main{flex:1;min-width:0}
.hw-hanzi{margin:0;font-size:1.75rem;font-weight:600;line-height:1.25}
.hw-big{margin:0;font-size:3rem;font-weight:600;line-height:1.25;text-align:center}
.hw-sub{margin:0;color:var(--ink-soft);font-size:0.875rem}
.hw-bar{display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin:0 0 0.75rem}
.hw-rate{display:grid;grid-template-columns:1fr 1fr;gap:0.5rem}
`;

function injectCss() {
  if (document.getElementById('hardwords-style')) return;
  document.head.append(h('style', { id: 'hardwords-style', text: CSS }));
}

export function render(container) {
  injectCss();
  const state = { words: [], queue: [], index: 0, done: 0, flipped: false, busy: false, mode: 'load', alive: true };
  const root = h('section');
  reset(container).append(root);

  async function load() {
    state.mode = 'load';
    paint();
    try {
      state.words = await getHardWords();
    } catch (err) {
      console.error('hardwords: cannot read the deck', err);
      state.words = [];
    }
    state.mode = 'list';
    paint();
  }

  function paint() {
    if (!state.alive) return;
    root.replaceChildren();
    if (state.mode === 'load') return root.append(h('p', { text: t('common.loading') }));
    if (state.mode === 'practice') return paintPractice();
    return paintList();
  }

  const audioBtn = (hanzi) =>
    h('button', {
      type: 'button',
      class: 'hw-btn',
      title: isTtsAvailable() ? t('hardwords.audio') : t('hardwords.audioUnavailable'),
      disabled: !isTtsAvailable(),
      text: t('hardwords.audio'),
      onclick: () => speak(hanzi),
    });

  function paintList() {
    if (!state.words.length) {
      return root.append(
        h('div', { class: 'card' }, h('h2', { text: t('hardwords.empty.title') }), h('p', { text: t('hardwords.empty.body') })),
      );
    }
    root.append(
      h(
        'div',
        { class: 'hw-bar' },
        h('p', { class: 'hw-sub', text: t('hardwords.intro') }),
        h('button', {
          type: 'button',
          class: 'hw-btn',
          dataset: { action: 'practice' },
          text: t('hardwords.practice'),
          onclick: () => {
            state.queue = state.words.slice();
            state.index = 0;
            state.done = 0;
            state.flipped = false;
            state.mode = 'practice';
            paint();
          },
        }),
      ),
    );
    for (const w of state.words) {
      root.append(
        h(
          'div',
          { class: 'card hw-row', dataset: { id: w.id } },
          h(
            'div',
            { class: 'hw-main' },
            h('p', { class: 'hw-hanzi', text: w.hanzi ?? w.simp ?? '' }),
            h('p', { html: pinyinHtml(w.pinyin ?? '') }),
            h('p', { class: 'hw-sub', text: (w.defs ?? w.english ?? []).join('; ') }),
            h('p', { class: 'hw-sub', text: t('hardwords.misses', { count: w.lapses }) }),
          ),
          audioBtn(w.hanzi ?? w.simp ?? ''),
        ),
      );
    }
  }

  function paintPractice() {
    const card = state.queue[state.index];
    if (!card) {
      root.append(
        h(
          'div',
          { class: 'card' },
          h('h2', { text: t('hardwords.done.title') }),
          h('p', { text: t('hardwords.done.body', { count: state.done }) }),
        ),
        h('button', { type: 'button', class: 'hw-btn', text: t('hardwords.back'), onclick: load }),
      );
      return;
    }
    const hanzi = card.hanzi ?? card.simp ?? '';
    root.append(
      h(
        'div',
        { class: 'hw-bar' },
        h('span', { class: 'pill', text: t('hardwords.remaining', { count: state.queue.length - state.index }) }),
        audioBtn(hanzi),
      ),
      h('div', { class: 'card' }, h('p', { class: 'hw-big', text: hanzi })),
    );
    if (!state.flipped) {
      root.append(
        h('button', {
          type: 'button',
          class: 'hw-btn',
          style: 'width:100%',
          dataset: { action: 'show' },
          text: t('hardwords.showAnswer'),
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
        h('p', { html: pinyinHtml(card.pinyin ?? '') }),
        h('p', { text: (card.defs ?? card.english ?? []).join('; ') }),
      ),
      h(
        'div',
        { class: 'hw-rate' },
        ...['again', 'good'].map((rating) =>
          h('button', {
            type: 'button',
            class: 'hw-btn',
            dataset: { rating },
            text: t(`hardwords.${rating}`),
            onclick: () => rate(card, rating),
          }),
        ),
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
      console.error('hardwords: cannot save the answer', err);
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

  load();
  return () => {
    state.alive = false;
  };
}
