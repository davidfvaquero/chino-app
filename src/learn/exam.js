/**
 * exam.js — HSK practice exam screen. Route `#/learn/exam`.
 *
 * You pick a level (HSK 1–3, only levels whose data file exists) and get a
 * 20-question exam generated from data the app already ships:
 *   (a) meaning  — pick the right translation of a hanzi
 *   (b) listen   — the word is spoken (src/audio.js); pick its hanzi or pinyin
 *   (c) reading  — a short sentence with a comprehension question (its meaning,
 *                  or the word that is missing)
 *   (d) order    — put the words of a sentence in the right order
 *
 * The exam is seeded: the same exam code rebuilds exactly the same exam. The
 * generator and grading are pure (src/learn/exam-gen.js); this file only wires
 * data, DOM, audio and the review deck.
 *
 * Fires `chino:lesson_done` once per finished exam with
 * `{lessonId, level, seed, score, total, percent, timed, seconds}`.
 *
 * Public API: titleKey, LESSON_ID, render(), and the pure re-exports used by
 * tests (buildExam, gradeExam, ...) live in src/learn/exam-gen.js.
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { speak, isTtsAvailable } from '../audio.js';
import { addToReview } from '../srs.js';
import { pinyinHtml } from '../tone.js';
import { fetchData } from '../data-url.js';
import {
  LEVELS,
  EXAM_SIZE,
  TIMER_SECONDS,
  buildExam,
  gradeExam,
  gradeAnswer,
  makeRng,
  normalizeWord,
  isWord,
  isSentence,
} from './exam-gen.js';

export const titleKey = 'exam.title';
export const LESSON_ID = 'exam';

const STYLE_ID = 'exam-style';

/* --------------------------------------------------------------- the data -- */

/** Words + sentence pools for every available HSK level (cached per call). */
export async function loadLevels() {
  const results = await Promise.all(
    LEVELS.map(async (level) => {
      let words = [];
      try {
        const data = await fetchData(`hsk/${level}.json`);
        words = (data.items ?? []).map(normalizeWord).filter(isWord);
      } catch {
        return null; // level data not shipped: the level is simply not offered
      }
      return { level, words, sentences: await loadSentences(level) };
    }),
  );
  return results.filter(Boolean);
}

/** Short sentences for a level: reading lines (HSK 1) + lesson examples. */
async function loadSentences(level) {
  const out = [];
  const add = (hanzi, pinyin, english) => {
    const sentence = { hanzi: String(hanzi ?? '').trim(), pinyin: String(pinyin ?? '').trim(), english: String(english ?? '').trim() };
    if (isSentence(sentence)) out.push(sentence);
  };
  try {
    const index = await fetchData('readings/hsk1/index.json');
    const list = (Array.isArray(index) ? index : index.readings ?? []).slice(0, 8);
    for (const item of list) {
      try {
        const reading = await fetchData(`readings/hsk1/${item.id}.json`);
        for (const line of reading.lines ?? []) add(line.hanzi, line.pinyin, line.english);
      } catch {
        /* skip a broken reading */
      }
    }
  } catch {
    /* no readings shipped */
  }
  const dir = `hsk${level}`;
  if (dir) {
    try {
      const index = await fetchData(`lessons/${dir}/index.json`);
      for (const lesson of (index.lessons ?? []).slice(0, 6)) {
        try {
          const data = await fetchData(`lessons/${dir}/${lesson.file}`);
          for (const entry of data.vocabulary ?? []) add(entry.example?.hanzi, entry.example?.pinyin, entry.example?.english);
        } catch {
          /* skip a missing lesson */
        }
      }
    } catch {
      /* no lessons shipped */
    }
  }
  return out;
}

/* --------------------------------------------------------------- the CSS -- */

