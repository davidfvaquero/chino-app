/**
 * dictation.js — Dictation: listen and write. Route `#/learn/dictation`.
 *
 * Two exercise modes, mixed in a round of 10:
 *   - 'pinyin': the word is spoken (src/audio.js) and you type its pinyin
 *   - 'choose': the word is spoken and you pick its hanzi out of 4 options
 *
 * Word sources (pick one on the setup screen): HSK 1
 * (`public/data/hsk/1.json`), the user's review deck (storage store 'srs'),
 * or a theme (`public/data/themes/index.json`, when the data task ships it).
 *
 * Pinyin answers accept tone marks ("nǐ hǎo"), tone numbers ("ni3 hao3") or
 * nothing ("ni hao") — the `dictationToneMode` setting (numbers | marks | none,
 * stored in the 'settings' store) decides whether tones must match. Spacing,
 * capitals and ü/v typing never matter. Grading is pure: see checkPinyin().
 *
 * Wiring (imports only these): src/i18n.js, src/dom.js, src/storage.js,
 * src/audio.js, src/srs.js, src/tone.js (pinyinHtml), src/pinyin.js
 * (tonelessKey). Fires `chino:lesson_done` once per finished round with
 * `{lessonId, source, mode, score, total, percent}`.
 *
 * Public API:
 *   titleKey, LESSON_ID, ROUND_SIZE, CHOICE_COUNT, TONE_MODES, SETTINGS_KEY
 *   normalizePinyin(input, {toneMode})   -> canonical key ('tonal'|'toneless')
 *   checkPinyin(expected, answer, opts)  -> boolean
 *   gradeMode(toneMode)                  -> 'tonal' | 'toneless'
 *   displayPinyin(word, toneMode)        -> string for hints/answers
 *   normalizeWord(entry)                 -> {id, hanzi, pinyin, pinyinNumeric, english}
 *   shuffle(list, rng) / buildChoices(word, pool, {size, rng})
 *   buildRound({words, size, mode, rng}) -> [{word, mode, choices}]
 *   summarize(results)                   -> {correct, total, score, missed}
 *   getToneMode() / setToneMode(mode)
 *   loadHsk1() / loadSrs() / loadThemesIndex() / loadTheme(id) / loadSources()
 *   render(container, ctx)
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import storage from '../storage.js';
import { speak, isTtsAvailable } from '../audio.js';
import { addToReview } from '../srs.js';
import { pinyinHtml } from '../tone.js';
import { tonelessKey } from '../pinyin.js';
import { fetchData } from '../data-url.js';
import { ensureExerciseStyles } from './exercise-ui.css.js';
import { shuffle } from '../random.js';

/** Fisher-Yates copy (shared); re-exported so existing importers keep working. */
export { shuffle };

export const titleKey = 'dictation.title';
export const LESSON_ID = 'dictation';
/** Questions per round. */
export const ROUND_SIZE = 10;
/** Options in a 'choose' question. */
export const CHOICE_COUNT = 4;
/** Settings key holding how pinyin answers are typed/graded. */
export const SETTINGS_KEY = 'dictationToneMode';
export const TONE_MODES = ['numbers', 'marks', 'none'];
export const DEFAULT_TONE_MODE = 'numbers';
/** Root of the generated data, relative to this module (works in src/ and dist/). */
export const DATA_BASE = new URL('../../data/', import.meta.url);

const STYLE_ID = 'dictation-style';

/* ------------------------------------------------------------- pure logic -- */

/** Tone marks -> [plain letter, tone number]. Input is lowercased first. */
const TONE_MARKS = (() => {
  const groups = {
    a: ['ā', 'á', 'ǎ', 'à'],
    o: ['ō', 'ó', 'ǒ', 'ò'],
    e: ['ē', 'é', 'ě', 'è'],
    i: ['ī', 'í', 'ǐ', 'ì'],
    u: ['ū', 'ú', 'ǔ', 'ù'],
    'ü': ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
  };
  const map = {};
  for (const [base, marks] of Object.entries(groups)) {
    marks.forEach((mark, index) => {
      map[mark] = [base, index + 1];
    });
  }
  return map;
})();

