/**
 * Memory game — cards face down with hanzi/meaning pairs.
 * Tap to flip, find matching pairs. Tracks mistakes and time.
 * Fires 'chino:lesson_done' on completion.
 *
 * Pure helpers (tested in tests/games.test.mjs):
 *   generateMemoryRound(words, { count = 6 }) -> { cards }
 *   checkMemory(cards, flips) -> { correct, score, matched, total, complete }
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

export const titleKey = 'games.memory.title';
export const id = 'memory';

const STYLE_ID = 'memory-style';
const DEFAULT_COUNT = 6; // 6 pairs = 12 cards

/** CSS injected once. */
const CSS = `
.memory { display: flex; flex-direction: column; gap: 0.75rem; }
.memory-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
.memory-stats { display: flex; gap: 1rem; font-variant-numeric: tabular-nums; opacity: 0.85; font-size: 0.9rem; }
.memory-stats span { display: flex; align-items: center; gap: 0.3rem; }
.memory-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; max-width: 28rem; margin: 0 auto; }
.memory-card { aspect-ratio: 1 / 1; perspective: 600px; cursor: pointer; touch-action: manipulation; }
.memory-card-inner { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1); border-radius: 0.75rem; }
.memory-card.flipped .memory-card-inner { transform: rotateY(180deg); }
.memory-card.matched .memory-card-inner { opacity: 0.6; }
.memory-card-face { position: absolute; width: 100%; height: 100%; backface-visibility: hidden; border-radius: 0.75rem; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0.75rem; border: 2px solid var(--line, #c9c4bd); background: var(--bg, #fff); color: inherit; font-size: 1.1rem; text-align: center; box-sizing: border-box; }
.memory-card-back { background: linear-gradient(135deg, var(--bg, #fff), var(--board, #faf8f5)); border-color: #b3261e; }
.memory-card-front { transform: rotateY(180deg); }
.memory-card.hanzi .memory-card-front { background: #fef2f2; border-color: #b3261e; }
.memory-card.meaning .memory-card-front { background: #f1f8e9; border-color: #2e7d32; }
.memory-hanzi { font-size: 2.5rem; line-height: 1; }
.memory-pinyin { font-size: 0.85rem; opacity: 0.75; margin-top: 0.25rem; }
.memory-meaning { font-size: 1rem; }
.memory-hint { text-align: center; opacity: 0.7; font-size: 0.9rem; margin: 0; }
.memory-result { text-align: center; }
.memory-result h2 { margin: 0 0 0.5rem; }
.memory-result .score { font-size: 1.5rem; font-variant-numeric: tabular-nums; margin: 0.5rem 0; }
.memory-actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
.memory-actions button { padding: 0.6rem 1rem; border: 1px solid var(--line, #c9c4bd); border-radius: 0.6rem; background: var(--bg, #fff); color: inherit; }
.memory-actions button.primary { border-color: #b3261e; background: #b3261e; color: #fff; }
@media (prefers-color-scheme: dark) {
  .memory-card-face { background: #1c1a19; border-color: #3d3732; }
  .memory-card-back { background: linear-gradient(135deg, #1c1a19, #2a2522); border-color: #ef5350; }
  .memory-card.hanzi .memory-card-front { background: #3d1a1a; border-color: #ef5350; }
  .memory-card.meaning .memory-card-front { background: #1a3d1a; border-color: #66bb6a; }
  .memory-actions button { background: #1c1a19; border-color: #3d3732; }
  .memory-actions button.primary { background: #b3261e; border-color: #b3261e; }
}
@media (max-width: 480px) {
  .memory-grid { grid-template-columns: repeat(3, 1fr); }
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
 * Generate a memory round from a word list.
 * @param {Array<{hanzi:string,pinyin:string,english:string|string[]}>} words
 * @param {{count?:number}} opts
 * @returns {{cards:Array<{id:string,hanzi:string,pinyin:string,meaning:string,type:'hanzi'|'meaning',flipped:boolean,matched:boolean}>}}
 */
export function generateMemoryRound(words, { count = DEFAULT_COUNT } = {}) {
  if (!Array.isArray(words) || words.length === 0) return { cards: [] };
  const shuffled = [...words].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(count, shuffled.length));
  const cards = [];
  for (const w of selected) {
    const meaning = Array.isArray(w.english) ? w.english[0] : w.english;
    const id = `${w.hanzi}|${meaning}`.replace(/\s+/g, '_');
    cards.push(
      { id: `${id}-hanzi`, hanzi: w.hanzi, pinyin: w.pinyin, meaning, type: 'hanzi', flipped: false, matched: false },
      { id: `${id}-meaning`, hanzi: w.hanzi, pinyin: w.pinyin, meaning, type: 'meaning', flipped: false, matched: false },
    );
  }
  // Shuffle cards
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return { cards };
}

/**
 * Check memory game state after a flip.
 * @param {Array<{id:string,type:string,matched:boolean,flipped:boolean}>} cards
 * @param {Array<string>} flippedIds - ids of currently flipped cards
 * @returns {{correct:boolean, score:number, matched:number, total:number, complete:boolean, pairComplete:boolean|null}}
 */
export function checkMemory(cards, flippedIds) {
  const flipped = cards.filter((c) => flippedIds.includes(c.id));
  let pairComplete = null;
  if (flipped.length === 2) {
    const [a, b] = flipped;
    const isPair = a.type !== b.type && a.hanzi === b.hanzi && a.meaning === b.meaning;
    pairComplete = isPair;
  } else if (flipped.length > 2) {
    pairComplete = false;
  }
  // Count matched pairs (each pair has 2 cards, both must be matched)
  const matchedPairs = cards.filter((c) => c.matched && c.type === 'hanzi').length;
  const total = cards.length / 2; // pairs
  const score = total ? matchedPairs / total : 0;
  const complete = matchedPairs === total;
  return { correct: pairComplete === true, score, matched: matchedPairs, total, complete, pairComplete };
}

/** Load words from a source: 'hsk1' | 'review' | 'theme:<name>' */
async function loadWords(source) {
  if (source === 'hsk1') {
    const res = await fetch('/data/hsk/1.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('memory: failed to load HSK1');
    const data = await res.json();
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

/** Render the memory game screen. */
export async function render(container, ctx) {
  ensureStyles(document);

  const segments = ctx?.route?.segments ?? [];
  const gameId = segments[0] ?? id;
  const sourceParam = segments[1] ?? 'hsk1';

  // Game state
  let words = [];
  let round = { cards: [] };
  let flippedIds = [];
  let mistakes = 0;
  let startTime = Date.now();
  let finished = false;
  let lockInput = false;

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
    round = generateMemoryRound(words, { count: DEFAULT_COUNT });
    flippedIds = [];
    mistakes = 0;
    startTime = Date.now();
    finished = false;
    lockInput = false;
    draw();
  }

  function draw() {
    reset(container);
    const section = h('section', { class: 'memory' });

    // Header with stats
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const matchedPairs = round.cards.filter((c) => c.matched).length / 2;
    const header = h(
      'header',
      { class: 'memory-header' },
      h('h2', { text: t(titleKey) }),
      h('div', { class: 'memory-stats' },
        h('span', { text: `${t('games.memory.mistakes')}: ${mistakes}` }),
        h('span', { text: `${t('games.memory.time')}: ${elapsed}s` }),
        h('span', { text: `${t('games.memory.matched')}: ${matchedPairs}/${round.cards.length / 2}` }),
      ),
    );
    section.append(header);

    // Grid
    const grid = h('div', { class: 'memory-grid' });
    for (const card of round.cards) {
      const cardEl = h(
        'div',
        {
          class: `memory-card${card.flipped ? ' flipped' : ''}${card.matched ? ' matched' : ''}`,
          'data-id': card.id,
          onclick: () => onCardClick(card.id),
        },
        h('div', { class: 'memory-card-inner' },
          h('div', { class: 'memory-card-face memory-card-back' },
            h('span', { class: 'memory-back-icon', text: '?' }),
          ),
          h('div', { class: `memory-card-face memory-card-front ${card.type}` },
            card.type === 'hanzi'
              ? [
                  h('span', { class: 'memory-hanzi', text: card.hanzi }),
                  h('span', { class: 'memory-pinyin', html: pinyinHtml(card.pinyin) }),
                ]
              : h('span', { class: 'memory-meaning', text: card.meaning }),
          ),
        ),
      );
      grid.append(cardEl);
    }
    section.append(grid);

    // Hint
    if (!finished) {
      const hintText = flippedIds.length === 1
        ? t('games.memory.hintSecond')
        : t('games.memory.hintFirst');
      section.append(h('p', { class: 'memory-hint', text: hintText }));
    }

    // Result overlay
    if (finished) {
      const timeMs = Date.now() - startTime;
      const totalPairs = round.cards.length / 2;
      const resultEl = h(
        'div',
        { class: 'memory-result card' },
        h('h2', { text: t('games.memory.complete') }),
        h('p', { class: 'score', text: `${t('games.memory.score')}: ${totalPairs}/${totalPairs}` }),
        h('p', { text: `${t('games.memory.mistakes')}: ${mistakes}` }),
        h('p', { text: `${t('games.memory.time')}: ${Math.floor(timeMs / 1000)}s` }),
        h('div', { class: 'memory-actions' },
          h('button', { type: 'button', class: 'btn primary', text: t('games.memory.playAgain'), onclick: newRound }),
          h('button', { type: 'button', text: t('games.memory.back'), onclick: () => ctx.navigate('learn/games') }),
        ),
      );
      section.append(resultEl);

      // Fire lesson_done event
      window.dispatchEvent(
        new CustomEvent('chino:lesson_done', {
          detail: { gameId, score: totalPairs, total: totalPairs, timeMs, mistakes },
        }),
      );
    }

    container.append(section);
    container.focus({ preventScroll: true });
  }

  function onCardClick(cardId) {
    if (finished || lockInput) return;
    const card = round.cards.find((c) => c.id === cardId);
    if (!card || card.flipped || card.matched) return;

    card.flipped = true;
    flippedIds.push(cardId);

    if (flippedIds.length === 2) {
      lockInput = true;
      const check = checkMemory(round.cards, flippedIds);
      if (check.pairComplete) {
        // Match found
        for (const id of flippedIds) {
          const c = round.cards.find((x) => x.id === id);
          if (c) c.matched = true;
        }
        flippedIds = [];
        lockInput = false;
        if (check.complete) {
          finished = true;
        }
      } else {
        // No match - flip back after delay
        mistakes += 1;
        setTimeout(() => {
          for (const id of flippedIds) {
            const c = round.cards.find((x) => x.id === id);
            if (c) c.flipped = false;
          }
          flippedIds = [];
          lockInput = false;
          draw();
        }, 800);
      }
    }
    draw();
  }

  await start();
  return () => {};
}