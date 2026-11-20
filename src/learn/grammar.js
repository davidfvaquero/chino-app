/**
 * grammar.js — Grammar patterns + measure words. Routes:
 *   #/learn/grammar                  list of patterns + link to measure words
 *   #/learn/grammar/<patternId>      one pattern, with examples
 *   #/learn/grammar/measure-words    the 25 common classifiers
 *
 * Data is hand-written JSON under `public/data/grammar/` (served at
 * `/data/grammar/…`, see docs/grammar-schema.md):
 *   index.json          { level, patterns: [{id, title, level, file?}] }
 *   pattern-<nn>.json   { id, title, level, explanation, structure, examples[], notes? }
 *   measure-words.json  { measureWords: [{character, pinyin, usage, examples[2]}] }
 *
 * Wiring (imports only these): src/i18n.js, src/dom.js, src/audio.js,
 * src/srs.js, src/storage.js, src/tone.js (pinyinHtml — the only way pinyin
 * reaches the screen). Every example gets a **Hear it** button (speak) and an
 * **Add to review** button (addToReview, source 'grammar'). Marking a pattern
 * studied stores its id under progress/`grammar:studied` and fires
 * `chino:lesson_done` on window with {lessonId: 'grammar', patternId, studied}.
 *
 * Public API:
 *   titleKey, LESSON_ID, PROGRESS_STORE, STUDIED_KEY, MEASURE_SEGMENT, DATA_BASE
 *   isValidExample(example) / isValidPattern(pattern) / isValidMeasureWord(word)
 *   isValidIndexEntry(entry) / normalizePattern(raw)
 *   loadIndex({base, fetchJson})              -> [{id,title,level,file?}]
 *   loadPattern(id, {base, fetchJson, index}) -> pattern | null (null = not written)
 *   loadMeasureWords({base, fetchJson})       -> [{character,pinyin,usage,examples}]
 *   getStudied({store}) / markStudied(id, {store, now, notify})
 *   render(container, ctx)
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { speak, isTtsAvailable } from '../audio.js';
import { addToReview } from '../srs.js';
import storage from '../storage.js';
import { pinyinHtml } from '../tone.js';
import { fetchData } from '../data-url.js';

export const titleKey = 'grammar.title';
export const LESSON_ID = 'grammar';
/** Progress store + key holding the studied pattern ids. */
export const PROGRESS_STORE = 'progress';
export const STUDIED_KEY = 'grammar:studied';
/** Route segment that opens the Measure words section directly. */
export const MEASURE_SEGMENT = 'measure-words';
/** Root of the hand-written data, relative to this module (works in src/ and dist/). */
export const DATA_BASE = new URL('../../data/grammar/', import.meta.url);

const STYLE_ID = 'grammar-style';

/* ------------------------------------------------------------- validation -- */

const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** One example: hanzi + pinyin + English, all non-empty strings. */
export function isValidExample(example) {
  return Boolean(example) && isText(example.hanzi) && isText(example.pinyin) && isText(example.english);
}

/** One classifier: character + pinyin + usage + at least one example. */
export function isValidMeasureWord(word) {
  return (
    Boolean(word) &&
    isText(word.character) &&
    isText(word.pinyin) &&
    isText(word.usage) &&
    Array.isArray(word.examples) &&
    word.examples.length > 0 &&
    word.examples.every(isValidExample)
  );
}

/** One pattern: id + title + level + explanation + structure + examples. */
export function isValidPattern(pattern) {
  return (
    Boolean(pattern) &&
    isText(pattern.id) &&
    isText(pattern.title) &&
    isText(pattern.level) &&
    isText(pattern.explanation) &&
    isText(pattern.structure) &&
    Array.isArray(pattern.examples) &&
    pattern.examples.length > 0 &&
    pattern.examples.every(isValidExample) &&
    (pattern.notes === undefined || typeof pattern.notes === 'string')
  );
}

/** One index.json row: id + title + level, `file` optional (file = written). */
export function isValidIndexEntry(entry) {
  return Boolean(entry) && isText(entry.id) && isText(entry.title) && isText(entry.level) && (entry.file === undefined || isText(entry.file));
}

