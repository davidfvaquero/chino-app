/**
 * Read screen — graded readings with tap-a-word lookup and TTS.
 *
 * `#/read`          lists the readings (from the level index).
 * `#/read/<id>`     opens one: pinyin toggle, segmented tappable words, a
 *                   meaning panel with "add to review", per-line TTS and a
 *                   "mark as read" button that fires `chino:reading_done`.
 *
 * Contract: titleKey + render(container, ctx) — see src/main.js.
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import * as dictionary from '../dictionary.js';
import { addToReview } from '../srs.js';
import { speak, isTtsAvailable } from '../audio.js';
import { pinyinHtml } from '../tone.js';
import { normalizeReading, tokenizeLine, wordPanel, reviewEntryFrom } from '../reading/model.js';
import { loadIndex, loadReading } from '../reading/data.js';

export const titleKey = 'screens.read.title';

export async function render(container, ctx) {
  const id = ctx?.route?.segments?.[0];
  reset(container).append(h('p', { class: 'muted', text: t('read.loading') }));
  try {
    if (id) await renderReader(container, ctx, id);
    else await renderList(container, ctx);
  } catch (err) {
    console.error('read screen', err);
    reset(container).append(h('p', { class: 'error', text: t('read.error') }));
  }
}

async function renderList(container, ctx) {
  const readings = await loadIndex();
  reset(container);
  if (!readings.length) {
    container.append(h('p', { class: 'muted', text: t('read.empty') }));
    return;
  }
  container.append(
    h(
      'section',
      { class: 'menu', 'aria-label': t(titleKey) },
      ...readings.map((reading) =>
        h(
          'button',
          {
            type: 'button',
            class: 'card field',
            'data-reading': reading.id,
            onclick: () => ctx.navigate(`read/${reading.id}`),
          },
          h('span', { class: 'card-title', text: reading.title }),
          h('span', { class: 'muted', text: reading.topic }),
        ),
      ),
    ),
  );
  container.focus({ preventScroll: true });
}

async function renderReader(container, ctx, id) {
  const reading = normalizeReading(await loadReading(id));
  reset(container);

  const panel = h('aside', { class: 'word-panel', hidden: true, 'data-role': 'panel' });

  const showWord = async (word) => {
    const entry = await dictionary.lookup(word);
    const vm = wordPanel(word, entry);
    reset(panel);
    panel.hidden = false;
    panel.append(
      h('h3', { class: 'panel-hanzi', text: vm.hanzi }),
      vm.found
        ? h('p', { class: 'pinyin', html: pinyinHtml(vm.pinyin) })
        : h('p', { class: 'muted', text: t('read.notFound', { word }) }),
      ...(vm.english.length
        ? [h('ul', { class: 'defs' }, ...vm.english.map((d) => h('li', { text: d })))]
        : []),
      vm.found
        ? h('button', {
            type: 'button',
            class: 'cta',
            'data-action': 'add-review',
            text: t('read.addToReview'),
            onclick: async (event) => {
              const button = event.currentTarget;
              await addToReview(reviewEntryFrom(entry, 'reading'));
              button.disabled = true;
              button.textContent = t('read.added');
            },
          })
        : null,
      h('button', {
        type: 'button',
        class: 'pill',
        text: t('read.close'),
        onclick: () => {
          panel.hidden = true;
        },
      }),
    );
  };

  const ttsOk = isTtsAvailable();
  const lines = await Promise.all(
    reading.lines.map((line, index) => buildLine(line, index, ttsOk, showWord)),
  );

  const article = h('article', { class: 'reading', 'data-reading': reading.id }, ...lines);
  const pinyinButton = h('button', {
    type: 'button',
    class: 'pill',
    'data-action': 'toggle-pinyin',
    'aria-pressed': 'false',
    text: t('read.togglePinyin'),
    onclick: (event) => {
      const on = !article.classList.contains('show-pinyin');
      article.classList.toggle('show-pinyin', on);
      event.currentTarget.setAttribute('aria-pressed', String(on));
      // Toggle with `hidden` so the feature needs no stylesheet support.
      for (const el of article.querySelectorAll('.pinyin')) el.hidden = !on;
    },
  });

  container.append(
    h(
      'section',
      { class: 'reader' },
      h('h2', { text: reading.title }),
      h(
        'div',
        { class: 'row' },
        h('button', {
          type: 'button',
          class: 'pill',
          'data-action': 'back',
          text: t('read.back'),
          onclick: () => ctx.navigate('read'),
        }),
        pinyinButton,
        ttsOk
          ? h('button', {
              type: 'button',
              class: 'pill',
              'data-action': 'play-all',
              text: t('read.playAll'),
              onclick: () => speak(reading.lines.map((l) => l.hanzi).join(' ')),
            })
          : null,
      ),
      h('p', { class: 'muted', text: t('read.tapWord') }),
      article,
      panel,
      h('button', {
        type: 'button',
        class: 'cta',
        'data-action': 'done',
        text: t('read.markDone'),
        onclick: () => {
          window.dispatchEvent(
            new CustomEvent('chino:reading_done', {
              detail: { id: reading.id, title: reading.title },
            }),
          );
          ctx.navigate('read');
        },
      }),
    ),
  );
  container.focus({ preventScroll: true });
}

async function buildLine(line, index, ttsOk, showWord) {
  const tokens = await tokenizeLine(line.hanzi, dictionary.segment);
  const body = tokens.map((token) =>
    token.word
      ? h('button', {
          type: 'button',
          class: 'word',
          'data-word': token.text,
          text: token.text,
          onclick: () => showWord(token.text),
        })
      : h('span', { class: 'punct', text: token.text }),
  );
  return h(
    'div',
    { class: 'line', 'data-line': index + 1 },
    line.speaker ? h('span', { class: 'speaker', text: line.speaker }) : null,
    h('p', { class: 'hanzi' }, ...body),
    h('p', { class: 'pinyin', html: pinyinHtml(line.pinyin), hidden: true }),
    h('p', { class: 'english muted', text: line.english }),
    ttsOk
      ? h('button', {
          type: 'button',
          class: 'pill play',
          'data-action': 'play-line',
          'aria-label': t('read.playLine', { n: index + 1 }),
          text: '▶',
          onclick: () => speak(line.hanzi),
        })
      : null,
  );
}
