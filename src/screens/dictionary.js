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
 *   .dict-examples           <details> per row; lazy-loads the word's Tatoeba
 *                            shard on first open (Cargando… / Sin ejemplos)
 */
import { t, getLocale } from '../i18n.js';
import { h, reset } from '../dom.js';
import { href } from '../router.js';
import { search, distinctDefs, examplesFor, highlightWord, exampleTranslation } from '../dictionary.js';
import { addToReview, listCards, cardId } from '../srs.js';
import { speak, isTtsAvailable } from '../audio.js';
import { pinyinHtml } from '../tone.js';
import { fetchData } from '../data-url.js';

export const titleKey = 'screens.dictionary.title';

/** Wait this long after the last keystroke before searching. */
export const DEBOUNCE_MS = 250;
/** Max results shown for one query. */
export const RESULT_LIMIT = 20;

/** Layout-only CSS for the per-word "Examples" disclosure (reuses shell vars). */
const STYLE_ID = 'dict-examples-style';
const CSS = `
.dict-examples { margin-top: 0.35rem; }
.dict-examples > summary { display: flex; align-items: center; min-height: 44px; cursor: pointer; color: var(--accent); font-weight: 600; }
.dict-examples-body { padding-top: 0.35rem; }
.dict-examples-list { display: grid; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
.dict-example { display: grid; gap: 0.15rem; }
.dict-example-zh { margin: 0; font-size: var(--fs-md); line-height: 1.5; }
.dict-example-hit { font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
.dict-example-pinyin { margin: 0; color: var(--ink-soft); }
.dict-example-tr { margin: 0; color: var(--ink-soft); line-height: 1.4; }
.dict-example-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.15rem; }
.dict-examples-attribution { margin: 0.5rem 0 0; }
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

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
  ensureStyles();
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
  // One small note per results screen (never per row) when Spanish shows.
  const note = h('p', { class: 'hint dict-note', hidden: true, text: t('dict.machineTranslation') });
  note.append(' ', h('a', {
    class: 'licence-link',
    href: 'data/es/dict/LICENSE.md',
    target: '_blank',
    rel: 'noopener noreferrer',
    text: t('dict.licenceName'),
  }));
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

  reset(container).append(h('section', { class: 'dict' }, form, status, note, list));
  container.focus({ preventScroll: true });

  const setState = (name) => {
    container.dataset.state = name;
  };
  const setStatus = (key, params) => {
    status.textContent = key ? t(key, params) : '';
    status.hidden = !key;
  };

  /** One example sentence: highlighted zh, pinyin, translation, audio, add. */
  function exampleItem(sentence, word) {
    const zh = h(
      'p',
      { class: 'dict-example-zh', lang: 'zh-Hans' },
      ...highlightWord(sentence.zh, word).map((part) =>
        part.hit
          ? h('strong', { class: 'dict-example-hit', text: part.text })
          : document.createTextNode(part.text),
      ),
    );

    const actions = [];
    // No browser voice for Chinese -> no audio button (and never an error).
    if (isTtsAvailable()) {
      const audio = h('button', {
        type: 'button',
        class: 'btn ghost sm',
        text: t('dict.audio'),
        'aria-label': t('dict.exampleAudioFor', { zh: sentence.zh }),
        onclick: async () => {
          const result = await speak(sentence.zh);
          if (!result.ok) audio.remove(); // a missing voice/file hides it, silently
        },
      });
      actions.push(audio);
    }
    actions.push(
      h('button', {
        type: 'button',
        class: 'btn sm',
        text: t('dict.addToReview'),
        'aria-label': t('dict.addToReview'),
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            // Same shape as the phrases screen; `ex` keeps the id out of the
            // dictionary entry id space (both are small integers).
            const result = await addToReview({
              id: `ex${sentence.id}`,
              hanzi: sentence.zh,
              pinyin: sentence.pinyin,
              english: sentence.en,
              source: 'sentences',
            });
            button.textContent = t('dict.added');
            setStatus(result.created ? 'dict.addedToReview' : 'dict.exampleAlreadyInReview', {
              hanzi: sentence.zh,
            });
          } catch (err) {
            console.error('dictionary: add example to review failed', err);
            button.disabled = false;
            setStatus('dict.addError');
          }
        },
      }),
    );

    return h(
      'li',
      { class: 'dict-example' },
      zh,
      h('p', { class: 'dict-example-pinyin', html: pinyinHtml(sentence.pinyin) }),
      h('p', { class: 'dict-example-tr', text: exampleTranslation(sentence, getLocale()) }),
      h('div', { class: 'dict-example-actions' }, ...actions),
    );
  }

  /**
   * The per-word "Examples" disclosure. The shard is fetched on first open only
   * (never on search), shows "Cargando…", and degrades to "Sin ejemplos" on an
   * empty word or any failure — offline without cache included.
   */
  function examplesBlock(word) {
    const body = h('div', { class: 'dict-examples-body' });
    const details = h('details', { class: 'dict-examples' }, h('summary', { text: t('dict.examples') }), body);
    let loaded = false;
    details.addEventListener('toggle', async () => {
      if (!details.open || loaded) return;
      loaded = true;
      body.replaceChildren(h('p', { class: 'hint', text: t('dict.examplesLoading') }));
      let list = [];
      try {
        list = await examplesFor(word);
      } catch {
        list = []; // silent: offline with no cache, or a missing shard
      }
      if (!list.length) {
        body.replaceChildren(h('p', { class: 'hint', text: t('dict.examplesNone') }));
        return;
      }
      body.replaceChildren(
        h('ul', { class: 'dict-examples-list' }, ...list.map((s) => exampleItem(s, word))),
        h(
          'p',
          { class: 'hint dict-examples-attribution' },
          t('dict.examplesAttribution'),
          ' ',
          h('a', {
            class: 'licence-link',
            href: 'CREDITS.md',
            target: '_blank',
            rel: 'noopener noreferrer',
            text: t('dict.examplesCredits'),
          }),
        ),
      );
    });
    return details;
  }

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
            defsEs: entry.defsEs,
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

    const es = getLocale() === 'es';
    const defsEs = es && Array.isArray(entry.defsEs) ? distinctDefs(entry.defsEs) : [];
    const defs = distinctDefs(entry.defs);

    // Spanish definitions first; the English original stays behind a discreet
    // per-entry toggle. A shard without a translation shows the English as before.
    let defsBlock;
    if (defsEs.length) {
      const english = h(
        'div',
        { class: 'dict-defs-en', hidden: true },
        h('ul', { class: 'dict-defs' }, ...defs.map((def) => h('li', { text: def }))),
      );
      const toggle = h('button', {
        type: 'button',
        class: 'btn ghost sm dict-english-toggle',
        'data-action': 'toggle-english',
        'aria-expanded': 'false',
        text: t('dict.showEnglish'),
        onclick: () => {
          const open = english.hidden;
          english.hidden = !open;
          toggle.setAttribute('aria-expanded', String(open));
          toggle.textContent = t(open ? 'dict.hideEnglish' : 'dict.showEnglish');
        },
      });
      defsBlock = [
        h('ul', { class: 'dict-defs dict-defs-es' }, ...defsEs.map((def) => h('li', { text: def }))),
        toggle,
        english,
      ];
    } else {
      defsBlock = [
        ...(defs.length && es ? [h('p', { class: 'hint', text: t('dict.defsEnglish') })] : []),
        h('ul', { class: 'dict-defs' }, ...defs.map((def) => h('li', { text: def }))),
      ];
    }

    const node = h(
      'li',
      {
        class: 'dict-row',
        'data-id': String(entry.id),
        'data-added': String(Boolean(isAdded)),
        'data-translated': String(defsEs.length > 0),
      },
      h(
        'div',
        { class: 'dict-head' },
        h('span', { class: 'dict-hanzi', lang: 'zh-Hans', text: hanzi }),
        audio,
      ),
      h('p', { class: 'dict-pinyin', html: pinyinHtml(entry.pinyinTone || entry.pinyinNum || '') }),
      // A Spanish gloss already translated in the lesson data wins over the
      // English CC-CEDICT ones; the English list stays, labelled.
      ...(gloss ? [h('p', { class: 'dict-gloss', text: gloss })] : []),
      ...defsBlock,
      examplesBlock(hanzi),
      h('div', { class: 'dict-actions' }, h('span', { class: 'hint dict-strokes-label', text: t('dict.strokesLabel') }), ...strokes, add),
    );
    return node;
  }

  async function run(query) {
    const seq = (state.seq += 1);
    list.replaceChildren();
    note.hidden = true;
    if (!query) {
      setState('empty');
      setStatus('dict.empty');
      return;
    }
    setState('loading');
    setStatus('dict.loading');

    let results;
    try {
      results = await search(query, { limit: RESULT_LIMIT, spanish: getLocale() === 'es' });
    } catch (err) {
      if (seq !== state.seq || !state.alive) return;
      console.error('dictionary: search failed', err);
      setState('error');
      // No HTTP status = the network itself failed (offline / DNS).
      setStatus(err?.status === undefined ? 'dict.offline' : 'dict.error');
      return;
    }
    if (seq !== state.seq || !state.alive) return;

    if (!results.length) {
      setState('none');
      setStatus('dict.noResults', { query });
      list.append(h('p', { class: 'hint', text: t('dict.noResultsHint') }));
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
    // Small note, once, only when at least one row shows a translated gloss.
    note.hidden = !results.some((entry) => Array.isArray(entry.defsEs) && entry.defsEs.length);
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
