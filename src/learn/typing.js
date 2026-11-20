/**
 * Typing practice — `#/learn/typing` (pinyin input without tones).
 *
 * Pure helpers (tested in tests/typing.test.mjs):
 *   normalizePinyin(input)           -> toneless, no spaces, lowercased
 *   compareLetterByLetter(user, target) -> [{char, ok}, ...]  (green/red per letter)
 *   wordsPerMinute(correctChars, elapsedMs) -> number
 *
 * Screen contract: `titleKey` + `render(container, ctx)` returns cleanup fn.
 *
 * Wiring (only these imports):
 *   - dictionary: `search()` for HSK/theme word lists (src/dictionary.js)
 *   - data-url: `fetchData()` for themes/lessons (src/data-url.js)
 *   - srs: `addToReview({hanzi, pinyin, english, source, sourceDetail})` (src/srs.js)
 *   - tone: `pinyinHtml()` for hint display (src/tone.js)
 *   - audio: `speak()` for pronunciation (src/audio.js)
 *   - i18n: `t()` for all strings
 *   - window event `chino:lesson_done`, detail: {area:'typing', round:10, wpm, accuracy, failed:[]}
 *
 * Data sources (user chooses):
 *   - HSK level (1-6) -> public/data/hsk/{level}.json
 *   - My cards -> SRS deck (src/srs.js getDueCards)
 *   - Theme -> public/data/themes/{theme-id}.json
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { search as dictSearch } from '../dictionary.js';
import { fetchData } from '../data-url.js';
import { addToReview, getDueCards } from '../srs.js';
import { pinyinHtml } from '../tone.js';
import { speak } from '../audio.js';
import { shuffle } from '../random.js';

export const titleKey = 'hubs.learn.typing';

const STYLE_ID = 'typing-style';
const ROUND_SIZE = 10;

/** Default HSK level if nothing saved. */
const DEFAULT_HSK = 1;

/** Default theme id if nothing saved. */
const DEFAULT_THEME = 'theme-01';

const CSS = `
.typing { display: flex; flex-direction: column; gap: 0.75rem; }
.typing [hidden] { display: none !important; }

.typing-setup { display: flex; flex-direction: column; gap: 0.5rem; }
.typing-setup-row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.typing-setup label { font-size: 0.9rem; color: var(--ink-soft); min-width: 70px; }
.typing-setup select, .typing-setup input[type="number"] {
  flex: 1; min-width: 0; min-height: 44px; padding: 0.5rem 0.6rem; font-size: 1rem;
  border: 1.5px solid var(--edge); border-radius: 0.5rem;
  background: var(--surface); color: inherit;
}
.typing-setup button { min-height: 44px; padding: 0.5rem 0.8rem; border: 1.5px solid var(--edge); border-radius: 0.5rem; background: var(--surface); color: inherit; font-size: 0.95rem; }
.typing-setup button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }

.typing-card { display: flex; flex-direction: column; gap: 0.75rem; align-items: center; text-align: center; }
.typing-prompt { font-size: 2.5rem; line-height: 1.2; word-break: keep-all; }
.typing-meaning { font-size: 1.1rem; color: var(--ink-soft); min-height: 1.4em; }

.typing-input-wrap { display: flex; flex-direction: column; gap: 0.4rem; width: 100%; max-width: 28rem; }
.typing-input {
  width: 100%; min-height: 44px; padding: 0.75rem 1rem; font-size: 1.15rem; text-align: center;
  border: 1.5px solid var(--edge); border-radius: 0.75rem;
  background: var(--surface); color: inherit;
  autocapitalize: none; autocorrect: off; spellcheck: false; inputmode: text;
}
.typing-input:focus { outline: none; border-color: var(--accent); }

.typing-feedback { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 1.25rem; line-height: 1.6; min-height: 1.6em; letter-spacing: 0.1em; }
.typing-feedback .ok { color: var(--ok); }
.typing-feedback .bad { color: var(--danger); text-decoration: underline; }
.typing-feedback .pending { color: var(--ink-soft); }

.typing-hint { font-size: 1rem; color: var(--ink-soft); min-height: 1.3em; }
.typing-hint .pinyin { display: inline; }

.typing-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; }
.typing-actions button { min-height: 44px; padding: 0.55rem 0.8rem; border: 1.5px solid var(--edge); border-radius: 0.6rem; background: var(--surface); color: inherit; font-size: 0.95rem; }
.typing-actions button.primary { border-color: var(--accent); color: var(--accent); font-weight: 600; }

.typing-stats { display: flex; gap: 1.5rem; justify-content: center; font-variant-numeric: tabular-nums; font-size: 0.95rem; color: var(--ink-soft); }
.typing-stats .stat { display: flex; flex-direction: column; align-items: center; gap: 0.15rem; }
.typing-stats .stat-value { font-size: 1.3rem; font-weight: 600; color: inherit; }

.typing-summary { display: flex; flex-direction: column; gap: 0.5rem; align-items: center; text-align: center; padding: 1rem; }
.typing-summary .big { font-size: 1.5rem; font-weight: 600; }
.typing-summary .failed-list { max-height: 12rem; overflow-y: auto; width: 100%; max-width: 24rem; text-align: left; }
.typing-summary .failed-item { display: flex; justify-content: space-between; padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--line); font-size: 0.9rem; }
.typing-summary .failed-item:last-child { border-bottom: none; }
.typing-summary .failed-hanzi { font-size: 1.1rem; }
.typing-summary .failed-pinyin { color: var(--ink-soft); }

`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/**
 * Normalize pinyin for comparison: lowercase, strip tones/spaces/punctuation,
 * ü/v -> u. Matches the dictionary's tonelessKey but also removes spaces.
 * @param {string} input
 * @returns {string}
 */
