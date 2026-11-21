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
import { t, getLocale } from '../i18n.js';
import { h, reset } from '../dom.js';
import * as dictionary from '../dictionary.js';
import { addToReview } from '../srs.js';
import { speak, isTtsAvailable } from '../audio.js';
import { pinyinHtml } from '../tone.js';
import { pinyinToggle, getSettings, setSetting } from '../settings.js';
import { normalizeReading, tokenizeLine, wordPanel, reviewEntryFrom } from '../reading/model.js';
import { loadIndex, loadReading, LEVELS, DEFAULT_LEVEL, normalizeLevel } from '../reading/data.js';

export const titleKey = 'screens.read.title';

/** Picker labels per level; unknown levels use `home.level.<name>`. */
const LEVEL_LABEL_KEYS = { hsk2: 'hsk2.level', hsk3: 'hsk3.level' };

/** Hash path for the list (`read`) or one reading, keeping the level. */
const readPath = (level, id) => {
  const path = id ? `read/${id}` : 'read';
  return level === DEFAULT_LEVEL ? path : `${path}?level=${level}`;
};

/**
 * Level for this render: `?level=` wins (and is remembered), else the stored
 * `readingLevel`, else hsk1 — so old `#/read` and `#/read/<id>` links work.
 */
async function resolveLevel(ctx) {
  const requested = ctx?.route?.params?.level;
  if (LEVELS.includes(requested)) {
    setSetting('readingLevel', requested).catch(() => {});
    return requested;
  }
  try {
    return normalizeLevel((await getSettings()).readingLevel);
  } catch {
    return DEFAULT_LEVEL;
  }
}

export async function render(container, ctx) {
  const id = ctx?.route?.segments?.[0];
  reset(container).append(h('p', { class: 'muted', text: t('read.loading') }));
  try {
    const level = await resolveLevel(ctx);
    if (id) await renderReader(container, ctx, id, level);
    else await renderList(container, ctx, level);
  } catch (err) {
    console.error('read screen', err);
    reset(container).append(h('p', { class: 'error', text: t('read.error') }));
  }
}

async function renderList(container, ctx, level) {
  const readings = await loadIndex(level);
  reset(container);
  const picker = h(
    'div',
    { class: 'level-picker', role: 'group', 'aria-label': t('home.level.label') },
    ...LEVELS.map((name) =>
      h('button', {
        type: 'button',
        class: 'btn option',
        'data-level': name,
        'aria-pressed': String(name === level),
        text: t(LEVEL_LABEL_KEYS[name] ?? `home.level.${name}`),
        onclick: () => ctx.navigate(`read?level=${name}`),
      }),
    ),
  );
  if (!readings.length) {
    container.append(picker, h('p', { class: 'muted', text: t('read.empty') }));
    return;
  }
  container.append(
    picker,
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
            onclick: () => ctx.navigate(readPath(level, reading.id)),
          },
          h('span', { class: 'card-title', text: reading.title }),
          ...(reading.pinyin ? [h('span', { class: 'hint', html: pinyinHtml(reading.pinyin) })] : []),
          h('span', { class: 'muted', text: reading.topic }),
        ),
      ),
    ),
  );
  container.focus({ preventScroll: true });
}

async function renderReader(container, ctx, id, level) {
  // A pre-defined id whose file has not been written yet is normal ("coming
  // soon"); a network failure offline is not, and saying "coming soon" would be
  // a lie (REVIEW-3 I9). fetchData throws a TypeError only when the fetch itself
  // fails, so that is the offline case.
  let raw = null;
  let offline = false;
  try {
    raw = await loadReading(id, { level });
  } catch (err) {
    offline = err instanceof TypeError;
  }
  if (!raw) {
    reset(container).append(
      h('p', { class: offline ? 'error' : 'muted', text: t(offline ? 'common.offline' : 'common.comingSoon') }),
      h('button', { type: 'button', class: 'btn', text: t('read.back'), onclick: () => ctx.navigate(readPath(level)) }),
    );
    return;
  }
  const reading = normalizeReading(raw);
  reset(container);

  const panel = h('aside', { class: 'word-panel', hidden: true, 'data-role': 'panel' });

  const showWord = async (word) => {
    const entry = await dictionary.lookup(word, { spanish: getLocale() === 'es' });
    const vm = wordPanel(word, entry);
    const spanish = getLocale() === 'es' ? dictionary.distinctDefs(vm.spanish) : [];
    let defsNodes;
    if (spanish.length) {
      // Spanish first, the English original behind a discreet per-entry toggle.
      const english = dictionary.distinctDefs(vm.english);
      const englishBox = h(
        'div',
        { class: 'defs-en', hidden: true },
        h('ul', { class: 'defs' }, ...english.map((d) => h('li', { text: d }))),
      );
      const toggle = h('button', {
        type: 'button',
        class: 'btn ghost sm',
        'data-action': 'toggle-english',
        'aria-expanded': 'false',
        text: t('read.showEnglish'),
        onclick: () => {
          const open = englishBox.hidden;
          englishBox.hidden = !open;
          toggle.setAttribute('aria-expanded', String(open));
          toggle.textContent = t(open ? 'read.hideEnglish' : 'read.showEnglish');
        },
      });
      defsNodes = [
        h('ul', { class: 'defs defs-es' }, ...spanish.map((d) => h('li', { text: d }))),
        h('p', { class: 'hint panel-note', text: t('read.machineTranslation') }),
        toggle,
        englishBox,
      ];
    } else {
      defsNodes = vm.english.length
        ? [h('ul', { class: 'defs' }, ...vm.english.map((d) => h('li', { text: d })))]
        : [];
    }

    reset(panel);
    panel.hidden = false;
    panel.append(
      h('h3', { class: 'panel-hanzi', text: vm.hanzi }),
      vm.found
        ? h('p', { class: 'pinyin py-keep', html: pinyinHtml(vm.pinyin) })
        : h('p', { class: 'muted', text: t('read.notFound', { word }) }),
      ...defsNodes,
      vm.found
        ? h('button', {
            type: 'button',
            class: 'btn primary',
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
        class: 'btn ghost sm',
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
  const pinyinButton = pinyinToggle();

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
          class: 'btn ghost sm',
          'data-action': 'back',
          text: t('read.back'),
          onclick: () => ctx.navigate(readPath(level)),
        }),
        pinyinButton,
        ttsOk
          ? h('button', {
              type: 'button',
              class: 'btn ghost sm',
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
        class: 'btn primary lg block',
        'data-action': 'done',
        text: t('read.markDone'),
        onclick: () => {
          window.dispatchEvent(
            new CustomEvent('chino:reading_done', {
              detail: { id: reading.id, title: reading.title, level },
            }),
          );
          ctx.navigate(readPath(level));
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
    line.speaker ? h('span', { class: 'speaker', 'aria-label': t('read.speaker', { name: line.speaker }), text: line.speaker }) : null,
    h('p', { class: 'hanzi' }, ...body),
    h('p', { class: 'pinyin', html: pinyinHtml(line.pinyin) }),
    h('p', { class: 'english muted', text: line.english }),
    ttsOk
      ? h('button', {
          type: 'button',
          class: 'btn sm play',
          'data-action': 'play-line',
          'aria-label': t('read.playLine', { n: index + 1 }),
          text: '▶',
          onclick: () => speak(line.hanzi),
        })
      : null,
  );
}