/** Tone-mark-free copy of `text` plus the tone (if any) of every character. */
function plainAndTones(text) {
  let plain = '';
  const tones = [];
  for (const char of text) {
    const mark = TONE_MARKS[char];
    if (mark) {
      plain += mark[0];
      tones.push(mark[1]);
      continue;
    }
    plain += char;
    tones.push(null);
  }
  return { plain, tones };
}

const VOWELS = 'aoeiuü';

/**
 * Greedy pinyin split of a tone-mark-free token into `[from, to)` syllable
 * ranges: leading consonants (initial) + vowel group (+ n / ng coda).
 *   'baba' -> [[0,2],[2,4]]   'zhong' -> [[0,5]]   'r' -> [[0,1]]
 */
function splitSyllables(token) {
  const ranges = [];
  const isVowel = (char) => VOWELS.includes(char);
  let index = 0;
  while (index < token.length) {
    let end = index;
    while (end < token.length && !isVowel(token[end])) end += 1; // initial
    const vowelsStart = end;
    while (end < token.length && isVowel(token[end])) end += 1; // final
    if (end === vowelsStart) {
      end = token.length; // no vowel left: keep the rest as one chunk
    } else if (token.slice(end, end + 2) === 'ng' && (token[end + 2] === undefined || !isVowel(token[end + 2]))) {
      end += 2;
    } else if (token[end] === 'n' && (token[end + 1] === undefined || !isVowel(token[end + 1]))) {
      end += 1; // n / ng coda
    } else if (
      token[end] === 'r' &&
      token[vowelsStart] === 'e' &&
      end - vowelsStart === 1 &&
      (token[end + 1] === undefined || !isVowel(token[end + 1]))
    ) {
      end += 1; // the syllable "er" itself (二, 女儿), not the erhua suffix
    }
    ranges.push([index, end]);
    index = end;
  }
  return ranges;
}

/** Tone of the syllable at `[from, to)`: its mark, else neutral (5). */
function syllableTone(tones, from, to) {
  for (let index = from; index < to; index += 1) {
    if (tones[index]) return tones[index];
  }
  return 5;
}

/**
 * Canonical form of a pinyin answer.
 *
 *   normalizePinyin('nǐ hǎo')            -> 'ni3hao3'
 *   normalizePinyin('ni3 hao3')          -> 'ni3hao3'
 *   normalizePinyin('ba4 ba5')           -> 'ba4ba5'
 *   normalizePinyin('bàba')              -> 'ba4ba5'
 *   normalizePinyin('Ni Hao', toneless)  -> 'nihao'
 *
 * Spaces, capitals, syllables glued together and ü/v/u: typing are all
 * normalized away (same collapse the app's search key uses); a syllable written
 * without any tone counts as neutral (tone 5). With `toneMode: 'toneless'` the
 * tones are dropped from the key entirely.
 */
export function normalizePinyin(input, { toneMode = 'tonal' } = {}) {
  const text = String(input ?? '').toLowerCase();
  const pieces = [];
  const add = (base, tone) => {
    // A doubled vowel is not a pinyin syllable: HSK 1 ships 哪 as "nǎa", whose
    // numeric form is "na3" — collapse it so both spellings grade the same.
    const key = tonelessKey(base).replace(/([aeiou])\1+/g, '$1');
    if (key) pieces.push([key, tone]);
  };

  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    let chunk = '';
    // A tone number ends the syllable it follows; the rest of the token is
    // split by the pinyin initial/final rules and read for tone marks.
    const flush = (digitTone) => {
      if (!chunk) return;
      const { plain, tones } = plainAndTones(chunk);
      chunk = '';
      if (digitTone !== null) {
        add(plain, digitTone);
        return;
      }
      for (const [from, to] of splitSyllables(plain)) add(plain.slice(from, to), syllableTone(tones, from, to));
    };
    for (const char of token) {
      if (char >= '1' && char <= '5') flush(Number(char));
      else chunk += char;
    }
    flush(null);
  }

  return pieces.map(([key, tone]) => (toneMode === 'toneless' ? key : `${key}${tone}`)).join('');
}

/** 'numbers' | 'marks' | 'none' -> how strict checkPinyin() is. */
export function gradeMode(toneMode) {
  return toneMode === 'none' ? 'toneless' : 'tonal';
}

