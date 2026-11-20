/**
 * Sentence Builder — shows an English (or Spanish) sentence and shuffled
 * Chinese word chips; the player taps the chips in the right order.
 * 10 sentences per game. Fires 'chino:lesson_done' once, when the game ends.
 *
 * Pure helpers (tests/games-builder.test.mjs):
 *   segmentSentence(zh) -> Promise<string[]>          simplified words, [] if unknown hanzi
 *   generateBuilderRound(sentences, { count }) -> Promise<{ rounds, total }>
 *   checkBuilderOrder(correctWords, userWords, alternatives) -> { correct, score, matched, total, alternative }
 *   chipOrder(n, rnd?) -> number[]                    shuffled indexes, never the identity for n > 1
 *   roundPoints({ correct, hints }) -> number
 *
 * Screen contract: titleKey + render(container, ctx).
 * Route: learn/games/builder[/<source>] with source = sentences (default) | lessons | readings.
 * Sentences are the English (or Spanish, via data/es) text; chips are simplified hanzi only.
 */

import { t } from '../../i18n.js';
import { h, reset } from '../../dom.js';
import { pinyinHtml } from '../../tone.js';
import { fetchData } from '../../data-url.js';
import { segment, lookup } from '../../dictionary.js';

export const titleKey = 'games.builder.title';
export const id = 'builder';

const STYLE_ID = 'builder-style';
const DEFAULT_COUNT = 10;
const MIN_WORDS = 2;
const MAX_POINTS = 3;
const SOURCES = ['sentences', 'lessons', 'readings'];
const HANZI_RE = /[\u3400-\u9fff\uf900-\ufaff]/;