const CSS = `
.exam-setup, .exam-question, .exam-result { display: grid; gap: var(--pad); }
.exam-field { display: grid; gap: 0.35rem; }
.exam-field label { font-size: 0.85rem; color: var(--ink-soft); }
.exam-select, .exam-input {
  width: 100%; font: inherit; padding: 0.6rem 0.7rem; min-height: 44px;
  border: 1.5px solid var(--edge); border-radius: 0.6rem;
  background: var(--surface); color: var(--ink);
}
.exam-hint { margin: 0; font-size: 0.8rem; color: var(--ink-soft); }
.exam-check { display: inline-flex; align-items: center; gap: 0.5rem; min-height: 44px; padding: 0 0.8rem;
  border: 1.5px solid var(--edge); border-radius: 999px; background: var(--surface); font-size: 0.9rem; }
.exam-check input[type="checkbox"] { position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; }
.exam-check:has(input:checked) { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }
.exam-check:focus-within { outline: 3px solid var(--focus); outline-offset: 2px; }
.exam-bar { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.85rem; color: var(--ink-soft); }
.exam-section { margin: 0; font-size: 0.8rem; letter-spacing: 0.05em; color: var(--ink-soft); }
.exam-notice { margin: 0; padding: 0.5rem 0.7rem; border-radius: 0.6rem; background: var(--surface); color: var(--ink-soft); font-size: 0.85rem; }
.exam-prompt { margin: 0; font-size: 1.3rem; }
.exam-prompt.hanzi { font-size: 2.4rem; text-align: center; }
.exam-prompt .pinyin { display: block; font-size: 1rem; }
.exam-audio { display: flex; gap: 0.5rem; }
.exam-options { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
.exam-option { padding: 0.6rem; }
.exam-option.hanzi { font-size: 1.5rem; }
.exam-chosen { display: flex; flex-wrap: wrap; gap: 0.35rem; min-height: 2.2rem; padding: 0.4rem; border: 1px dashed var(--line); border-radius: 0.6rem; }
.exam-chosen .exam-option { padding: 0.35rem 0.6rem; }
.exam-tokens { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.exam-feedback { display: grid; gap: 0.5rem; }
.exam-feedback .ok { color: var(--ok); }
.exam-feedback .bad { color: var(--danger); }
.exam-answer-line { margin: 0; font-size: 1.15rem; display: grid; gap: 0.2rem; }
.exam-answer-line .pinyin { font-size: 0.95rem; }
.exam-answer-line .english { color: var(--ink-soft); font-size: 0.9rem; }
.exam-result-score { font-size: 1.15rem; }
.exam-missed { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.7rem; }
.exam-missed li { display: grid; gap: 0.2rem; border-top: 1px solid var(--line); padding-top: 0.5rem; }
.exam-missed .prompt { font-size: 1.2rem; }
.exam-missed .expected { color: var(--ink-soft); }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/* --------------------------------------------------------------- helpers -- */

/** mm:ss for the timer. */
export function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Question index -> the section key used for labels. */
const sectionKey = (question) => `exam.section.${question.section}`;

/* --------------------------------------------------------------- the screen -- */

export async function render(container, ctx = {}) {
  ensureStyles(container.ownerDocument ?? document);

  const state = {
    phase: 'setup',
    levels: [],
    level: 1,
    seed: '',
    timed: false,
    exam: null,
    index: 0,
    answers: [],
    chosen: [],
    answered: false,
    result: null,
    remaining: TIMER_SECONDS,
    noTts: !isTtsAvailable(),
    error: null,
  };

  let timerId = null;
  const stopTimer = () => {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  };

  const current = () => state.exam?.questions[state.index] ?? null;
  const activeLevel = () => state.levels.find((entry) => entry.level === state.level) ?? null;
  const correctSoFar = () => state.answers.filter((_, i) => gradeAnswer(state.exam.questions[i], state.answers[i])).length;

  const draw = () => {
    reset(container);
    let view;
    if (state.phase === 'question') view = questionView();
    else if (state.phase === 'result') view = resultView();
    else view = setupView();
    container.append(view);
    container.focus?.({ preventScroll: true });
  };

  async function playCurrent() {
    const question = current();
    if (!question || question.type !== 'listen') return;
    const result = await speak(question.audio, { lang: 'zh-CN' });
    if (!result.ok && result.reason === 'unsupported' && !state.noTts) {
      state.noTts = true;
      draw();
    }
  }

  function startTimer() {
    if (!state.timed) return;
    state.remaining = TIMER_SECONDS;
    timerId = setInterval(() => {
      state.remaining -= 1;
      if (state.remaining <= 0) {
        state.remaining = 0;
        stopTimer();
        finish(true);
        return;
      }
      const node = container.querySelector('.exam-timer');
      if (node) node.textContent = t('exam.timer', { time: formatTime(state.remaining) });
    }, 1000);
  }

  function start() {
    const pool = activeLevel();
    if (!pool || !pool.words.length) {
      state.error = t('exam.emptyLevel');
      draw();
      return;
    }
    state.error = null;
    const seed = state.seed.trim() === '' ? String(Date.now()) : state.seed.trim();
    state.seed = seed;
    state.exam = buildExam({ level: state.level, seed, words: pool.words, sentences: pool.sentences, size: EXAM_SIZE, rng: makeRng(seed) });
    state.index = 0;
    state.answers = [];
    state.chosen = [];
    state.answered = false;
    state.result = null;
    state.phase = 'question';
    draw();
    playCurrent();
    startTimer();
  }

  function answer(response) {
    const question = current();
    if (!question || state.answered) return;
    state.answers[state.index] = response;
    state.answered = true;
    draw();
  }

  function next() {
    if (state.index + 1 >= (state.exam?.questions.length ?? 0)) {
      finish(false);
      return;
    }
    state.index += 1;
    state.chosen = [];
    state.answered = false;
    draw();
    playCurrent();
  }

  function finish(timeUp) {
    stopTimer();
    state.result = { ...gradeExam(state.exam, state.answers), timeUp: Boolean(timeUp), seconds: state.timed ? TIMER_SECONDS - state.remaining : null };
    state.phase = 'result';
    draw();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('chino:lesson_done', {
          detail: {
            lessonId: LESSON_ID,
            level: state.level,
            seed: state.seed,
            score: state.result.correct,
            total: state.result.total,
            percent: state.result.percent,
            timed: state.timed,
            seconds: state.result.seconds,
          },
        }),
      );
    }
  }

  /* --------------------------------------------------------------- views -- */

  function setupView() {
    const section = h('section', { class: 'card exam-setup' }, h('p', { text: t('exam.intro') }));

    const levelSelect = h('select', { class: 'exam-select', 'aria-label': t('exam.levelLabel') });
    for (const entry of state.levels) {
      levelSelect.append(h('option', { value: String(entry.level), text: t('exam.level', { level: entry.level }), selected: entry.level === state.level }));
    }
    levelSelect.addEventListener('change', () => {
      state.level = Number(levelSelect.value);
    });

    const seedInput = h('input', {
      type: 'text',
      class: 'exam-input',
      value: state.seed,
      autocomplete: 'off',
      placeholder: t('exam.seedPlaceholder'),
      'aria-label': t('exam.seedLabel'),
    });
    seedInput.addEventListener('input', () => {
      state.seed = seedInput.value;
    });

    const timerBox = h('input', { type: 'checkbox', checked: state.timed, 'aria-label': t('exam.timerLabel') });
    timerBox.addEventListener('change', () => {
      state.timed = timerBox.checked;
    });

    section.append(
      h('div', { class: 'exam-field' }, h('label', { text: t('exam.levelLabel') }), levelSelect),
      h('div', { class: 'exam-field' }, h('label', { text: t('exam.seedLabel') }), seedInput, h('p', { class: 'exam-hint', text: t('exam.seedHint') })),
      h('label', { class: 'exam-check' }, timerBox, h('span', { text: t('exam.timerLabel') })),
    );
    if (state.error) section.append(h('p', { class: 'exam-notice', text: state.error }));
    section.append(h('button', { type: 'button', class: 'btn primary exam-start', text: t('exam.start'), onclick: () => start() }));
    return section;
  }

  function bar() {
    const bar = h('div', { class: 'exam-bar' });
    bar.append(h('span', { class: 'exam-progress', text: t('exam.progress', { current: state.index + 1, total: state.exam.questions.length }) }));
    bar.append(h('span', { class: 'exam-score', text: t('exam.section.' + current().section) }));
    if (state.timed) bar.append(h('span', { class: 'exam-timer', text: t('exam.timer', { time: formatTime(state.remaining) }) }));
    return bar;
  }

  function optionsGrid(question, { className = '' } = {}) {
    const grid = h('div', { class: 'exam-options' });
    for (const option of question.options) {
      const isPinyin = question.type === 'listen' && question.mode === 'pinyin';
      const button = h('button', {
        type: 'button',
        class: `btn option exam-option ${className}${isPinyin ? ' py-keep' : ''}`.trim(),
        disabled: state.answered,
        onclick: () => answer(option),
      });
      if (isPinyin) button.innerHTML = pinyinHtml(option);
      else button.textContent = option;
      grid.append(button);
    }
    return grid;
  }

  function orderView(question) {
    const box = h('div', { class: 'exam-order' });
    const chosen = h('div', { class: 'exam-chosen' });
    state.chosen.forEach((token, i) => {
      chosen.append(
        h('button', {
          type: 'button',
          class: 'btn option exam-option',
          text: token,
          disabled: state.answered,
          onclick: () => {
            state.chosen.splice(i, 1);
            draw();
          },
        }),
      );
    });
    box.append(chosen);

    const pool = h('div', { class: 'exam-tokens' });
    const used = new Map();
    for (const token of question.options) {
      const taken = (used.get(token) ?? 0);
      used.set(token, taken + 1);
      const already = state.chosen.filter((value) => value === token).length > taken;
      pool.append(
        h('button', {
          type: 'button',
          class: 'btn option exam-option',
          text: token,
          disabled: state.answered || already,
          onclick: () => {
            state.chosen.push(token);
            draw();
          },
        }),
      );
    }
    box.append(pool);
    box.append(h('button', { type: 'button', class: 'btn primary exam-check', text: t('exam.check'), disabled: state.answered, onclick: () => answer([...state.chosen]) }));
    return box;
  }

  function promptView(question) {
    const box = h('div');
    if (question.type === 'meaning') {
      box.append(h('p', { class: 'exam-prompt hanzi', text: question.prompt }));
      if (question.promptPinyin) box.append(h('p', { class: 'exam-prompt' }, h('span', { class: 'pinyin', html: pinyinHtml(question.promptPinyin) })));
      box.append(h('p', { class: 'exam-hint', text: t('exam.meaningPrompt') }));
      return box;
    }
    if (question.type === 'reading') {
      box.append(h('p', { class: 'exam-prompt hanzi', text: question.prompt }));
      if (question.promptPinyin) box.append(h('p', { class: 'exam-prompt' }, h('span', { class: 'pinyin', html: pinyinHtml(question.promptPinyin) })));
      box.append(h('p', { class: 'exam-hint', text: t(question.kind === 'missing' ? 'exam.readingMissing' : 'exam.readingPrompt') }));
      return box;
    }
    if (question.type === 'order') {
      box.append(h('p', { class: 'exam-hint', text: t('exam.orderHint') }));
      box.append(h('p', { class: 'exam-prompt', text: question.prompt }));
      return box;
    }
    return box;
  }

  function questionView() {
    const question = current();
    const section = h('section', { class: 'card exam-question' }, bar());
    if (state.noTts && question.type === 'listen') section.append(h('p', { class: 'exam-notice', text: t('exam.ttsUnavailable') }));

    if (question.type === 'listen') {
      section.append(
        h('p', { class: 'exam-hint', text: t(question.mode === 'hanzi' ? 'exam.listenModeHanzi' : 'exam.listenModePinyin') }),
        h(
          'div',
          { class: 'exam-audio' },
          h('button', { type: 'button', class: 'btn primary exam-play', text: t('exam.play'), disabled: state.answered, onclick: () => playCurrent() }),
          h('button', { type: 'button', class: 'btn exam-repeat', text: t('exam.repeat'), disabled: state.answered, onclick: () => playCurrent() }),
        ),
      );
      if (state.noTts) section.append(h('p', { class: 'exam-prompt hanzi', text: question.prompt }));
    } else {
      section.append(promptView(question));
    }

    if (question.type === 'order') {
      section.append(orderView(question));
    } else {
      section.append(optionsGrid(question, { className: question.type === 'listen' && question.mode === 'hanzi' ? 'hanzi' : '' }));
    }

    if (!state.answered) {
      section.append(h('button', { type: 'button', class: 'btn exam-skip', text: t('exam.skip'), onclick: () => answer(null) }));
    } else {
      section.append(feedbackView(question));
    }
    return section;
  }

  function answerLine(question) {
    const line = h('p', { class: 'exam-answer-line' });
    if (question.word) {
      line.append(h('span', { class: 'hanzi', text: question.word.hanzi }));
      if (question.word.pinyin) line.append(h('span', { class: 'pinyin py-keep', html: pinyinHtml(question.word.pinyin) }));
      if (question.word.english) line.append(h('span', { class: 'english', text: question.word.english }));
    } else if (question.sentence) {
      line.append(h('span', { class: 'hanzi', text: question.sentence.hanzi }));
      if (question.sentence.pinyin) line.append(h('span', { class: 'pinyin py-keep', html: pinyinHtml(question.sentence.pinyin) }));
      line.append(h('span', { class: 'english', text: question.sentence.english }));
    }
    return line;
  }

  function feedbackView(question) {
    const response = state.answers[state.index];
    const correct = gradeAnswer(question, response);
    const box = h('div', { class: 'exam-feedback' });
    box.append(h('p', { class: correct ? 'ok' : 'bad', text: t(correct ? 'exam.correct' : 'exam.incorrect') }));
    if (!correct) {
      box.append(h('p', { class: 'exam-hint', text: `${t('exam.correctAnswer')}: ${question.answer}` }));
      box.append(answerLine(question));
    }
    box.append(h('button', { type: 'button', class: 'btn primary exam-next', text: t('exam.next'), onclick: () => next() }));
    return box;
  }

  /** Review card for a wrong question, when it carries a word. */
  const cardFor = (question) =>
    question.word ? { hanzi: question.word.hanzi, pinyin: question.word.pinyin, pinyinNumeric: question.word.pinyinNumeric, english: question.word.english, source: LESSON_ID } : null;

  function resultView() {
    const result = state.result;
    const section = h(
      'section',
      { class: 'card exam-result' },
      h('h2', { text: t('exam.result.title') }),
      result.timeUp ? h('p', { class: 'exam-notice', text: t('exam.timeUp') }) : null,
      h('p', { class: 'exam-result-score', text: t('exam.result.score', { correct: result.correct, total: result.total, percent: result.percent }) }),
      result.seconds !== null && result.seconds !== undefined ? h('p', { class: 'exam-hint', text: t('exam.result.time', { time: formatTime(result.seconds) }) }) : null,
    );

    if (result.wrong.length) {
      section.append(h('h3', { text: t('exam.result.missed') }));
      const list = h('ul', { class: 'exam-missed' });
      for (const miss of result.wrong) {
        const item = h('li');
        item.append(h('span', { class: 'prompt', text: miss.question.type === 'order' ? miss.question.sentence.hanzi : miss.question.prompt }));
        item.append(h('span', { class: 'expected', text: `${t('exam.correctAnswer')}: ${miss.expected}` }));
        list.append(item);
      }
      section.append(list);

      const cards = result.wrong.map((miss) => cardFor(miss.question)).filter(Boolean);
      const addAll = h('button', { type: 'button', class: 'btn exam-add-all', text: t('exam.result.addAll'), disabled: !cards.length });
      addAll.addEventListener('click', async () => {
        for (const card of cards) await addToReview(card);
        addAll.textContent = cards.length ? t('exam.result.added', { count: cards.length }) : t('exam.result.nothingToAdd');
        addAll.disabled = true;
      });
      section.append(addAll);
    }

    section.append(
      h('button', { type: 'button', class: 'btn primary exam-again', text: t('exam.result.playAgain'), onclick: () => { stopTimer(); state.phase = 'setup'; draw(); } }),
      h('button', { type: 'button', class: 'btn exam-back', text: t('exam.result.back'), onclick: () => ctx.navigate?.('learn') }),
    );
    return section;
  }

  reset(container);
  container.append(h('p', { class: 'pill', text: t('common.loading') }));
  try {
    state.levels = await loadLevels();
  } catch {
    state.levels = [];
  }
  if (state.levels.length) state.level = state.levels[0].level;
  draw();

  // Small driving surface for headless tests (same idea as dictation.js).
  container.examApi = {
    state: () => ({
      phase: state.phase,
      level: state.level,
      seed: state.seed,
      timed: state.timed,
      index: state.index,
      total: state.exam?.questions.length ?? 0,
      answered: state.answered,
      current: current(),
      result: state.result,
      levels: state.levels.map((entry) => entry.level),
    }),
    start,
    answer,
    next,
    finish,
  };

  return () => stopTimer();
}