/**
 * True when `answer` is the right pinyin for `expected`.
 * Tone marks and tone numbers are interchangeable; in 'toneless' grading the
 * tones are ignored entirely. An empty answer never matches.
 */
export function checkPinyin(expected, answer, { toneMode = 'tonal' } = {}) {
  const want = normalizePinyin(expected, { toneMode });
  const got = normalizePinyin(answer, { toneMode });
  return Boolean(want) && want === got;
}

/**
 * Re-spaces glued pinyin into syllables so pinyinHtml() can color each one:
 *   'tiānqì' -> 'tiān qì'   'tian1qi4' -> 'tian1 qi4'   'nǐ hǎo' -> 'nǐ hǎo'
 * Marks and digits are kept as written; unknown leftovers stay untouched.
 */
export function respacePinyin(pinyin) {
  const out = [];
  for (const token of String(pinyin ?? '').trim().split(/\s+/)) {
    if (!token) continue;
    let piece = '';
    for (const char of token) {
      piece += char;
      if (char >= '1' && char <= '5') {
        out.push(piece); // a tone number already ends the syllable
        piece = '';
      }
    }
    if (!piece) continue;
    const { plain } = plainAndTones(piece);
    for (const [from, to] of splitSyllables(plain)) out.push(piece.slice(from, to));
  }
  return out.join(' ');
}

/** Pinyin shown to the user (hint / correction) in the chosen tone style. */
export function displayPinyin(word, toneMode = DEFAULT_TONE_MODE) {
  const marked = String(word?.pinyin ?? '').trim();
  const numeric = String(word?.pinyinNumeric ?? '').trim();
  const source = toneMode === 'numbers' ? numeric || marked : marked || numeric;
  const spaced = respacePinyin(source);
  if (toneMode !== 'none') return spaced;
  return spaced
    .split('')
    .map((char) => (TONE_MARKS[char] ? TONE_MARKS[char][0] : char))
    .join('')
    .replace(/[1-5]/g, '');
}

/** English gloss as one string (data gives a string or a list). */
export function englishText(english) {
  if (Array.isArray(english)) return english.filter(Boolean).join('; ');
  return String(english ?? '').trim();
}

/**
 * Normalizes a HSK / review-deck / theme entry into the word shape the screen
 * uses. The traditional form is deliberately dropped: this app is simplified
 * only, so no UI may ever show it.
 */
export function normalizeWord(entry = {}) {
  const hanzi = String(entry.hanzi ?? entry.simp ?? '').trim();
  const pinyin = String(entry.pinyin ?? '').trim();
  return {
    id: String(entry.id ?? `${hanzi}|${pinyin}`),
    hanzi,
    pinyin,
    pinyinNumeric: String(entry.pinyinNumeric ?? '').trim(),
    english: englishText(entry.english ?? entry.defs ?? entry.meaning),
  };
}

/** The 4 hanzi offered for one word: the word itself plus distinct decoys. */
export function buildChoices(word, pool, { size = CHOICE_COUNT, rng = Math.random } = {}) {
  const decoys = shuffle(pool.filter((other) => other.hanzi !== word.hanzi), rng).slice(0, Math.max(0, size - 1));
  return shuffle([word, ...decoys], rng).map((entry) => entry.hanzi);
}

/** True when a word can be used in a round (needs a hanzi and a reading). */
export function isPlayable(word) {
  return Boolean(word?.hanzi && (word.pinyin || word.pinyinNumeric));
}

/**
 * Builds a round: `size` distinct words, each with its mode and (for 'choose')
 * its options. `mode` is 'mixed' (alternating pinyin / choose), 'pinyin' or
 * 'choose'; a 'choose' question degrades to 'pinyin' when there is nothing to
 * pick between.
 */
export function buildRound({ words = [], size = ROUND_SIZE, mode = 'mixed', rng = Math.random } = {}) {
  const pool = words.filter(isPlayable);
  return shuffle(pool, rng)
    .slice(0, Math.max(0, Math.min(size, pool.length)))
    .map((word, index) => {
      let questionMode = mode === 'mixed' ? (index % 2 === 0 ? 'pinyin' : 'choose') : mode;
      if (questionMode === 'choose' && pool.length < 2) questionMode = 'pinyin';
      return {
        word,
        mode: questionMode,
        choices: questionMode === 'choose' ? buildChoices(word, pool, { rng }) : [],
      };
    });
}

