/**
 * Dictionary screen — search CC-CEDICT (src/dictionary.js) and send words to
 * the review deck (src/srs.js). Audio via src/audio.js.
 *
 * Contract: `titleKey` + `render(container, ctx)` (see src/main.js). No literal
 * UI text: every string comes from t() with a dict.* key
 * (src/locales/en.d/dict.json).
 *
 * Testability hooks on the container element:
 *   container.dataset.state  = 'empty' | 'loading' | 'none' | 'results' | 'error'
 *   .dict-row[data-id]       one per result, data-added="true" when in the deck
 *   .dict-add[data-added]    the "Add to review" button
 */
import { t, getLocale } from '../i18n.js';
import { h, reset } from '../dom.js';
import { href } from '../router.js';
import { search, distinctDefs } from '../dictionary.js';
import { addToReview, listCards, cardId } from '../srs.js';
import { speak } from '../audio.js';
import { pinyinHtml } from '../tone.js';
import { fetchData } from '../data-url.js';

export const titleKey = 'screens.dictionary.title';

/** Wait this long after the last keystroke before searching. */
export const DEBOUNCE_MS = 250;
/** Max results shown for one query. */
export const RESULT_LIMIT = 20;

/** HSK levels whose Spanish word lists carry a gloss per hanzi. */
const GLOSS_LEVELS = [1, 2, 3];
/** hanzi -> Spanish gloss, loaded once per session (only when the UI is es). */
let glossMap = null;

/** Spanish glosses already translated in the HSK word lists (data/es/hsk). */
function loadGlosses() {
  if (!glossMap) {
    glossMap = Promise.all(
      GLOSS_LEVELS.map((level) => fetchData(`hsk/${level}.json`).catch(() => null)),
    ).then((lists) => {
      const map = new Map();
      for (const list of lists) {
        for (const word of list?.items ?? []) {
          if (word?.hanzi && word?.english) map.set(word.hanzi, word.english);
        }
      }
      return map;
    });
  }
  return glossMap;
}

/** Ids already in the review deck (so a result can render as "added"). */
async function deckIds() {
  try {
    return new Set((await listCards()).map((card) => card.id));
  } catch (err) {
    console.error('dictionary: cannot read the deck', err);
    return new Set();
  }
}

export function render(container, ctx = {}) {
  const state = { seq: 0, timer: null, alive: true };

  const input = h('input', {
    type: 'search',
    class: 'field',
    name: 'q',
    autocomplete: 'off',
    'aria-label': t('dict.searchLabel'),
    placeholder: t('dict.placeholder'),
  });
  const status = h('p', {
    class: 'pill dict-status',
    role: 'status',
    'aria-live': 'polite',
    hidden: true,
  });
  const list = h('ul', { class: 'dict-results', 'aria-label': t('dict.results') });
  const form = h(
    'form',
    {
      class: 'dict-search',
      onsubmit: (event) => {
        event.preventDefault();
        clearTimeout(state.timer);
        run(input.value.trim());
      },
    },
    input,
  );

  reset(container).append(h('section', { class: 'dict' }, form, status, list));
  container.focus({ preventScroll: true });

  const setState = (name) => {
    container.dataset.state = name;
  };
  const setStatus = (key, params) => {
    status.textContent = key ? t(key, params) : '';
    status.hidden = !key;
  };

  /** One result row: hanzi (simp/trad), pinyin, meanings, audio, strokes, add. */
  function row(entry, isAdded, gloss = '') {
    const hanzi = entry.simp || entry.trad || '';
    const audio = h('button', {
      type: 'button',
      class: 'btn ghost sm dict-audio',
      text: t('dict.audio'),
      'aria-label': t('dict.audioFor', { hanzi }),
      onclick: async () => {
        const result = await speak(hanzi);
        if (!result.ok) {
          setStatus(result.reason === 'empty' ? 'dict.audioEmpty' : 'dict.audioUnavailable');
        }
      },
    });

    const add = h('button', {
      type: 'button',
      class: 'btn sm dict-add',
      text: t(isAdded ? 'dict.added' : 'dict.addToReview'),
      disabled: isAdded,
      'data-added': String(Boolean(isAdded)),
      onclick: async () => {
        add.disabled = true;
        try {
          await addToReview({
            id: entry.id,
            simp: entry.simp,
            trad: entry.trad,
            pinyin: entry.pinyinTone,
            pinyinNumeric: entry.pinyinNum,
            defs: entry.defs,
            source: 'dict',
          });
          add.textContent = t('dict.added');
          add.dataset.added = 'true';
          node.dataset.added = 'true';
          setStatus('dict.addedToReview', { hanzi });
        } catch (err) {
          console.error('dictionary: add to review failed', err);
          add.disabled = false;
          setStatus('dict.addError');
        }
      },
    });

    const strokes = [...hanzi].map((char) =>
      h('a', {
        class: 'dict-strokes',
        href: href(`learn/strokes/${encodeURIComponent(char)}`),
        'data-hanzi': char,
        'aria-label': t('dict.strokesFor', { char }),
        text: char,
      }),
    );

    const defs = distinctDefs(entry.defs);
    const node = h(
      'li',
      {
        class: 'dict-row',
        'data-id': String(entry.id),
        'data-added': String(Boolean(isAdded)),
      },
      h(
        'div',
        { class: 'dict-head' },
        h('span', { class: 'dict-hanzi', text: hanzi }),
        audio,
      ),
      h('p', { class: 'dict-pinyin', html: pinyinHtml(entry.pinyinTone || entry.pinyinNum || '') }),
      // A Spanish gloss already translated in the lesson data wins over the
      // English CC-CEDICT ones; the English list stays, labelled.
      ...(gloss ? [h('p', { class: 'dict-gloss', text: gloss })] : []),
      ...(defs.length && getLocale() !== 'en'
        ? [h('p', { class: 'hint', text: t('dict.defsEnglish') })]
        : []),
      h('ul', { class: 'dict-defs' }, ...defs.map((def) => h('li', { text: def }))),
      h('div', { class: 'dict-actions' }, ...strokes, add),
    );
    return node;
  }

  async function run(query) {
    const seq = (state.seq += 1);
    list.replaceChildren();
    if (!query) {
      setState('empty');
      setStatus('dict.empty');
      return;
    }
    setState('loading');
    setStatus('dict.loading');

    let results;
    try {
      results = await search(query, { limit: RESULT_LIMIT });
    } catch (err) {
      if (seq !== state.seq || !state.alive) return;
      console.error('dictionary: search failed', err);
      setState('error');
      setStatus('dict.error');
      return;
    }
    if (seq !== state.seq || !state.alive) return;

    if (!results.length) {
      setState('none');
      setStatus('dict.noResults', { query });
      return;
    }

    const added = await deckIds();
    if (seq !== state.seq || !state.alive) return;

    const glosses = getLocale() === 'es' ? await loadGlosses().catch(() => null) : null;
    if (seq !== state.seq || !state.alive) return;

    setState('results');
    setStatus(null);
    list.replaceChildren(
      ...results.map((entry) =>
        row(entry, added.has(cardId(entry)), glosses?.get(entry.simp || entry.trad) ?? ''),
      ),
    );
  }

  input.addEventListener('input', () => {
    clearTimeout(state.timer);
    const query = input.value.trim();
    if (!query) {
      run('');
      return;
    }
    state.timer = setTimeout(() => run(query), DEBOUNCE_MS);
  });

  setState('empty');
  setStatus('dict.empty');
  input.focus({ preventScroll: true });

  return () => {
    state.alive = false;
    clearTimeout(state.timer);
  };
}
