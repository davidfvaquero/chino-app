/**
 * Timed quiz game — 60 seconds, word with 4 options (hanzi -> english, or audio -> hanzi).
 * Streak of correct answers. Final result with best score saved in storage ('progress').
 * Fires 'chino:lesson_done' on completion.
 *
 * Pure helpers (tested in tests/games-timed.test.mjs):
 *   generateTimedRound(words, { count = 10, mode = 'english' }) -> { questions }
 *   checkTimedAnswer(question, answerIndex) -> { correct, streak, score }
 *
 * Screen contract: titleKey + render(container, ctx)
 */

import { t } from '../../i18n.js';
import { h, reset } from '../../dom.js';
import { speak } from '../../audio.js';
import { pinyinHtml } from '../../tone.js';
import { shuffle } from '../../random.js';
import { loadWords } from './common.js';
import storage from '../../storage.js';

export const titleKey = 'games.timed.title';
export const id = 'timed';

const STYLE_ID = 'timed-style';
const DEFAULT_TIME_MS = 60_000;
const DEFAULT_QUESTION_COUNT = 10;
const MODES = ['english', 'audio'];

/** CSS injected once. */
const CSS = `
.timed { display: flex; flex-direction: column; gap: 0.75rem; }
.timed-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
.timed-stats { display: flex; gap: 1rem; font-variant-numeric: tabular-nums; opacity: 0.85; font-size: 0.9rem; }
.timed-stats span { display: flex; align-items: center; gap: 0.3rem; }
.timed-timer { font-weight: 700; font-size: 1.2rem; }
.timed-timer.warning { color: var(--danger); }
.timed-question { text-align: center; padding: 1.5rem 1rem; }
.timed-hanzi { font-size: 3rem; line-height: 1.2; margin-bottom: 0.5rem; }
.timed-pinyin { font-size: 1.1rem; opacity: 0.75; margin-bottom: 1rem; }
.timed-audio-btn { min-height: 48px; padding: 0.5rem 1rem; border: 1.5px solid var(--edge); border-radius: 0.6rem; background: var(--surface); color: inherit; font-size: 1rem; cursor: pointer; touch-action: manipulation; }
.timed-options { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; max-width: 28rem; margin: 0 auto; }
.timed-option { min-height: 48px; padding: 1rem; border: 1.5px solid var(--edge); border-radius: 0.75rem; background: var(--surface); color: inherit; font-size: 1.1rem; text-align: center; touch-action: manipulation; transition: border-color 0.15s, background 0.15s, transform 0.05s; }
.timed-option:active { transform: scale(0.98); }
.timed-option.correct { border-color: var(--ok); background: var(--ok-wash); }
.timed-option.wrong { border-color: var(--danger); background: var(--danger-wash); animation: timed-shake 0.3s; }
@keyframes timed-shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }
.timed-streak { text-align: center; font-size: 1.2rem; font-weight: 600; opacity: 0.9; margin-top: 0.5rem; }
.timed-result { text-align: center; }
.timed-result h2 { margin: 0 0 0.5rem; }
.timed-result .score { font-size: 1.5rem; font-variant-numeric: tabular-nums; margin: 0.5rem 0; }
.timed-result .best { font-size: 1.1rem; opacity: 0.8; margin-bottom: 1rem; }
.timed-actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
.timed-actions button { min-height: 48px; padding: 0.6rem 1rem; border: 1.5px solid var(--edge); border-radius: 0.6rem; background: var(--surface); color: inherit; touch-action: manipulation; }
.timed-actions button.primary { border-color: var(--accent); background: var(--accent); color: var(--accent-fg); }
@media (max-width: 480px) {
  .timed-options { grid-template-columns: 1fr; }
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
 * Generate a timed quiz round from a word list.
 * @param {Array<{hanzi:string,pinyin:string,english:string|string[]}>} words
 * @param {{count?:number, mode?:'english'|'audio'}} opts
 * @returns {{questions:Array<{hanzi:string,pinyin:string,english:string,options:string[],correctIndex:number}>}}
 */
export function generateTimedRound(words, { count = DEFAULT_QUESTION_COUNT, mode = 'english' } = {}) {
  if (!Array.isArray(words) || words.length === 0) return { questions: [] };
  const shuffled = shuffle(words);
  const selected = shuffled.slice(0, Math.min(count, shuffled.length));
  const remaining = shuffled.slice(count);

  const questions = selected.map((w, idx) => {
    const english = Array.isArray(w.english) ? w.english[0] : w.english;
    let correctAnswer, options, correctIndex;

    if (mode === 'audio') {
      // Audio -> hanzi: question plays audio, options are hanzi characters
      correctAnswer = w.hanzi;
      // Pool of distractors: remaining + other selected words (excluding current)
      const otherSelected = selected.filter((_, i) => i !== idx).map((sw) => sw.hanzi);
      const distractorPool = [...remaining.map((rw) => rw.hanzi), ...otherSelected]
        .filter((h) => h !== correctAnswer);
      const distractors = shuffle(distractorPool).slice(0, 3);
      options = shuffle([correctAnswer, ...distractors]);
      correctIndex = options.indexOf(correctAnswer);
    } else {
      // Hanzi -> english: question shows hanzi, options are english meanings
      correctAnswer = english;
      const otherSelected = selected.filter((_, i) => i !== idx)
        .map((sw) => (Array.isArray(sw.english) ? sw.english[0] : sw.english));
      const distractorPool = [...remaining.map((rw) => (Array.isArray(rw.english) ? rw.english[0] : rw.english)), ...otherSelected]
        .filter((e) => e !== correctAnswer);
      const distractors = shuffle(distractorPool).slice(0, 3);
      options = shuffle([correctAnswer, ...distractors]);
      correctIndex = options.indexOf(correctAnswer);
    }

    return {
      hanzi: w.hanzi,
      pinyin: w.pinyin,
      english,
      options,
      correctIndex,
      mode,
    };
  });

  return { questions };
}

/**
 * Check a timed quiz answer.
 * @param {{correctIndex:number}} question
 * @param {number} answerIndex
 * @returns {{correct:boolean, streak:number, score:number}}
 */
export function checkTimedAnswer(question, answerIndex) {
  const correct = answerIndex === question.correctIndex;
  return { correct, streak: correct ? 1 : 0, score: correct ? 1 : 0 };
}

/** Render the timed quiz game screen. */
export async function render(container, ctx) {
  ensureStyles(document);

  const segments = ctx?.route?.segments ?? [];
  const gameId = segments[0] ?? id;
  const sourceParam = segments[1] ?? 'hsk1';
  const modeParam = segments[2] ?? 'english';

  // Game state
  let words = [];
  let round = { questions: [] };
  let currentIndex = 0;
  let streak = 0;
  let bestStreak = 0;
  let score = 0;
  let startTime = 0;
  let timeLeft = DEFAULT_TIME_MS;
  let timerId = null;
  let timerEl = null;
  let alive = true;
  let finished = false;
  let answerLock = false;
  let bestScore = 0;

  // Load best score from storage
  async function loadBestScore() {
    try {
      const progress = await storage.get('progress', `timed:${sourceParam}:${modeParam}`);
      if (progress && typeof progress.bestScore === 'number') {
        bestScore = progress.bestScore;
      }
    } catch {
      // ignore
    }
  }

  async function start() {
    reset(container);
    container.append(h('p', { class: 'pill', text: t('games.loading') }));
    try {
      await loadBestScore();
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
    round = generateTimedRound(words, { count: DEFAULT_QUESTION_COUNT, mode: modeParam });
    currentIndex = 0;
    streak = 0;
    bestStreak = 0;
    score = 0;
    timeLeft = DEFAULT_TIME_MS;
    finished = false;
    answerLock = false;
    startTime = Date.now();
    startTimer();
    draw();
  }

  function startTimer() {
    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      timeLeft -= 100;
      if (timeLeft <= 0) {
        timeLeft = 0;
        clearInterval(timerId);
        timerId = null;
        finishGame();
        return;
      }
      // Only repaint the clock: a full draw() would wipe the answer feedback.
      if (timerEl) {
        const sec = Math.ceil(timeLeft / 1000);
        timerEl.textContent = `${sec}s`;
        timerEl.classList.toggle('warning', sec <= 10);
      }
    }, 100);
  }

  function finishGame() {
    if (finished) return;
    finished = true;
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    // Update best streak
    if (streak > bestStreak) bestStreak = streak;
    // Update best score in storage
    saveBestScore();
    draw();
    // Fire lesson_done exactly once per game.
    window.dispatchEvent(
      new CustomEvent('chino:lesson_done', {
        detail: { gameId, score, total: round.questions.length, timeMs: Date.now() - startTime, mistakes: round.questions.length - score },
      }),
    );
  }

  async function saveBestScore() {
    if (score > bestScore) {
      bestScore = score;
      try {
        await storage.set('progress', `timed:${sourceParam}:${modeParam}`, { bestScore, updated: Date.now() });
      } catch {
        // ignore
      }
    }
  }

  function draw() {
    if (!alive) return;
    reset(container);
    const section = h('section', { class: 'timed' });

    // Header with stats
    const timeSec = Math.ceil(timeLeft / 1000);
    timerEl = h('span', { class: timeSec <= 10 ? 'timed-timer warning' : 'timed-timer', text: `${timeSec}s` });
    const header = h(
      'header',
      { class: 'timed-header' },
      h('h2', { text: t(titleKey) }),
      h('div', { class: 'timed-stats' },
        h('span', { text: `${t('games.timed.streak')}: ${streak}` }),
        timerEl,
        h('span', { text: `${t('games.timed.score')}: ${score}` }),
      ),
    );
    section.append(header);

    if (!finished && currentIndex < round.questions.length) {
      // Question
      const q = round.questions[currentIndex];
      const questionEl = h('div', { class: 'timed-question' });

      if (q.mode === 'audio') {
        // Audio mode: play button + hanzi options
        questionEl.append(
          h('button', {
            type: 'button',
            class: 'timed-audio-btn',
            onclick: () => speak(q.hanzi, { lang: 'zh-CN' }),
            text: t('games.timed.playAudio'),
          }),
        );
      } else {
        // English mode: show hanzi + pinyin
        questionEl.append(
          h('div', { class: 'timed-hanzi', lang: 'zh-Hans', text: q.hanzi }),
          h('div', { class: 'timed-pinyin', html: pinyinHtml(q.pinyin) }),
        );
      }

      // Options
      const optionsEl = h('div', { class: 'timed-options' });
      for (let i = 0; i < q.options.length; i++) {
        const opt = q.options[i];
        const btn = h(
          'button',
          {
            type: 'button',
            class: 'timed-option',
            disabled: answerLock || finished,
            onclick: () => onAnswer(i),
          },
          h('span', { text: opt }),
        );
        optionsEl.append(btn);
      }
      questionEl.append(optionsEl);

      // Streak display
      if (streak > 0) {
        questionEl.append(h('div', { class: 'timed-streak', text: `${t('games.timed.streakLabel')}: ${streak}` }));
      }

      section.append(questionEl);
    } else {
      // Result overlay
      const timeMs = Date.now() - startTime;
      const resultEl = h(
        'div',
        { class: 'timed-result card' },
        h('h2', { text: t('games.timed.complete') }),
        h('p', { class: 'score', text: `${t('games.timed.finalScore')}: ${score}` }),
        h('p', { class: 'best', text: `${t('games.timed.bestScore')}: ${bestScore}` }),
        h('p', { text: `${t('games.timed.bestStreak')}: ${bestStreak}` }),
        h('p', { text: `${t('games.timed.time')}: ${Math.floor(timeMs / 1000)}s` }),
        h('div', { class: 'timed-actions' },
          h('button', { type: 'button', class: 'btn primary', text: t('games.timed.playAgain'), onclick: newRound }),
          h('button', { type: 'button', text: t('games.timed.back'), onclick: () => ctx.navigate('learn/games') }),
        ),
      );
      section.append(resultEl);
    }

    container.append(section);
    container.focus({ preventScroll: true });
  }

  function onAnswer(answerIndex) {
    if (finished || answerLock || currentIndex >= round.questions.length) return;
    answerLock = true;

    const q = round.questions[currentIndex];
    const result = checkTimedAnswer(q, answerIndex);

    if (result.correct) {
      streak += 1;
      score += 1;
      if (streak > bestStreak) bestStreak = streak;
    } else {
      streak = 0;
    }

    // Visual feedback
    const optionBtns = container.querySelectorAll('.timed-option');
    optionBtns[answerIndex].classList.add(result.correct ? 'correct' : 'wrong');
    if (!result.correct) {
      optionBtns[q.correctIndex].classList.add('correct');
    }

    setTimeout(() => {
      if (!alive) return;
      currentIndex += 1;
      answerLock = false;
      if (currentIndex >= round.questions.length) finishGame();
      else draw();
    }, 600);
  }

  await start();
  return () => {
    alive = false;
    if (timerId) clearInterval(timerId);
  };
}