/** Round results -> score. `missed` keeps the words answered wrong. */
export function summarize(results = []) {
  const total = results.length;
  const correct = results.filter((result) => result?.correct).length;
  return {
    correct,
    total,
    score: total ? Math.round((correct / total) * 100) : 0,
    missed: results.filter((result) => result && !result.correct).map((result) => result.word),
  };
}

/* ---------------------------------------------------------------- settings -- */

/** How pinyin answers are typed and graded (settings store, default 'numbers'). */
export async function getToneMode({ store = storage } = {}) {
  try {
    const value = await store.get('settings', SETTINGS_KEY);
    return TONE_MODES.includes(value) ? value : DEFAULT_TONE_MODE;
  } catch {
    return DEFAULT_TONE_MODE;
  }
}

/** Persists the tone mode and announces it like every other setting. */
export async function setToneMode(mode, { store = storage } = {}) {
  const value = TONE_MODES.includes(mode) ? mode : DEFAULT_TONE_MODE;
  try {
    await store.set('settings', SETTINGS_KEY, value);
  } catch {
    /* storage unavailable: keep the in-memory choice */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('chino:settings_changed', { detail: { key: SETTINGS_KEY, value } }));
  }
  return value;
}

/* ------------------------------------------------------------------ sources -- */

/**
 * Reads one data file, language-aware by default: locale 'es' loads
 * `data/es/<relPath>` when translated, else English. An injected
 * `fetchJson`/`base` keeps the plain-URL contract (tests).
 */
const readJson = (relPath, { base = DATA_BASE, fetchJson } = {}) =>
  fetchJson ? fetchJson(new URL(relPath, base)) : fetchData(relPath);

/** HSK level 1 words. `base`/`fetchJson` are injectable for tests. */
export async function loadHsk1({ base = DATA_BASE, fetchJson, level = 1 } = {}) {
  const data = await readJson(`hsk/${level}.json`, { base, fetchJson });
  return (data.items ?? []).map(normalizeWord).filter(isPlayable);
}

/** Every card in the user's review deck. */
export async function loadSrs({ store = storage } = {}) {
  const rows = await store.list('srs');
  return rows.map((row) => normalizeWord(row.value ?? {})).filter(isPlayable);
}

/** Theme list (`public/data/themes/index.json`); [] when the file does not exist. */
export async function loadThemesIndex({ base = DATA_BASE, fetchJson } = {}) {
  try {
    const data = await readJson('themes/index.json', { base, fetchJson });
    // The data task ships a bare array; accept a wrapped list too.
    const list = Array.isArray(data) ? data : data.themes ?? data.items ?? [];
    return Array.isArray(list) ? list.filter((theme) => theme && (theme.id || theme.slug)) : [];
  } catch {
    return []; // no theme data shipped yet: the option simply does not appear
  }
}

/** Words of one theme (`public/data/themes/<id>.json`). */
export async function loadTheme(id, { base = DATA_BASE, fetchJson } = {}) {
  const data = await readJson(`themes/${id}.json`, { base, fetchJson });
  const list = data.items ?? data.words ?? [];
  return (Array.isArray(list) ? list : []).map(normalizeWord).filter(isPlayable);
}

/**
 * Word sources offered on the setup screen:
 * `[{id, label, labelKey, count, load}]` — `count` is null for lazily loaded
 * themes (they are only fetched when picked).
 */
export async function loadSources({ store = storage, base = DATA_BASE, fetchJson } = {}) {
  const sources = [];
  let hsk1 = [];
  try {
    hsk1 = await loadHsk1({ base, fetchJson });
  } catch {
    hsk1 = [];
  }
  sources.push({
    id: 'hsk1',
    labelKey: 'dictation.source.hsk1',
    label: '',
    count: hsk1.length,
    load: async () => hsk1,
  });

  let srs = [];
  try {
    srs = await loadSrs({ store });
  } catch {
    srs = [];
  }
  sources.push({
    id: 'srs',
    labelKey: 'dictation.source.srs',
    label: '',
    count: srs.length,
    load: async () => loadSrs({ store }),
  });

  for (const theme of await loadThemesIndex({ base, fetchJson })) {
    const id = String(theme.id ?? theme.slug);
    sources.push({
      id: `theme:${id}`,
      labelKey: null,
      label: String(theme.title ?? theme.name ?? id),
      count: null,
      load: () => loadTheme(id, { base, fetchJson }),
    });
  }
  return sources;
}