export function normalizePinyin(input) {
  if (input == null) return '';
  let s = String(input).trim().toLowerCase();
  s = s.replace(/[1-5]/g, '');
  s = s.replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/g, (c) => {
    const map = {
      'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
      'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
      'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
      'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
      'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
      'ǖ': 'u', 'ǘ': 'u', 'ǚ': 'u', 'ǜ': 'u',
    };
    return map[c] || c;
  });
  s = s.replace(/[üv]/g, 'u');
  s = s.replace(/[^a-z]/g, '');
  return s;
}

/**
 * Compare user input letter by letter against target.
 * Returns array of {char: string, ok: boolean|null} where null = not reached yet.
 * @param {string} user - normalized user input
 * @param {string} target - normalized target pinyin
 * @returns {Array<{char: string, ok: boolean|null}>}
 */
export function compareLetterByLetter(user, target) {
  const u = normalizePinyin(user);
  const t = normalizePinyin(target);
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (i < u.length) {
      out.push({ char: t[i], ok: u[i] === t[i] });
    } else {
      out.push({ char: t[i], ok: null });
    }
  }
  return out;
}

/**
 * Calculate words per minute from correct characters and elapsed milliseconds.
 * A "word" = 5 characters (standard WPM definition).
 * @param {number} correctChars
 * @param {number} elapsedMs
 * @returns {number} WPM rounded to nearest integer
 */
export function wordsPerMinute(correctChars, elapsedMs) {
  if (elapsedMs <= 0) return 0;
  const minutes = elapsedMs / 60000;
  const words = correctChars / 5;
  return Math.round(words / minutes);
}

/** Load HSK words for a given level. */
async function loadHskWords(level) {
  try {
    const data = await fetchData(`hsk/${level}.json`);
    return data.items || [];
  } catch {
    return [];
  }
}

/** Load theme words. */
async function loadThemeWords(themeId) {
  try {
    const data = await fetchData(`themes/${themeId}.json`);
    return data.items || [];
  } catch {
    return [];
  }
}

/** Load due SRS cards. */
async function loadMyCards() {
  try {
    const cards = await getDueCards();
    return cards.map((card) => ({
      hanzi: card.hanzi,
      pinyin: card.pinyin,
      pinyinNumeric: card.pinyinNumeric,
      english: card.english?.join?.('; ') || card.defs?.join?.('; ') || '',
    }));
  } catch {
    return [];
  }
}

/** Pick random items from array, up to count. */
function pickRandom(arr, count) {
  const shuffled = shuffle(arr);
  return shuffled.slice(0, Math.min(count, arr.length));
}

/** Format item for display: hanzi + meaning. */
function formatPrompt(item) {
  return { hanzi: item.hanzi, meaning: item.english || item.defs?.join?.('; ') || '' };
}