/** CSS injected once. */
const CSS = `
.builder { display: flex; flex-direction: column; gap: 0.75rem; }
.builder-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
.builder-header h2 { margin: 0; }
.builder-stats { display: flex; gap: 1rem; font-size: 0.9rem; opacity: 0.85; font-variant-numeric: tabular-nums; flex-wrap: wrap; }
.builder-target { text-align: center; padding: 1rem; background: var(--surface); border: 1.5px solid var(--edge); border-radius: 0.75rem; font-size: 1.1rem; line-height: 1.5; color: var(--ink); }
.builder-answer { display: flex; flex-wrap: wrap; gap: 0.4rem; justify-content: center; min-height: 52px; padding: 0.75rem; background: var(--surface); border: 2px dashed var(--line); border-radius: 0.75rem; }
.builder-answer.ok { border-style: solid; border-color: var(--ok); background: var(--ok-wash); }
.builder-answer.bad { border-style: solid; border-color: var(--danger); background: var(--danger-wash); }
.builder-answer button, .builder-chips button { min-height: 48px; min-width: 48px; padding: 0.5rem 0.9rem; border: 1.5px solid var(--edge); border-radius: 0.75rem; background: var(--surface); color: inherit; font-size: 1.1rem; touch-action: manipulation; }
.builder-answer button { border-color: var(--accent); background: var(--accent-wash); }
.builder-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; }
.builder-chips button.used { opacity: 0.35; }
.builder-chips button:disabled, .builder-answer button:disabled { cursor: default; }
.builder-hint, .builder-feedback { text-align: center; margin: 0; font-size: 0.95rem; }
.builder-pinyin { text-align: center; font-size: 1rem; margin: 0; }
.builder-actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
.builder-actions button { min-height: 48px; padding: 0.6rem 1rem; border: 1.5px solid var(--edge); border-radius: 0.6rem; background: var(--surface); color: inherit; touch-action: manipulation; }
.builder-actions button.primary { border-color: var(--accent); background: var(--accent); color: var(--accent-fg); }
.builder-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.builder-result { text-align: center; }
.builder-result h2 { margin: 0 0 0.5rem; }
.builder-result .score { font-size: 1.5rem; font-variant-numeric: tabular-nums; margin: 0.5rem 0; }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/**
 * Simplified Chinese words of a sentence (punctuation and spaces dropped).
 * Multi-char words come from the dictionary already simplified. A single char
 * the dictionary knows only as traditional is mapped to its simplified form;
 * a single char it does not know at all may be traditional, so the whole
 * sentence is skipped ([]).
 * @param {string} zh
 * @returns {Promise<string[]>}
 */
export async function segmentSentence(zh) {
  const tokens = (await segment(zh)).filter((w) => HANZI_RE.test(w));
  const words = [];
  for (const w of tokens) {
    if ([...w].length > 1) {
      words.push(w);
      continue;
    }
    const hit = await lookup(w);
    if (!hit) return [];
    words.push(hit.simp);
  }
  return words;
}

/**
 * Take sentences in random order, segment them, keep the first `count` playable ones.
 * Playable = has English, pinyin and at least MIN_WORDS words.
 * `alternatives` is always [] for now (no alternative-order data yet).
 * @param {Array<{id:number|string, zh:string, pinyin:string, en:string}>} sentences
 * @param {{count?:number}} [opts]
 * @returns {Promise<{rounds:Array<{id, zh, pinyin, en, words:string[], alternatives:string[][]}>, total:number}>}
 */
export async function generateBuilderRound(sentences, { count = DEFAULT_COUNT } = {}) {
  const rounds = [];
  if (!Array.isArray(sentences)) return { rounds, total: 0 };
  for (const s of shuffle(sentences)) {
    if (rounds.length >= count) break;
    if (!s.en || !s.pinyin || !s.zh) continue;
    const words = await segmentSentence(s.zh);
    if (words.length < MIN_WORDS) continue;
    rounds.push({ id: s.id, zh: s.zh, pinyin: s.pinyin, en: s.en, words, alternatives: [] });
  }
  return { rounds, total: rounds.length };
}

/**
 * Check the player's word order against the correct order or a valid alternative.
 * @param {string[]} correctWords
 * @param {string[]} userWords
 * @param {string[][]} alternatives - alternative correct orders (same words)
 * @returns {{correct:boolean, score:number, matched:number, total:number, alternative:boolean}}
 */
export function checkBuilderOrder(correctWords, userWords, alternatives = []) {
  const total = correctWords.length;
  if (total === 0) return { correct: true, score: 1, matched: 0, total: 0, alternative: false };

  const positionalMatches = (order) => {
    let matched = 0;
    const n = Math.min(userWords.length, total);
    for (let i = 0; i < n; i++) if (userWords[i] === order[i]) matched++;
    return matched;
  };

  if (userWords.length === total) {
    if (positionalMatches(correctWords) === total) {
      return { correct: true, score: 1, matched: total, total, alternative: false };
    }
    for (const alt of alternatives) {
      if (alt.length === total && positionalMatches(alt) === total) {
        return { correct: true, score: 1, matched: total, total, alternative: true };
      }
    }
  }

  // Not correct: partial credit by position (length mismatch included).
  const matched = positionalMatches(correctWords);
  return { correct: false, score: matched / total, matched, total, alternative: false };
}

/**
 * Random order of chip indexes 0..n-1. For n > 1 it is never the identity,
 * so chips never start in the correct order.
 * @param {number} n
 * @param {() => number} [rnd]
 * @returns {number[]}
 */
export function chipOrder(n, rnd = Math.random) {
  const identity = [...Array(Math.max(n, 0)).keys()];
  if (n <= 1) return identity;
  let order;
  do {
    order = shuffle(identity, rnd);
  } while (order.every((v, i) => v === i));
  return order;
}

/**
 * Points for a solved round: 3, minus 1 per hint, never below 1. Unsolved = 0.
 * @param {{correct:boolean, hints?:number}} r
 * @returns {number}
 */
export function roundPoints({ correct, hints = 0 }) {
  return correct ? Math.max(1, MAX_POINTS - hints) : 0;
}

/** Fisher–Yates on a copy. */
function shuffle(items, rnd = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Sentences for a source, in the active locale (fetchData picks data/es when translated). */
async function loadSentences(source) {
  if (source === 'lessons') {
    const idx = await fetchData('lessons/hsk1/index.json');
    const lessons = await Promise.all(idx.lessons.map((l) => fetchData(`lessons/hsk1/${l.file}`)));
    return lessons.flatMap((lesson) =>
      (lesson.vocabulary ?? [])
        .filter((v) => v.example)
        .map((v) => ({ id: `${lesson.id}:${v.hanzi}`, zh: v.example.hanzi, pinyin: v.example.pinyin, en: v.example.english })),
    );
  }
  if (source === 'readings') {
    const idx = await fetchData('readings/hsk1/index.json');
    const readings = await Promise.all(idx.map((r) => fetchData(`readings/hsk1/${r.id}.json`)));
    return readings.flatMap((r) =>
      (r.lines ?? []).map((l, i) => ({ id: `${r.id}:${i}`, zh: l.hanzi, pinyin: l.pinyin, en: l.english })),
    );
  }
  const idx = await fetchData('sentences/index.json');
  const shards = await Promise.all(idx.shards.map((s) => fetchData(`sentences/${s.file}`)));
  return shards.flat();
}

/** Render the game. */
export async function render(container, ctx) {
  ensureStyles(document);
  const segments = ctx?.route?.segments ?? [];
  const source = SOURCES.includes(segments[1]) ? segments[1] : 'sentences';

  let rounds = [];
  let index = 0;
  let order = [];   // chip indexes shown, shuffled
  let placed = [];  // chip indexes (into round.words) in tap order
  let hints = 0;
  let checked = null;
  let points = 0;
  let correct = 0;
  let mistakes = 0;
  let startedAt = 0;
  let timeMs = 0;
  let finished = false;

  async function start() {
    reset(container);
    container.append(h('p', { class: 'pill', text: t('games.loading') }));
    try {
      const data = await generateBuilderRound(await loadSentences(source), { count: DEFAULT_COUNT });
      if (!data.total) throw new Error('no playable sentences');
      rounds = data.rounds;
      index = 0;
      points = 0;
      correct = 0;
      mistakes = 0;
      finished = false;
      startedAt = Date.now();
      newRound();
    } catch (err) {
      reset(container);
      container.append(
        h('section', { class: 'card' }, h('p', { text: t('games.error', { message: String(err?.message ?? err) }) })),
      );
    }
  }

  function newRound() {
    order = chipOrder(rounds[index].words.length);
    placed = [];
    hints = 0;
    checked = null;
    draw();
  }

  function tap(chip) {
    if (checked || placed.includes(chip)) return;
    placed.push(chip);
    draw();
  }

  function untap(pos) {
    if (checked) return;
    placed.splice(pos, 1);
    draw();
  }

  function clear() {
    placed = [];
    draw();
  }

  function hint() {
    const round = rounds[index];
    const expected = round.words[placed.length];
    const chip = order.find((c) => !placed.includes(c) && round.words[c] === expected);
    if (chip === undefined) return;
    placed.push(chip);
    hints += 1;
    draw();
  }

  function check() {
    const round = rounds[index];
    checked = checkBuilderOrder(round.words, placed.map((c) => round.words[c]), round.alternatives);
    if (checked.correct) {
      correct += 1;
      points += roundPoints({ correct: true, hints });
    } else {
      mistakes += 1;
    }
    draw();
  }

  function next() {
    if (index + 1 >= rounds.length) return finish();
    index += 1;
    newRound();
  }

  function finish() {
    finished = true;
    timeMs = Date.now() - startedAt;
    window.dispatchEvent(
      new CustomEvent('chino:lesson_done', {
        detail: { gameId: id, score: correct, total: rounds.length, timeMs, mistakes },
      }),
    );
    draw();
  }

  function roundView() {
    const round = rounds[index];
    const left = round.words.length - placed.length;

    const answer = h(
      'div',
      { class: `builder-answer${checked ? (checked.correct ? ' ok' : ' bad') : ''}` },
      ...placed.map((c, pos) =>
        h('button', { type: 'button', disabled: !!checked, onclick: () => untap(pos), text: round.words[c] }),
      ),
    );
    const chips = h(
      'div',
      { class: 'builder-chips' },
      ...order.map((c) =>
        h('button', {
          type: 'button',
          class: placed.includes(c) ? 'used' : undefined,
          disabled: !!checked || placed.includes(c),
          onclick: () => tap(c),
          text: round.words[c],
        }),
      ),
    );

    const parts = [h('p', { class: 'builder-target', text: round.en }), answer, chips];
    if (checked) {
      parts.push(
        h('p', {
          class: 'builder-feedback',
          text: checked.correct
            ? t('games.builder.correct')
            : t('games.builder.incorrect', { correct: round.words.join(' ') }),
        }),
        h('p', { class: 'builder-pinyin py-keep', html: `<span>${pinyinHtml(round.pinyin)}</span>` }),
        h('div', { class: 'builder-actions' },
          h('button', { type: 'button', class: 'primary', text: t('games.builder.next'), onclick: next })),
      );
    } else {
      parts.push(
        h('p', { class: 'builder-hint', text: t('games.builder.hint', { left }) }),
        h('div', { class: 'builder-actions' },
          h('button', { type: 'button', disabled: left === 0, text: t('games.builder.hintBtn'), onclick: hint }),
          h('button', { type: 'button', disabled: placed.length === 0, text: t('games.builder.clear'), onclick: clear }),
          h('button', { type: 'button', class: 'primary', disabled: left !== 0, text: t('games.builder.check'), onclick: check })),
      );
    }
    return parts;
  }

  function resultView() {
    return h(
      'div',
      { class: 'builder-result card' },
      h('h2', { text: t('games.builder.complete') }),
      h('p', { class: 'score', text: t('games.builder.correctCount', { correct, total: rounds.length }) }),
      h('p', { text: `${t('games.builder.score')}: ${points}` }),
      h('p', { text: `${t('games.builder.mistakes')}: ${mistakes}` }),
      h('p', { text: `${t('games.builder.time')}: ${Math.round(timeMs / 1000)}s` }),
      h('div', { class: 'builder-actions' },
        h('button', { type: 'button', class: 'primary', text: t('games.builder.playAgain'), onclick: start }),
        h('button', { type: 'button', text: t('games.builder.back'), onclick: () => ctx.navigate('learn/games') })),
    );
  }

  function draw() {
    reset(container);
    const section = h(
      'section',
      { class: 'builder' },
      h('header', { class: 'builder-header' },
        h('h2', { text: t(titleKey) }),
        h('div', { class: 'builder-stats' },
          h('span', { text: `${t('games.builder.round')} ${Math.min(index + 1, rounds.length)}/${rounds.length}` }),
          h('span', { text: `${t('games.builder.score')}: ${points}` }),
          h('span', { text: `${t('games.builder.mistakes')}: ${mistakes}` }))),
      ...(finished ? [resultView()] : roundView()),
    );
    container.append(section);
  }

  await start();
  return () => {};
}