/** Trims the fields of a raw pattern into the shape the screen renders. */
export function normalizePattern(raw = {}) {
  return {
    id: String(raw.id ?? '').trim(),
    title: String(raw.title ?? '').trim(),
    level: String(raw.level ?? '').trim(),
    explanation: String(raw.explanation ?? '').trim(),
    structure: String(raw.structure ?? '').trim(),
    examples: (Array.isArray(raw.examples) ? raw.examples : []).map((example) => ({
      hanzi: String(example?.hanzi ?? '').trim(),
      pinyin: String(example?.pinyin ?? '').trim(),
      english: String(example?.english ?? '').trim(),
    })),
    notes: typeof raw.notes === 'string' ? raw.notes.trim() : undefined,
  };
}

/* ------------------------------------------------------------------ loading -- */

/**
 * Reads one grammar file, language-aware by default: locale 'es' loads
 * `data/es/grammar/<relPath>` when translated, else English. An injected
 * `fetchJson`/`base` keeps the plain-URL contract (tests).
 */
const readJson = (relPath, { base = DATA_BASE, fetchJson } = {}) =>
  fetchJson ? fetchJson(new URL(relPath, base)) : fetchData(`grammar/${relPath}`);

/** The plan: 15 pre-defined patterns (id, title, level, optional file). */
export async function loadIndex(opts = {}) {
  const data = await readJson('index.json', opts);
  const list = Array.isArray(data) ? data : data.patterns ?? [];
  return (Array.isArray(list) ? list : [])
    .filter(isValidIndexEntry)
    .map((entry) => ({ id: entry.id, title: entry.title, level: entry.level, ...(entry.file ? { file: entry.file } : {}) }));
}

/** One pattern's full text; `null` when the pattern is planned but not written. */
export async function loadPattern(id, opts = {}) {
  const { index, ...io } = opts;
  const entries = index ?? (await loadIndex(io));
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry || !entry.file) return null;
  const raw = await readJson(entry.file, io);
  const pattern = normalizePattern(raw);
  return isValidPattern(pattern) ? pattern : null;
}

/** The 25 common classifiers. */
export async function loadMeasureWords(opts = {}) {
  const data = await readJson('measure-words.json', opts);
  const list = Array.isArray(data) ? data : data.measureWords ?? [];
  return (Array.isArray(list) ? list : []).filter(isValidMeasureWord);
}

/* ----------------------------------------------------------------- progress -- */

/** Ids already marked as studied ([] when nothing is stored yet). */
export async function getStudied({ store = storage } = {}) {
  try {
    const record = await store.get(PROGRESS_STORE, STUDIED_KEY);
    const ids = Array.isArray(record?.ids) ? record.ids : [];
    return ids.filter(isText);
  } catch {
    return [];
  }
}

/**
 * Marks a pattern as studied (idempotent) and announces the lesson.
 * `notify: false` is for tests that assert on the stored state only.
 */
export async function markStudied(id, { store = storage, now = Date.now(), notify = true } = {}) {
  const ids = await getStudied({ store });
  const isNew = isText(id) && !ids.includes(id);
  if (isNew) {
    ids.push(id);
    try {
      await store.set(PROGRESS_STORE, STUDIED_KEY, { ids, updatedAt: now });
    } catch {
      /* storage unavailable: keep the in-memory list */
    }
  }
  // Only announce a genuinely new pattern: re-marking must not grant points.
  if (notify && isNew && typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('chino:lesson_done', { detail: { lessonId: LESSON_ID, patternId: id, studied: ids.length } }),
    );
  }
  return ids;
}

/* --------------------------------------------------------------- the screen -- */

