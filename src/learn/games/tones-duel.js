/**
 * Tone duel — plays a one-syllable or two-syllable HSK1 word and shows 4 tone
 * options (1-4, or tone pairs such as 2-3). 20 rounds, streak, optional timer.
 * At the end: the most frequent mix-ups ("2 with 3") and a practice button for
 * them. Fires 'chino:lesson_done' once, when the game ends.
 *
 * Pure helpers (tests/games-tones.test.mjs):
 *   buildPool(vocabulary) -> [{hanzi, pinyin, tones}]     tones: 1-4 per syllable
 *   generateRound(pool, { count, rnd? }) -> [{hanzi, pinyin, answer, options}]
 *   checkAnswer(round, chosen) -> { correct, pairs: [{from, to}] }
 *   tallyConfusions(pairs, limit?) -> [{from, to, count}]   most frequent first
 *   practicePool(pool, confusions, limit?) -> pool filtered to the mixed-up tones
 *
 * Tone keys: '2' for one syllable, '2-3' for two. Neutral tone (5) is not used.
 * Screen contract: titleKey + render(container, ctx).
 * Route: learn/games/tones-duel.
 */

import { t } from '../../i18n.js';
import { h, reset } from '../../dom.js';
import { speak } from '../../audio.js';
import { pinyinHtml, toneOf } from '../../tone.js';
import { fetchData } from '../../data-url.js';

export const titleKey = 'games.tones.title';
export const id = 'tones-duel';

export const ROUND_LEN = 20;
const TIME_MS = 6000;
const MAX_WORD_LEN = 2;
const CONFUSION_TONES = 3;
const STYLE_ID = 'tones-duel-style';
const HANZI_RE = /^[\u3400-\u9fff]+$/;

/** CSS injected once. */
const CSS = `
.tones { display: flex; flex-direction: column; gap: 0.75rem; }
.tones-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
.tones-header h2 { margin: 0; }
.tones-stats { display: flex; gap: 1rem; font-size: 0.9rem; opacity: 0.85; font-variant-numeric: tabular-nums; flex-wrap: wrap; }
.tones-timed { display: inline-flex; align-items: center; gap: 0.35rem; min-height: 44px; padding: 0 0.8rem; border: 1.5px solid var(--edge); border-radius: 999px; background: var(--surface); font-size: 0.9rem; }
.tones-timed input[type="checkbox"] { position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; }
.tones-timed:has(input:checked) { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }
.tones-timed:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
.tones-timer { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.tones-timer span { display: block; height: 100%; background: var(--accent); animation: tones-drain linear forwards; }
@keyframes tones-drain { from { width: 100%; } to { width: 0; } }
.tones-prompt { text-align: center; margin: 0; font-size: 1rem; }
.tones-word { text-align: center; margin: 0; font-size: 1.6rem; }
.tones-pinyin { text-align: center; margin: 0; font-size: 1rem; }
.tones-options { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; }
.tones-option { min-height: 56px; padding: 0.5rem; border: 1.5px solid var(--edge); border-radius: 0.75rem; background: var(--surface); color: inherit; font-size: 1.3rem; touch-action: manipulation; }
.tones-option:disabled { cursor: default; }
.tones-option.ok { border-color: var(--ok); background: var(--ok-wash); }
.tones-option.bad { border-color: var(--danger); background: var(--danger-wash); }
.tones-actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
.tones-actions button { min-height: 48px; padding: 0.6rem 1rem; border: 1.5px solid var(--edge); border-radius: 0.6rem; background: var(--surface); color: inherit; touch-action: manipulation; }
.tones-actions button.primary { border-color: var(--accent); background: var(--accent); color: var(--accent-fg); }
.tones-feedback { text-align: center; margin: 0; font-size: 0.95rem; }
.tones-result { text-align: center; }
.tones-result h2 { margin: 0 0 0.5rem; }
.tones-result .score { font-size: 1.5rem; font-variant-numeric: tabular-nums; margin: 0.5rem 0; }
.tones-confusions { text-align: left; padding-left: 1.25rem; }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

const keyOf = (tones) => tones.join('-');
const parseKey = (k) => k.split('-').map(Number);

/** All tone keys for n syllables: 4^n of them. */
function allKeys(n) {
  let keys = ['1', '2', '3', '4'];
  for (let i = 1; i < n; i++) keys = keys.flatMap((k) => ['1', '2', '3', '4'].map((d) => `${k}-${d}`));
  return keys;
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

/**
 * Words the game can play: simplified, 1-2 characters, one pinyin syllable per
 * character, every syllable tone 1-4. Duplicates (same hanzi) are dropped.
 * @param {Array<{hanzi:string, pinyin:string}>} vocabulary
 * @returns {Array<{hanzi:string, pinyin:string, tones:number[]}>}
 */
export function buildPool(vocabulary) {
  const seen = new Map();
  for (const v of vocabulary ?? []) {
    const chars = [...String(v?.hanzi ?? '')];
    if (chars.length < 1 || chars.length > MAX_WORD_LEN || !HANZI_RE.test(v.hanzi)) continue;
    const syllables = String(v.pinyin ?? '').trim().split(/\s+/).filter(Boolean);
    if (syllables.length !== chars.length) continue;
    const tones = syllables.map((s) => toneOf(s));
    if (!tones.every((n) => n >= 1 && n <= 4)) continue;
    if (!seen.has(v.hanzi)) seen.set(v.hanzi, { hanzi: v.hanzi, pinyin: v.pinyin, tones });
  }
  return [...seen.values()];
}

/**
 * Round list: random words, each with the right tone key and 3 wrong ones
 * (shuffled together). Count is capped by the pool size.
 * @returns {Array<{hanzi:string, pinyin:string, answer:string, options:string[]}>}
 */
export function generateRound(pool, { count = ROUND_LEN, rnd = Math.random } = {}) {
  return shuffle(pool, rnd)
    .slice(0, count)
    .map((w) => {
      const answer = keyOf(w.tones);
      const wrong = shuffle(allKeys(w.tones.length).filter((k) => k !== answer), rnd).slice(0, 3);
      return { hanzi: w.hanzi, pinyin: w.pinyin, answer, options: shuffle([answer, ...wrong], rnd) };
    });
}

/**
 * Grade one answer. `chosen` null = time ran out. A wrong answer lists one
 * {from, to} pair per syllable that differs (from = right tone, to = tone heard).
 * @returns {{correct:boolean, pairs:Array<{from:number,to:number}>}}
 */
export function checkAnswer(round, chosen) {
  if (chosen == null) return { correct: false, pairs: [] };
  if (chosen === round.answer) return { correct: true, pairs: [] };
  const want = parseKey(round.answer);
  const got = parseKey(chosen);
  const pairs = want.flatMap((from, i) => (from === got[i] ? [] : [{ from, to: got[i] }]));
  return { correct: false, pairs };
}

/**
 * Count the mix-ups, most frequent first (ties: lower right tone, then lower heard tone).
 * @returns {Array<{from:number, to:number, count:number}>}
 */
export function tallyConfusions(pairs, limit = Infinity) {
  const counts = new Map();
  for (const { from, to } of pairs ?? []) {
    const k = `${from}>${to}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts]
    .map(([k, count]) => {
      const [from, to] = k.split('>').map(Number);
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count || a.from - b.from || a.to - b.to)
    .slice(0, limit);
}