function createTypingApp(container, ctx) {
  ensureStyles(document);

  const state = {
    source: 'hsk', // 'hsk' | 'mycards' | 'theme'
    hskLevel: DEFAULT_HSK,
    themeId: DEFAULT_THEME,
    items: [],
    currentIndex: 0,
    roundItems: [],
    userInput: '',
    startTime: 0,
    correctChars: 0,
    totalChars: 0,
    failed: [],
    phase: 'setup', // 'setup' | 'playing' | 'summary'
    destroyed: false,
  };

  // --- DOM nodes ---
  const setupSection = h('section', { class: 'typing-setup', hidden: false });
  const cardSection = h('section', { class: 'typing-card', hidden: true });
  const summarySection = h('section', { class: 'typing-summary', hidden: true });

  const sourceButtons = {
    hsk: h('button', {
      type: 'button',
      class: 'typing-source-btn',
      'aria-pressed': 'true',
      text: t('typing.source.hsk'),
      onclick: () => setSource('hsk'),
    }),
    mycards: h('button', {
      type: 'button',
      class: 'typing-source-btn',
      'aria-pressed': 'false',
      text: t('typing.source.myCards'),
      onclick: () => setSource('mycards'),
    }),
    theme: h('button', {
      type: 'button',
      class: 'typing-source-btn',
      'aria-pressed': 'false',
      text: t('typing.source.theme'),
      onclick: () => setSource('theme'),
    }),
  };

  const hskSelect = h('select', {
      'aria-label': t('typing.hskLevelLabel'),
      onchange: (e) => { state.hskLevel = Number(e.target.value); },
    }, ...[1, 2, 3, 4, 5, 6].map((l) => h('option', { value: String(l), selected: l === DEFAULT_HSK, text: 'HSK ' + l })));

  const themeSelect = h('select', {
    'aria-label': t('typing.themeLabel'),
    onchange: (e) => { state.themeId = e.target.value; },
    hidden: true,
  });

  const roundCountInput = h('input', {
    type: 'number', min: '1', max: '50', value: String(ROUND_SIZE),
    'aria-label': t('typing.roundSizeLabel'),
    onchange: (e) => { state.roundSize = Math.max(1, Math.min(50, Number(e.target.value) || ROUND_SIZE)); },
    style: 'width: 80px;',
  });

  const startBtn = h('button', {
    type: 'button', class: 'primary', text: t('typing.start'),
    onclick: startRound,
  });

  const promptEl = h('div', { class: 'typing-prompt' });
  const meaningEl = h('div', { class: 'typing-meaning' });
  const inputEl = h('input', {
    type: 'text',
    class: 'typing-input',
    'aria-label': t('typing.inputLabel'),
    autocomplete: 'off',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
    inputMode: 'text',
    oninput: onInput,
    onkeydown: onKeyDown,
  });
  const feedbackEl = h('div', { class: 'typing-feedback', 'aria-live': 'polite' });
  const hintEl = h('div', { class: 'typing-hint' });
  const hintBtn = h('button', {
    type: 'button', text: t('typing.showHint'),
    onclick: toggleHint,
  });
  const nextBtn = h('button', {
    type: 'button', class: 'primary', text: t('typing.next'),
    onclick: nextItem,
    hidden: true,
  });
  const addReviewBtn = h('button', {
    type: 'button', text: t('typing.addToReview'),
    onclick: addCurrentToReview,
    hidden: true,
  });
  const speakBtn = h('button', {
    type: 'button', text: t('typing.speak'),
    onclick: speakCurrent,
  });

  const statsEl = h('div', { class: 'typing-stats', hidden: true });
  const statWpm = h('div', { class: 'stat' }, h('div', { class: 'stat-value', text: '0' }), h('div', { text: t('typing.wpm') }));
  const statAcc = h('div', { class: 'stat' }, h('div', { class: 'stat-value', text: '0%' }), h('div', { text: t('typing.accuracy') }));
  const statProgress = h('div', { class: 'stat' }, h('div', { class: 'stat-value', text: '0/10' }), h('div', { text: t('typing.progress') }));
  statsEl.append(statWpm, statAcc, statProgress);

  const actionsEl = h('div', { class: 'typing-actions' }, hintBtn, speakBtn, nextBtn, addReviewBtn);

  cardSection.append(promptEl, meaningEl, h('div', { class: 'typing-input-wrap' }, inputEl), feedbackEl, hintEl, actionsEl, statsEl);

  const summaryTitle = h('h2', { text: t('typing.roundComplete') });
  const summaryWpm = h('p', { class: 'big' });
  const summaryAcc = h('p', { class: 'big' });
  const summaryFailed = h('div', { class: 'failed-list' });
  const summaryActions = h('div', { class: 'typing-actions' },
    h('button', { type: 'button', class: 'primary', text: t('typing.playAgain'), onclick: () => startRound() }),
    h('button', { type: 'button', text: t('typing.changeSettings'), onclick: showSetup })
  );
  summarySection.append(summaryTitle, summaryWpm, summaryAcc, summaryFailed, summaryActions);

  const section = h('section', { class: 'typing' }, setupSection, cardSection, summarySection);

  // --- Setup UI ---
  function buildSetup() {
    reset(setupSection);
    setupSection.append(
      h('div', { class: 'typing-setup-row' },
        h('label', { text: t('typing.sourceLabel') }),
        sourceButtons.hsk, sourceButtons.mycards, sourceButtons.theme
      ),
      h('div', { class: 'typing-setup-row', id: 'hsk-row' },
        h('label', { text: t('typing.hskLevelLabel') }),
        hskSelect
      ),
      h('div', { class: 'typing-setup-row', id: 'theme-row', hidden: true },
        h('label', { text: t('typing.themeLabel') }),
        themeSelect
      ),
      h('div', { class: 'typing-setup-row' },
        h('label', { text: t('typing.roundSizeLabel') }),
        roundCountInput
      ),
      h('div', { class: 'typing-setup-row', style: 'justify-content: flex-end;' }, startBtn)
    );
    loadThemeOptions();
    updateSourceUI();
  }

  async function loadThemeOptions() {
    try {
      const index = await fetchData('themes/index.json');
      themeSelect.replaceChildren(
        ...index.map((th) => h('option', { value: th.id, selected: th.id === DEFAULT_THEME, text: th.title }))
      );
    } catch {
      themeSelect.replaceChildren(h('option', { value: DEFAULT_THEME, text: t('typing.themeDefault') }));
    }
  }

  function setSource(src) {
    state.source = src;
    updateSourceUI();
  }

  function updateSourceUI() {
    for (const [key, btn] of Object.entries(sourceButtons)) {
      btn.setAttribute('aria-pressed', key === state.source ? 'true' : 'false');
    }
    setupSection.querySelector('#hsk-row').hidden = state.source !== 'hsk';
    setupSection.querySelector('#theme-row').hidden = state.source !== 'theme';
  }

  function showSetup() {
    state.phase = 'setup';
    setupSection.hidden = false;
    cardSection.hidden = true;
    summarySection.hidden = true;
  }

  async function startRound() {
    state.roundSize = Math.max(1, Math.min(50, Number(roundCountInput.value) || ROUND_SIZE));

    let pool = [];
    if (state.source === 'hsk') {
      pool = await loadHskWords(state.hskLevel);
    } else if (state.source === 'mycards') {
      pool = await loadMyCards();
    } else if (state.source === 'theme') {
      pool = await loadThemeWords(state.themeId);
    }

    if (!pool.length) {
      alert(t('typing.noData'));
      return;
    }

    state.items = pickRandom(pool, state.roundSize);
    state.currentIndex = 0;
    state.correctChars = 0;
    state.totalChars = 0;
    state.failed = [];
    state.phase = 'playing';

    setupSection.hidden = true;
    cardSection.hidden = false;
    summarySection.hidden = true;
    statsEl.hidden = false;
    nextBtn.hidden = true;
    addReviewBtn.hidden = true;
    hintEl.textContent = '';
    hintBtn.textContent = t('typing.showHint');

    state.startTime = Date.now();
    showCurrent();
    inputEl.focus({ preventScroll: true });
  }

  function showCurrent() {
    const item = state.items[state.currentIndex];
    if (!item) return finishRound();

    const prompt = formatPrompt(item);
    promptEl.textContent = prompt.hanzi;
    meaningEl.textContent = prompt.meaning;
    inputEl.value = '';
    state.userInput = '';
    renderFeedback('');
    hintEl.textContent = '';
    hintBtn.textContent = t('typing.showHint');
    nextBtn.hidden = true;
    addReviewBtn.hidden = true;
    updateStats();
  }

  function onInput(e) {
    state.userInput = e.target.value;
    const item = state.items[state.currentIndex];
    if (!item) return;
    const target = item.pinyinNumeric || item.pinyin || '';
    const comparison = compareLetterByLetter(state.userInput, target);
    renderFeedback(comparison);
    updateStats();

    // Auto-advance when complete and correct
    const allCorrect = comparison.length > 0 && comparison.every((c) => c.ok === true);
    if (allCorrect && state.userInput.length >= normalizePinyin(target).length) {
      onCorrect();
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = state.items[state.currentIndex];
      if (!item) return;
      const target = item.pinyinNumeric || item.pinyin || '';
      const comparison = compareLetterByLetter(state.userInput, target);
      const allCorrect = comparison.length > 0 && comparison.every((c) => c.ok === true);
      if (allCorrect) {
        onCorrect();
      } else {
        // Show what was wrong, allow retry
        nextBtn.hidden = false;
        addReviewBtn.hidden = false;
      }
    }
  }

  function onCorrect() {
    const item = state.items[state.currentIndex];
    const target = item.pinyinNumeric || item.pinyin || '';
    const normTarget = normalizePinyin(target);
    state.correctChars += normTarget.length;
    state.totalChars += normTarget.length;
    nextItem();
  }

  function nextItem() {
    state.currentIndex += 1;
    if (state.currentIndex >= state.items.length) {
      finishRound();
    } else {
      showCurrent();
    }
  }

  function toggleHint() {
    const item = state.items[state.currentIndex];
    if (!item) return;
    const pinyin = item.pinyin || item.pinyinNumeric || '';
    if (hintEl.textContent) {
      hintEl.textContent = '';
      hintBtn.textContent = t('typing.showHint');
    } else {
      hintEl.innerHTML = `<span class="pinyin">${pinyinHtml(pinyin)}</span>`;
      hintBtn.textContent = t('typing.hideHint');
    }
  }

  async function speakCurrent() {
    const item = state.items[state.currentIndex];
    if (!item) return;
    await speak(item.hanzi, { lang: 'zh-CN' });
  }

  async function addCurrentToReview() {
    const item = state.items[state.currentIndex];
    if (!item) return;
    try {
      await addToReview({
        hanzi: item.hanzi,
        pinyin: item.pinyin,
        pinyinNumeric: item.pinyinNumeric,
        english: item.english || item.defs || [],
        source: 'typing',
        sourceDetail: state.source === 'hsk' ? `hsk${state.hskLevel}` : state.source,
      });
      addReviewBtn.textContent = t('typing.addedToReview');
      addReviewBtn.disabled = true;
      setTimeout(() => {
        addReviewBtn.textContent = t('typing.addToReview');
        addReviewBtn.disabled = false;
      }, 1500);
    } catch {
      addReviewBtn.textContent = t('typing.reviewError');
      setTimeout(() => {
        addReviewBtn.textContent = t('typing.addToReview');
      }, 1500);
    }
  }

  function renderFeedback(comparison) {
    if (!comparison || !comparison.length) {
      feedbackEl.textContent = '';
      return;
    }
    feedbackEl.replaceChildren(
      ...comparison.map((c) =>
        h('span', { class: c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'pending', text: c.char })
      )
    );
  }

  function updateStats() {
    const elapsed = Date.now() - state.startTime;
    const wpm = wordsPerMinute(state.correctChars, elapsed);
    const accuracy = state.totalChars > 0 ? Math.round((state.correctChars / state.totalChars) * 100) : 100;
    statWpm.querySelector('.stat-value').textContent = String(wpm);
    statAcc.querySelector('.stat-value').textContent = `${accuracy}%`;
    statProgress.querySelector('.stat-value').textContent = `${state.currentIndex + 1}/${state.items.length}`;
  }

  function finishRound() {
    state.phase = 'summary';
    cardSection.hidden = true;
    summarySection.hidden = false;
    statsEl.hidden = true;

    const elapsed = Date.now() - state.startTime;
    const wpm = wordsPerMinute(state.correctChars, elapsed);
    const accuracy = state.totalChars > 0 ? Math.round((state.correctChars / state.totalChars) * 100) : 100;

    summaryWpm.textContent = t('typing.summaryWpm', { wpm });
    summaryAcc.textContent = t('typing.summaryAccuracy', { accuracy });

    summaryFailed.replaceChildren();
    if (state.failed.length === 0) {
      summaryFailed.append(h('p', { text: t('typing.noMistakes') }));
    } else {
      for (const item of state.failed) {
        summaryFailed.append(
          h('div', { class: 'failed-item' },
            h('span', { class: 'failed-hanzi', text: item.hanzi }),
            h('span', { class: 'failed-pinyin', text: item.pinyin || item.pinyinNumeric || '' })
          )
        );
      }
    }

    // Fire lesson_done event
    window.dispatchEvent(new CustomEvent('chino:lesson_done', {
      detail: {
        area: 'typing',
        round: state.items.length,
        wpm,
        accuracy,
        failed: state.failed.map((f) => f.hanzi),
      },
    }));
  }

  function destroy() {
    state.destroyed = true;
  }

  // Build initial setup
  buildSetup();

  reset(container).append(section);

  return { destroy };
}

/**
 * Screen entry point.
 * @param {HTMLElement} container
 * @param {object} ctx - { route, navigate }
 */
export async function render(container, ctx = {}) {
  const app = createTypingApp(container, ctx);
  return () => app.destroy();
}