/** CSS injected once; mobile-first, reuses the shell variables. */
const CSS = `
.gram-table { display: grid; gap: var(--pad); }
.gram-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
.gram-head h2 { margin: 0; }
.gram-count { font-size: 0.85rem; color: var(--ink-soft); }
.gram-nav { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.gram-list { display: grid; gap: 0.5rem; }
.gram-item { display: grid; gap: 0.3rem; width: 100%; text-align: left; font: inherit; cursor: pointer; }
.gram-item-title { font-weight: 600; color: var(--ink); }
.gram-item-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.gram-studied { color: var(--ok); font-size: 0.85rem; }
.gram-detail { display: grid; gap: 0.75rem; }
.gram-detail h2 { margin: 0; }
.gram-structure { margin: 0; font-size: 1rem; color: var(--ink); }
.gram-examples { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; }
.gram-example { display: grid; gap: 0.35rem; padding-top: 0.6rem; border-top: 1px solid var(--line); }
.gram-example:first-child { border-top: 0; padding-top: 0; }
.gram-example .hanzi { font-size: 1.5rem; }
.gram-example .pinyin { display: block; font-size: 1rem; }
.gram-example .english { display: block; color: var(--ink-soft); font-size: 0.9rem; }
.gram-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.gram-mw { display: grid; gap: 0.75rem; }
.gram-mw-char { font-size: 2rem; line-height: 1.1; }
.gram-mw-head { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; }
.gram-label { font-size: 0.75rem; color: var(--ink-soft); letter-spacing: 0.05em; }
.gram-notice { margin: 0; padding: 0.5rem 0.7rem; border-radius: 0.6rem; background: var(--bg); color: var(--ink-soft); font-size: 0.85rem; }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

export async function render(container, ctx) {
  ensureStyles(container.ownerDocument ?? document);

  const segment = ctx?.route?.segments?.[1];
  const state = {
    view: segment === MEASURE_SEGMENT ? 'measure' : segment ? 'pattern' : 'list',
    id: segment && segment !== MEASURE_SEGMENT ? segment : null,
    patterns: [],
    pattern: null,
    measureWords: [],
    studied: [],
    error: null,
    unsupported: false,
    noTts: !isTtsAvailable(),
  };

  const draw = () => {
    reset(container);
    let view;
    if (state.view === 'pattern') view = patternView();
    else if (state.view === 'measure') view = measureView();
    else view = listView();
    container.append(view);
    container.focus({ preventScroll: true });
  };

  const go = (path) => {
    if (ctx?.navigate) ctx.navigate(path);
  };

  /* ------------------------------------------------------------- example UI -- */

  function exampleItem(example) {
    const item = h('li', { class: 'gram-example' });
    item.append(
      h('span', { class: 'hanzi', text: example.hanzi }),
      h('span', { class: 'pinyin', html: pinyinHtml(example.pinyin) }),
      h('span', { class: 'english', text: example.english }),
    );
    const play = h('button', { type: 'button', class: 'btn gram-play', text: t('grammar.play') });
    play.addEventListener('click', async () => {
      const result = await speak(example.hanzi, { lang: 'zh-CN' });
      if (!result.ok && result.reason === 'unsupported') {
        state.noTts = true;
        state.unsupported = true;
      } else if (!result.ok) {
        state.unsupported = false;
      }
      draw();
    });
    const add = h('button', { type: 'button', class: 'btn gram-add', text: t('grammar.addToReview') });
    add.addEventListener('click', async () => {
      try {
        await addToReview({ hanzi: example.hanzi, pinyin: example.pinyin, english: example.english, source: LESSON_ID });
        add.textContent = t('grammar.added');
        add.disabled = true;
      } catch {
        add.textContent = t('grammar.reviewError');
      }
    });
    item.append(h('div', { class: 'gram-actions' }, play, add));
    return item;
  }

  /* ------------------------------------------------------------------- views -- */

  function listView() {
    const section = h('section', { class: 'card gram-table' });
    section.append(
      h(
        'div',
        { class: 'gram-head' },
        h('h2', { text: t('grammar.patternsHeading') }),
        h('span', { class: 'gram-count', text: t('grammar.studiedProgress', { studied: state.studied.length, total: state.patterns.length }) }),
      ),
      h('p', { text: t('grammar.intro') }),
    );
    if (state.error) section.append(h('p', { class: 'gram-notice', text: state.error }));

    const list = h('div', { class: 'gram-list' });
    for (const entry of state.patterns) {
      const studied = state.studied.includes(entry.id);
      const button = h('button', { type: 'button', class: 'card field gram-item', 'data-pattern': entry.id });
      button.append(
        h('span', { class: 'gram-item-title', text: entry.title }),
        h(
          'span',
          { class: 'gram-item-row' },
          h('span', { class: 'pill', text: entry.level }),
          studied ? h('span', { class: 'gram-studied', text: t('grammar.marked') }) : null,
          entry.file ? null : h('span', { class: 'pill', text: t('grammar.soon') }),
        ),
      );
      button.addEventListener('click', () => go(`learn/grammar/${entry.id}`));
      list.append(button);
    }
    section.append(list);

    const measure = h('button', { type: 'button', class: 'btn primary gram-go-measure', text: t('grammar.measureWordsButton') });
    measure.addEventListener('click', () => go(`learn/grammar/${MEASURE_SEGMENT}`));
    section.append(measure);
    return section;
  }

  function patternView() {
    const section = h('section', { class: 'card gram-detail' });
    const back = h('button', { type: 'button', class: 'btn gram-back', text: t('grammar.back') });
    back.addEventListener('click', () => go('learn/grammar'));
    section.append(back);

    if (state.error) {
      section.append(h('p', { class: 'gram-notice', text: state.error }), h('p', { class: 'gram-notice', text: t('grammar.unavailable') }));
      return section;
    }

    const pattern = state.pattern;
    if (!pattern) {
      section.append(h('p', { class: 'gram-notice', text: t('grammar.unavailable') }));
      return section;
    }

    const studied = state.studied.includes(pattern.id);
    section.append(
      h('div', { class: 'gram-item-row' }, h('h2', { text: pattern.title }), h('span', { class: 'pill', text: pattern.level })),
      h('p', { text: pattern.explanation }),
      h('p', { class: 'gram-label', text: t('grammar.structureLabel') }),
      h('p', { class: 'gram-structure', text: pattern.structure }),
    );
    if (pattern.notes) {
      section.append(h('p', { class: 'gram-label', text: t('grammar.notesLabel') }), h('p', { text: pattern.notes }));
    }
    if (state.unsupported) section.append(h('p', { class: 'gram-notice', text: t(state.noTts ? 'grammar.speakUnsupported' : 'grammar.playError') }));

    const examples = h('ul', { class: 'gram-examples' });
    section.append(h('p', { class: 'gram-label', text: t('grammar.examplesHeading') }));
    for (const example of pattern.examples) examples.append(exampleItem(example));
    section.append(examples);

    const mark = h('button', {
      type: 'button',
      class: 'btn primary gram-mark',
      text: studied ? t('grammar.marked') : t('grammar.markStudied'),
      disabled: studied,
    });
    mark.addEventListener('click', async () => {
      state.studied = await markStudied(pattern.id);
      draw();
    });
    section.append(mark);
    return section;
  }

  function measureView() {
    const section = h('section', { class: 'card gram-mw' });
    const back = h('button', { type: 'button', class: 'btn gram-back', text: t('grammar.back') });
    back.addEventListener('click', () => go('learn/grammar'));
    section.append(back, h('h2', { text: t('grammar.measureWordsHeading') }), h('p', { text: t('grammar.measureWordsIntro') }));
    if (state.error) section.append(h('p', { class: 'gram-notice', text: state.error }));
    if (state.unsupported) section.append(h('p', { class: 'gram-notice', text: t(state.noTts ? 'grammar.speakUnsupported' : 'grammar.playError') }));

    for (const word of state.measureWords) {
      const card = h('div', { class: 'card gram-mw-item', 'data-measure': word.character });
      card.append(
        h(
          'div',
          { class: 'gram-mw-head' },
          h('span', { class: 'gram-mw-char', text: word.character }),
          h('span', { class: 'pinyin', html: pinyinHtml(word.pinyin) }),
        ),
        h('p', { class: 'gram-label', text: t('grammar.usageLabel') }),
        h('p', { text: word.usage }),
      );
      const examples = h('ul', { class: 'gram-examples' });
      for (const example of word.examples) examples.append(exampleItem(example));
      card.append(examples);
      section.append(card);
    }
    return section;
  }

  /* -------------------------------------------------------------- bootstrap -- */

  try {
    const index = await loadIndex();
    state.patterns = index;
    state.studied = await getStudied();
    if (state.view === 'pattern') {
      state.pattern = await loadPattern(state.id, { index });
    } else if (state.view === 'measure') {
      state.measureWords = await loadMeasureWords();
    }
  } catch {
    state.error = t('grammar.loadError');
  }

  draw();

  // Small driving surface for headless tests (same idea as strokes/dictation).
  container.grammarApi = {
    state: () => ({
      view: state.view,
      id: state.id,
      patterns: state.patterns.slice(),
      pattern: state.pattern,
      measureWords: state.measureWords.slice(),
      studied: state.studied.slice(),
      error: state.error,
      noTts: state.noTts,
    }),
    markStudied: async (id = state.id) => {
      state.studied = await markStudied(id);
      draw();
      return state.studied;
    },
    draw,
  };
}