/**
 * Words that contain a tone the player mixes up (top `limit` confusions).
 * Falls back to the whole pool when there is nothing to practise.
 */
export function practicePool(pool, confusions, limit = CONFUSION_TONES) {
  const tones = new Set((confusions ?? []).slice(0, limit).map((c) => c.from));
  if (!tones.size) return pool;
  const hit = pool.filter((w) => w.tones.some((n) => tones.has(n)));
  return hit.length ? hit : pool;
}

/** Vocabulary of every HSK1 lesson (fetchData picks the Spanish copy when there is one). */
async function loadVocabulary() {
  const idx = await fetchData('lessons/hsk1/index.json');
  const lessons = await Promise.all(idx.lessons.map((l) => fetchData(`lessons/hsk1/${l.file}`)));
  return lessons.flatMap((lesson) => lesson.vocabulary ?? []);
}

/** Render the game. */
export async function render(container, ctx) {
  ensureStyles(document);

  let pool = null;
  let rounds = [];
  let index = 0;
  let answered = false;
  let chosen = null;      // tone key picked, null when the time ran out
  let timed = false;
  let timer = null;
  let streak = 0;
  let bestStreak = 0;
  let correct = 0;
  let mistakes = 0;
  let pairs = [];        // every {from, to} mix-up of this game
  let startedAt = 0;
  let timeMs = 0;
  let finished = false;

  function clearTimer() {
    clearTimeout(timer);
    timer = null;
  }

  function startTimer() {
    clearTimer();
    if (timed && !answered && !finished) timer = setTimeout(timeOut, TIME_MS);
  }

  function beginRound() {
    answered = false;
    chosen = null;
    draw();
    speak(rounds[index].hanzi);
    startTimer();
  }

  async function start(practice = false) {
    clearTimer();
    const previous = pairs;
    reset(container);
    container.append(h('p', { class: 'pill', text: t('games.loading') }));
    try {
      if (!pool) pool = buildPool(await loadVocabulary());
      const base = practice ? practicePool(pool, tallyConfusions(previous)) : pool;
      if (!base.length) throw new Error('no playable words');
      rounds = generateRound(base, { count: ROUND_LEN });
      index = 0;
      streak = 0;
      bestStreak = 0;
      correct = 0;
      mistakes = 0;
      pairs = [];
      finished = false;
      startedAt = Date.now();
      beginRound();
    } catch (err) {
      reset(container);
      container.append(
        h('section', { class: 'card' }, h('p', { text: t('games.error', { message: String(err?.message ?? err) }) })),
      );
    }
  }

  function record(picked) {
    const round = rounds[index];
    const result = checkAnswer(round, picked);
    chosen = picked;
    answered = true;
    clearTimer();
    if (result.correct) {
      correct += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
    } else {
      streak = 0;
      mistakes += 1;
      pairs.push(...result.pairs);
    }
    draw();
  }

  function answer(key) {
    if (!answered && !finished) record(key);
  }

  function timeOut() {
    timer = null;
    if (answered || finished) return;
    record(null);
  }

  function next() {
    if (index + 1 >= rounds.length) return finish();
    index += 1;
    beginRound();
  }

  function finish() {
    clearTimer();
    finished = true;
    timeMs = Date.now() - startedAt;
    window.dispatchEvent(
      new CustomEvent('chino:lesson_done', {
        detail: { gameId: id, score: correct, total: rounds.length, timeMs, mistakes },
      }),
    );
    draw();
  }

  function optionClass(key, round) {
    if (!answered) return 'tones-option';
    if (key === round.answer) return 'tones-option ok';
    if (key === chosen) return 'tones-option bad';
    return 'tones-option';
  }

  function roundView() {
    const round = rounds[index];
    const last = index + 1 >= rounds.length;
    const parts = [
      h('p', { class: 'tones-prompt', text: t('games.tones.listen') }),
      h('div', { class: 'tones-actions' },
        h('button', { type: 'button', text: t('games.tones.replay'), onclick: () => speak(round.hanzi) })),
    ];
    if (timed && !answered) {
      parts.push(h('div', { class: 'tones-timer' }, h('span', { style: `animation-duration:${TIME_MS}ms` })));
    }
    parts.push(
      h('div', { class: 'tones-options' },
        ...round.options.map((key) => h('button', {
          type: 'button',
          class: optionClass(key, round),
          disabled: answered,
          'aria-label': t('games.tones.toneLabel', { tones: key.split('-').join(' ') }),
          onclick: () => answer(key),
        }, ...parseKey(key).flatMap((n, i) => [
          i ? h('span', { text: ' · ' }) : null,
          h('span', { class: `tone tone${n}`, text: String(n) }),
        ]))),
      ),
    );
    if (answered) {
      parts.push(
        h('p', { class: 'tones-word', text: round.hanzi }),
        h('p', { class: 'tones-pinyin', html: pinyinHtml(round.pinyin) }),
        h('p', {
          class: 'tones-feedback',
          text: checkAnswer(round, chosen).correct
            ? t('games.tones.correct')
            : t(chosen == null ? 'games.tones.timeout' : 'games.tones.wrong'),
        }),
        h('div', { class: 'tones-actions' },
          h('button', { type: 'button', class: 'primary', text: t(last ? 'games.tones.finish' : 'games.tones.next'), onclick: next })),
      );
    }
    return parts;
  }

  function resultView() {
    const top = tallyConfusions(pairs);
    return h(
      'section',
      { class: 'tones-result card' },
      h('h2', { text: t('games.tones.complete') }),
      h('p', { class: 'score', text: t('games.tones.correctCount', { correct, total: rounds.length }) }),
      h('p', { text: t('games.tones.best', { n: bestStreak }) }),
      h('p', { text: t('games.tones.mistakes', { n: mistakes }) }),
      h('p', { text: t('games.tones.time', { s: Math.round(timeMs / 1000) }) }),
      h('h3', { text: t('games.tones.confusionsTitle') }),
      top.length
        ? h('ul', { class: 'tones-confusions' },
          ...top.slice(0, CONFUSION_TONES).map((c) => h('li', {
            text: t('games.tones.confusion', { from: c.from, to: c.to, count: c.count }),
          })))
        : h('p', { text: t('games.tones.noConfusions') }),
      h('div', { class: 'tones-actions' },
        h('button', { type: 'button', class: 'primary', text: t('games.tones.playAgain'), onclick: () => start(false) }),
        top.length ? h('button', { type: 'button', text: t('games.tones.practice'), onclick: () => start(true) }) : null,
        h('button', { type: 'button', text: t('games.tones.back'), onclick: () => ctx.navigate('learn/games') })),
    );
  }

  function draw() {
    reset(container);
    const shown = Math.min(index + 1, rounds.length);
    const section = h(
      'section',
      { class: 'tones' },
      h('header', { class: 'tones-header' },
        h('h2', { text: t(titleKey) }),
        h('div', { class: 'tones-stats' },
          h('span', { text: t('games.tones.round', { n: shown, total: rounds.length }) }),
          h('span', { text: t('games.tones.streak', { n: streak }) }),
          h('span', { text: t('games.tones.best', { n: bestStreak }) })),
        h('label', { class: 'tones-timed' },
          h('input', {
            type: 'checkbox',
            checked: timed,
            onchange: (e) => {
              timed = e.target.checked;
              draw();
              if (!answered) startTimer();
            },
          }),
          t('games.tones.timed'))),
      ...(finished ? [resultView()] : roundView()),
    );
    container.append(section);
  }

  await start(false);
  return () => clearTimer();
}