/* --------------------------------------------------------------- the screen -- */

/** CSS injected once; mobile-first, reuses the shell variables. */
const CSS = `
.dict-setup, .dict-question, .dict-result { display: grid; gap: var(--pad); }
.dict-field { display: grid; gap: 0.35rem; }
.dict-field label { font-size: 0.85rem; color: var(--ink-soft); }
.dict-select, .dict-input {
  width: 100%; font: inherit; padding: 0.6rem 0.7rem; min-height: 48px;
  border: 1.5px solid var(--ink-soft); border-radius: var(--r-md);
  background: var(--surface); color: var(--ink);
}
.dict-bar { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.85rem; color: var(--ink-soft); }
.dict-mode { margin: 0; color: var(--ink-soft); }
.dict-notice { margin: 0; padding: 0.5rem 0.7rem; border-radius: var(--r-md); background: var(--inset); color: var(--ink-soft); font-size: 0.85rem; }
.dict-prompt { margin: 0; font-size: 1.6rem; text-align: center; }
.dict-prompt.hanzi { font-size: 2.4rem; }
.dict-audio { display: flex; gap: 0.5rem; }
.dict-answer { display: flex; gap: 0.5rem; }
.dict-answer .dict-input { flex: 1 1 auto; min-width: 0; }
.dict-options { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
.dict-option { font-size: 1.5rem; padding: 0.6rem; }
.dict-feedback { display: grid; gap: 0.5rem; }
.dict-feedback .ok { color: var(--ok); }
.dict-feedback .bad { color: var(--danger); }
.dict-answer-line { margin: 0; font-size: 1.25rem; display: flex; flex-direction: column; gap: 0.3rem; }
.dict-answer-line .pinyin { font-size: 1rem; }
.dict-answer-line .english { color: var(--ink-soft); font-size: 0.95rem; }
.dict-missed { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
.dict-missed li { display: flex; flex-direction: column; align-items: flex-start; gap: 0.15rem; }
.dict-missed .hanzi { font-size: 1.3rem; }
`;

/** Injects the module CSS into <head> once. */
function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/** Source label: i18n key when it has one, data text for themes. */
function sourceLabel(source) {
  const base = source.labelKey ? t(source.labelKey) : source.label;
  return source.count === null ? base : `${base} · ${t('dictation.sourceCount', { count: source.count })}`;
}

