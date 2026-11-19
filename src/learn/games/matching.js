/**
 * Matching game — 6 pairs hanzi <-> english (or pinyin), tap to match.
 * Tracks mistakes and time. Fires 'chino:lesson_done' on completion.
 *
 * Pure helpers (tested in tests/games.test.mjs):
 *   generateMatchingRound(words, { count = 6, mode = 'english' }) -> { pairs, options }
 *   checkMatching(pairs, response) -> { correct, score, matched, total }
 *
 * Screen contract: titleKey + render(container, ctx)
 */

import { t } from '../../i18n.js';
import { h, reset } from '../../dom.js';
import { speak } from '../../audio.js';
import { addToReview } from '../../srs.js';
import { pinyinHtml } from '../../tone.js';
import { search } from '../../dictionary.js';
import storage from '../../storage.js';
import { fetchData } from '../../data-url.js';

export const titleKey = 'games.matching.title';
export const id = 'matching';

const STYLE_ID = 'matching-style';
const DEFAULT_COUNT = 6;
const MODES = ['english', 'pinyin'];

/** CSS injected once. */
const CSS = `
.matching { display: flex; flex-direction: column; gap: 0.75rem; }
.matching-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
.matching-stats { display: flex; gap: 1rem; font-variant-numeric: tabular-nums; opacity: 0.85; font-size: 0.9rem; }
.matching-stats span { display: flex; align-items: center; gap: 0.3rem; }
.matching-board { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
.matching-col { display: flex; flex-direction: column; gap: 0.5rem; }
.matching-chip { min-height: 48px; padding: 0.75rem 1rem; border: 2px solid var(--line, #c9c4bd); border-radius: 0.75rem; background: var(--bg, #fff); color: inherit; font-size: 1.1rem; text-align: center; touch-action: manipulation; transition: border-color 0.15s, background 0.15s, transform 0.05s; }
.matching-chip:active { transform: scale(0.98); }
.matching-chip.selected { border-color: #b3261e; background: #fef2f2; }
.matching-chip.matched { border-color: #2e7d32; background: #f1f8e9; pointer-events: none; }
.matching-chip.wrong { border-color: #c62828; background: #fef2f2; animation: matching-shake 0.3s; }
@keyframes matching-shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }
.matching-pinyin { font-size: 0.85rem; opacity: 0.75; margin-top: 0.2rem; }
.matching-hint { text-align: center; opacity: 0.7; font-size: 0.9rem; margin: 0; }
.matching-result { text-align: center; }
.matching-result h2 { margin: 0 0 0.5rem; }
.matching-result .score { font-size: 1.5rem; font-variant-numeric: tabular-nums; margin: 0.5rem 0; }
.matching-actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
.matching-actions button { min-height: 48px; padding: 0.6rem 1rem; border: 1px solid var(--line, #c9c4bd); border-radius: 0.6rem; background: var(--bg, #fff); color: inherit; touch-action: manipulation; }
.matching-actions button.primary { border-color: #b3261e; background: #b3261e; color: #fff; }
@media (prefers-color-scheme: dark) {
  .matching-chip { background: #1c1a19; border-color: #3d3732; }
  .matching-chip.selected { background: #3d1a1a; border-color: #ef5350; }
  .matching-chip.matched { background: #1a3d1a; border-color: #66bb6a; }
  .matching-chip.wrong { background: #3d1a1a; border-color: #ef5350; }
  .matching-actions button { background: #1c1a19; border-color: #3d3732; }
  .matching-actions button.primary { background: #b3261e; border-color: #b3261e; }
}
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/**
 * Generate a matching round from a word list.
 * @param {Array<{hanzi:string,pinyin:string,english:string|string[]}>} words
 * @param {{count?:number, mode?:'english'|'pinyin'}} opts
 * @returns {{pairs:Array<{hanzi:string,target:string,pinyin:string}>, options:string[]}}
 */
export function generateMatchingRound(words, { count = DEFAULT_COUNT, mode = 'english' } = {}) {
  if (!Array.isArray(words) || words.length === 0) return { pairs: [], options: [] };
  const shuffled = [...words].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(count, shuffled.length));
  const pairs = selected.map((w) => ({
    hanzi: w.hanzi,
    target: mode === 'pinyin' ? w.pinyin : (Array.isArray(w.english) ? w.english[0] : w.english),
    pinyin: w.pinyin,
  }));
  // Create options: all targets + some distractors from remaining words
  const targets = pairs.map((p) => p.target);
  const remaining = shuffled.slice(count);
  const distractors = remaining
    .map((w) => (mode === 'pinyin' ? w.pinyin : (Array.isArray(w.english) ? w.english[0] : w.english)))
    .filter((t) => !targets.includes(t))
    .slice(0, Math.max(0, count - targets.length));
  const options = [...targets, ...distractors].sort(() => Math.random() - 0.5);
  return { pairs, options };
}

/**
 * Check a matching response.
 * @param {Array<{hanzi:string,target:string}>} pairs
 * @param {Object<string,string>} response - { hanzi: chosenTarget }
 * @returns {{correct:boolean, score:number, matched:number, total:number}}
 */
export function checkMatching(pairs, response) {
  const given = response ?? {};
  let matched = 0;
  for (const pair of pairs) {
    if (given[pair.hanzi] === pair.target) matched += 1;
  }
  const total = pairs.length;
  const score = total ? matched / total : 0;
  return { correct: matched === total, score, matched, total };
}

/** Load words from a source: 'hsk1' | 'review' | 'theme:<name>' */
async function loadWords(source) {
  if (source === 'hsk1') {
    const data = await fetchData('hsk/1.json');
    return data.items ?? [];
  }
  if (source === 'review') {
    const list = await storage.list('srs');
    return list.map((row) => row.value).filter(Boolean);
  }
  if (source.startsWith('theme:')) {
    const theme = source.slice(6);
    const results = await search(theme, { limit: 50 });
    return results.map((r) => ({ hanzi: r.simp, pinyin: r.pinyinTone, english: r.defs }));
  }
  return [];
}

/** Render the matching game screen. */
export async function render(container, ctx) {
  ensureStyles(document);

  const segments = ctx?.route?.segments ?? [];
  const gameId = segments[0] ?? id;
  const sourceParam = segments[1] ?? 'hsk1';

  // Game state
  let words = [];
  let round = { pairs: [], options: [] };
  let selected = null; // { hanzi, btnEl }
  let matched = new Set();
  let mistakes = 0;
  let startTime = Date.now();
  let finished = false;

  // Load words and start
  async function start() {
    reset(container);
    container.append(h('p', { class: 'pill', text: t('games.loading') }));
    try {
      words = await loadWords(sourceParam);
      if (!words.length) throw new Error('no words');
      newRound();
    } catch (err) {
      reset(container);
      container.append(
        h('section', { class: 'card' }, h('p', { text: t('games.error', { message: String(err?.message ?? err) }) })),
      );
    }
  }

  function newRound() {
    round = generateMatchingRound(words, { count: DEFAULT_COUNT, mode: 'english' });
    selected = null;
    matched.clear();
    mistakes = 0;
    startTime = Date.now();
    finished = false;
    draw();
  }

  function draw() {
    reset(container);
    const section = h('section', { class: 'matching' });

    // Header with stats
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const header = h(
      'header',
      { class: 'matching-header' },
      h('h2', { text: t(titleKey) }),
      h('div', { class: 'matching-stats' },
        h('span', { text: `${t('games.matching.mistakes')}: ${mistakes}` }),
        h('span', { text: `${t('games.matching.time')}: ${elapsed}s` }),
        h('span', { text: `${t('games.matching.matched')}: ${matched.size}/${round.pairs.length}` }),
      ),
    );
    section.append(header);

    // Board
    const board = h('div', { class: 'matching-board' });
    const leftCol = h('div', { class: 'matching-col' });
    const rightCol = h('div', { class: 'matching-col' });

    // Left: hanzi chips
    for (const pair of round.pairs) {
      const isMatched = matched.has(pair.hanzi);
      const btn = h(
        'button',
        {
          type: 'button',
          class: `matching-chip${isMatched ? ' matched' : ''}${selected?.hanzi === pair.hanzi ? ' selected' : ''}`,
          disabled: isMatched || finished,
          onclick: () => onLeftClick(pair, btn),
        },
        h('span', { class: 'hanzi', text: pair.hanzi }),
        h('span', { class: 'matching-pinyin', html: pinyinHtml(pair.pinyin) }),
      );
      leftCol.append(btn);
    }

    // Right: target chips (shuffled options)
    for (const option of round.options) {
      const pair = round.pairs.find((p) => p.target === option);
      const isMatched = pair && matched.has(pair.hanzi);
      const btn = h(
        'button',
        {
          type: 'button',
          class: `matching-chip${isMatched ? ' matched' : ''}`,
          disabled: isMatched || finished,
          onclick: () => onRightClick(option, btn),
        },
        h('span', { text: option }),
      );
      rightCol.append(btn);
    }

    board.append(leftCol, rightCol);
    section.append(board);

    // Hint
    const hintText = selected
      ? t('games.matching.hintSelectMatch')
      : t('games.matching.hintSelectHanzi');
    section.append(h('p', { class: 'matching-hint', text: hintText }));

    // Result overlay
    if (finished) {
      const timeMs = Date.now() - startTime;
      const result = checkMatching(round.pairs, Object.fromEntries(
        [...matched].map((hanzi) => [hanzi, round.pairs.find((p) => p.hanzi === hanzi)?.target])
      ));
      const resultEl = h(
        'div',
        { class: 'matching-result card' },
        h('h2', { text: t('games.matching.complete') }),
        h('p', { class: 'score', text: `${t('games.matching.score')}: ${result.matched}/${result.total}` }),
        h('p', { text: `${t('games.matching.mistakes')}: ${mistakes}` }),
        h('p', { text: `${t('games.matching.time')}: ${Math.floor(timeMs / 1000)}s` }),
        h('div', { class: 'matching-actions' },
          h('button', { type: 'button', class: 'btn primary', text: t('games.matching.playAgain'), onclick: newRound }),
          h('button', { type: 'button', text: t('games.matching.back'), onclick: () => ctx.navigate('learn/games') }),
        ),
      );
      section.append(resultEl);

      // Fire lesson_done event
      window.dispatchEvent(
        new CustomEvent('chino:lesson_done', {
          detail: { gameId, score: result.matched, total: result.total, timeMs, mistakes },
        }),
      );
    }

    container.append(section);
    container.focus({ preventScroll: true });
  }

  function onLeftClick(pair, btnEl) {
    if (finished || matched.has(pair.hanzi)) return;
    selected = { hanzi: pair.hanzi, btnEl };
    draw();
  }

  function onRightClick(target, btnEl) {
    if (finished || !selected) return;
    const pair = round.pairs.find((p) => p.hanzi === selected.hanzi);
    if (!pair) return;

    if (pair.target === target) {
      // Correct match
      matched.add(pair.hanzi);
      selected = null;
      if (matched.size === round.pairs.length) {
        finished = true;
      }
    } else {
      // Wrong match
      mistakes += 1;
      selected.btnEl.classList.add('wrong');
      btnEl.classList.add('wrong');
      setTimeout(() => {
        selected.btnEl.classList.remove('wrong');
        btnEl.classList.remove('wrong');
        selected = null;
        draw();
      }, 500);
      return;
    }
    draw();
  }

  await start();
  return () => {};
}