export async function render(container, ctx) {
  ensureStyles(container.ownerDocument ?? document);
  ensureExerciseStyles(container.ownerDocument ?? document);

  const toneMode = await getToneMode();
  const sources = await loadSources();
  const state = {
    phase: 'setup',
    sources,
    source: (sources.find((entry) => entry.count > 0) ?? sources[0])?.id ?? 'hsk1',
    toneMode,
    round: [],
    index: 0,
    answered: false,
    results: [],
    summary: null,
    noTts: !isTtsAvailable(),
    error: null,
  };

  const current = () => state.round[state.index] ?? null;
  const correctSoFar = () => state.results.filter((result) => result?.correct).length;

  const draw = () => {
    reset(container);
    let view;
    if (state.phase === 'question') view = questionView();
    else if (state.phase === 'result') view = resultView();
    else view = setupView();
    container.append(view);
    container.focus({ preventScroll: true });
  };

  /** Speaks the current word; degrades to the visual prompt without TTS. */
  async function playCurrent() {
    const question = current();
    if (!question) return;
    const result = await speak(question.word.hanzi, { lang: 'zh-CN' });
    if (!result.ok && result.reason === 'unsupported' && !state.noTts) {
      state.noTts = true; // no speech at all: show the word instead
      draw();
    }
  }

  async function start(sourceId = state.source) {
    state.source = sourceId;
    state.error = null;
    const source = state.sources.find((entry) => entry.id === sourceId);
    let words = [];
    try {
      words = source ? await source.load() : [];
    } catch {
      state.error = t('dictation.error');
    }
    const round = buildRound({ words });
    if (!round.length) {
      state.error = t('dictation.emptySource');
      state.phase = 'setup';
      draw();
      return;
    }
    state.round = round;
    state.index = 0;
    state.answered = false;
    state.results = [];
    state.summary = null;
    state.phase = 'question';
    draw();
    playCurrent();
  }

  function finish() {
    state.summary = summarize(state.results);
    state.phase = 'result';
    draw();
    window.dispatchEvent(
      new CustomEvent('chino:lesson_done', {
        detail: {
          lessonId: LESSON_ID,
          source: state.source,
          mode: 'mixed',
          score: state.summary.correct,
          total: state.summary.total,
          percent: state.summary.score,
        },
      }),
    );
  }

  function answer(value) {
    const question = current();
    if (!question || state.answered) return;
    const { word, mode } = question;
    const revealed = value === null || value === undefined;
    const correct =
      !revealed &&
      (mode === 'pinyin'
        ? checkPinyin(word.pinyin, value, { toneMode: gradeMode(state.toneMode) })
        : String(value) === word.hanzi);
    state.answered = true;
    state.results[state.index] = { word, mode, correct, revealed, answer: revealed ? '' : String(value) };
    draw();
  }

  function next() {
    if (state.index + 1 >= state.round.length) {
      finish();
      return;
    }
    state.index += 1;
    state.answered = false;
    draw();
    playCurrent();
  }

  /* -------------------------------------------------------------- views -- */

  function setupView() {
    const section = h('section', { class: 'card dict-setup' });
    section.append(h('p', { text: t('dictation.intro') }));

    const sourceSelect = h('select', { class: 'dict-select', 'aria-label': t('dictation.sourceLabel') });
    for (const source of state.sources) {
      sourceSelect.append(h('option', { value: source.id, text: sourceLabel(source), selected: source.id === state.source }));
    }
    sourceSelect.addEventListener('change', () => {
      state.source = sourceSelect.value;
    });

    const toneSelect = h('select', { class: 'dict-select', 'aria-label': t('dictation.toneModeLabel') });
    for (const mode of TONE_MODES) {
      toneSelect.append(h('option', { value: mode, text: t(`dictation.toneMode.${mode}`), selected: mode === state.toneMode }));
    }
    toneSelect.addEventListener('change', async () => {
      state.toneMode = await setToneMode(toneSelect.value);
    });

    section.append(
      h('div', { class: 'dict-field' }, h('label', { text: t('dictation.sourceLabel') }), sourceSelect),
      h('div', { class: 'dict-field' }, h('label', { text: t('dictation.toneModeLabel') }), toneSelect),
    );
    if (state.error) section.append(h('p', { class: 'dict-notice', text: state.error }));
    section.append(h('button', { type: 'button', class: 'btn primary dict-start', text: t('dictation.start'), onclick: () => start() }));
    return section;
  }

  function questionView() {
    const question = current();
    const { word, mode } = question;
    const result = state.answered ? state.results[state.index] : null;
    const section = h('section', { class: 'card dict-question' });
    if (state.noTts) section.dataset.noTts = '1';

    section.append(
      h(
        'div',
        { class: 'dict-bar' },
        h('span', { class: 'dict-progress', text: t('dictation.progress', { current: state.index + 1, total: state.round.length }) }),
        h('span', { class: 'dict-score', text: t('dictation.scoreSoFar', { score: correctSoFar(), answered: state.answered ? state.index + 1 : state.index }) }),
      ),
      h('p', { class: 'dict-mode', text: t(mode === 'pinyin' ? 'dictation.mode.pinyin' : 'dictation.mode.choose') }),
    );
    if (state.noTts) {
      section.append(h('p', { class: 'dict-notice', text: t('dictation.ttsUnavailable') }));
      section.append(
        h('p', {
          class: mode === 'pinyin' ? 'dict-prompt hanzi' : 'dict-prompt',
          text: mode === 'pinyin' ? word.hanzi : displayPinyin(word, state.toneMode),
        }),
      );
    }

    const audio = h(
      'div',
      { class: 'dict-audio' },
      h('button', { type: 'button', class: 'btn primary dict-play', text: t('dictation.play'), onclick: () => playCurrent() }),
      h('button', { type: 'button', class: 'btn dict-repeat', text: t('dictation.repeat'), onclick: () => playCurrent() }),
    );
    for (const button of audio.children) button.disabled = Boolean(result);
    section.append(audio);

    if (mode === 'pinyin') {
      const input = h('input', {
        type: 'text',
        class: 'dict-input',
        'aria-label': t('dictation.answerPlaceholder'),
        placeholder: t('dictation.answerPlaceholder'),
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        disabled: Boolean(result),
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') answer(input.value);
      });
      section.append(
        h(
          'div',
          { class: 'dict-answer' },
          input,
          h('button', { type: 'button', class: 'btn primary dict-check', text: t('dictation.check'), disabled: Boolean(result), onclick: () => answer(input.value) }),
        ),
      );
    } else {
      const options = h('div', { class: 'dict-options' });
      for (const hanzi of question.choices) {
        options.append(
          h('button', { type: 'button', class: 'btn option dict-option', text: hanzi, disabled: Boolean(result), onclick: () => answer(hanzi) }),
        );
      }
      section.append(options);
    }

    if (!result) {
      section.append(h('button', { type: 'button', class: 'btn dict-reveal', text: t('dictation.showAnswer'), onclick: () => answer(null) }));
    } else {
      section.append(feedbackView(result));
    }
    return section;
  }

  function answerLine(word) {
    const line = h('p', { class: 'dict-answer-line' });
    line.append(h('span', { class: 'hanzi', text: `${word.hanzi} ` }));
    line.append(h('span', { class: 'pinyin py-keep', html: pinyinHtml(displayPinyin(word, state.toneMode)) }));
    if (word.english) line.append(h('span', { class: 'english', text: ` — ${word.english}` }));
    return line;
  }

  function reviewButton(word) {
    const button = h('button', { type: 'button', class: 'btn option dict-add', text: t('dictation.addToReview') });
    button.addEventListener('click', async () => {
      await addToReview({ hanzi: word.hanzi, pinyin: word.pinyin, pinyinNumeric: word.pinyinNumeric, english: word.english, source: LESSON_ID });
      button.textContent = t('dictation.added');
      button.disabled = true;
    });
    return button;
  }

  function feedbackView(result) {
    const box = h('div', { class: 'dict-feedback' });
    box.append(h('p', { class: result.correct ? 'ok' : 'bad', text: t(result.correct ? 'dictation.correct' : 'dictation.incorrect') }));
    if (!result.correct) {
      box.append(answerLine(result.word), reviewButton(result.word));
    }
    box.append(h('button', { type: 'button', class: 'btn primary dict-next', text: t('dictation.next'), onclick: () => next() }));
    return box;
  }

  function resultView() {
    const summary = state.summary ?? summarize(state.results);
    const section = h(
      'section',
      { class: 'card dict-result' },
      h('h2', { text: t('dictation.result.title') }),
      h('p', { class: 'dict-result-score', text: t('dictation.result.score', { correct: summary.correct, total: summary.total, percent: summary.score }) }),
    );

    if (summary.missed.length) {
      section.append(h('h3', { text: t('dictation.result.missed') }));
      const list = h('ul', { class: 'dict-missed' });
      for (const word of summary.missed) {
        list.append(h('li', {}, h('span', { class: 'hanzi', text: word.hanzi }), h('span', { class: 'pinyin py-keep', html: pinyinHtml(displayPinyin(word, state.toneMode)) }), reviewButton(word)));
      }
      section.append(list);
    }

    section.append(
      h('button', { type: 'button', class: 'btn primary dict-again', text: t('dictation.result.playAgain'), onclick: () => start() }),
      h('button', { type: 'button', class: 'btn dict-back', text: t('dictation.result.back'), onclick: () => ctx.navigate('learn') }),
    );
    return section;
  }

  draw();

  // Small driving surface for headless tests (same idea as strokes.js).
  container.dictationApi = {
    state: () => ({
      phase: state.phase,
      source: state.source,
      toneMode: state.toneMode,
      index: state.index,
      total: state.round.length,
      answered: state.answered,
      noTts: state.noTts,
      current: current(),
      results: state.results.slice(),
      summary: state.summary,
    }),
    start,
    answer,
    play: playCurrent,
  };
}
