/**
 * lessons.js — the generic lesson engine + the HSK1 lesson list.
 *
 * Reads any level from `public/data/lessons/<level>/index.json` (served at
 * `/data/lessons/<level>/index.json`); nothing here is HSK1-specific. The
 * schema is documented in docs/lesson-schema.md.
 *
 * Public API (used by the Learn hub and by the tests):
 *   titleKey
 *   DEFAULT_LEVEL
 *   loadIndex(level, { base, fetchJson })            -> index object { level, lessons[] }
 *   loadLesson(level, lessonId, { base, fetchJson }) -> lesson object
 *   getProgress(level, lessonId, { store })          -> record | null
 *   saveProgress(level, lessonId, patch, { store })  -> record
 *   render(container, ctx)
 *
 * Progress lives in the shared storage store 'progress', key `<level>:<id>`,
 * so it survives a reload. Finishing a lesson fires the cross-module DOM event
 * 'chino:lesson_done' (detail: { level, lessonId, score, total }).
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import storage from '../storage.js';
import { addToReview } from '../srs.js';
import { pinyinHtml } from '../tone.js';
import { pinyinToggle } from '../settings.js';
import { hanziCell } from '../hanzi.js';
import {
  gradeExercise,
  summarize,
  createMatchState,
  toggleMatchLeft,
  chooseMatchRight,
  unmatchPair,
  isMatchComplete,
  matchPairIndex,
  missedVocabulary,
} from './exercises.js';
import { ensureExerciseStyles } from './exercise-ui.css.js';
import { exerciseView, finish, feedbackBox, progressBar, pinyinForText, pinyinLine } from './exercise-view.js';
import { fetchData } from '../data-url.js';

const STYLE_ID = 'lessons-layout-style';

/**
 * Layout of one vocabulary entry (hanzi cell / pinyin / english / example /
 * button, stacked so nothing shares a line on mobile). Colours, type and shape
 * come from the design system in src/styles.css (docs/DESIGN.md).
 */
const CSS = `
.vocab-item.field {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  margin: 0;
  padding: 1rem 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
}
.vocab-item .pinyin { margin-top: 0.35rem; font-size: var(--fs-md); }
.vocab-item .english {
  margin-top: 0.25em;
  color: var(--ink-soft);
  font-size: 0.95em;
  line-height: 1.4;
}
.vocab-item .example {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  align-self: stretch;
  margin-top: 0.4em;
  padding: 0.6rem 0 0 0.75rem;
  border-left: 2px solid var(--grid);
  font-size: 0.95em;
  line-height: 1.4;
}
.vocab-item .example-hanzi { font-family: var(--font-hanzi); font-size: 1.25em; }
.vocab-item .example-english { color: var(--ink-soft); }
.vocab-item > .btn { margin-top: 0.5em; }
/* Actions on top of the vocabulary list (P2-2): "add all" + the way forward,
 * reachable without scrolling the 16 rows. */
.lesson-vocab-actions,
.lesson-result-actions { display: grid; gap: var(--gap); }
.lesson-vocab-actions { margin: var(--gap) 0; }
.lesson-vocab-next { margin-bottom: var(--gap); }
.lesson-result-actions { margin-top: var(--gap); }
.vocab-rest { margin-top: var(--gap); }
.vocab-rest > summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; font-weight: 600; }
`;

/** Inject the layout CSS into <head> once. */
function ensureStyles(doc) {
  ensureExerciseStyles(doc);
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

export const titleKey = 'hubs.learn.lessons';
export const DEFAULT_LEVEL = 'hsk1';
/** Selectable levels; each reads public/data/lessons/<level>/index.json. Chosen with `?level=`. */
export const LEVELS = ['hsk1', 'hsk2', 'hsk3', 'practical'];
/** Picker label keys per level; levels not listed fall back to `home.level.<name>`. */
const LEVEL_LABEL_KEYS = { hsk2: 'hsk2.level', hsk3: 'hsk3.level' };
export const PROGRESS_STORE = 'progress';

/** Root of the lesson data, relative to this module (works in src/ and dist/). */
export const DATA_BASE = new URL('../../data/lessons/', import.meta.url);

/**
 * Reads one lesson file, language-aware by default: with locale 'es' it loads
 * `data/es/lessons/<relPath>` when translated and falls back to English. A
 * caller-supplied `fetchJson`/`base` keeps the plain-URL contract (tests).
 */
const readJson = (relPath, { base = DATA_BASE, fetchJson } = {}) =>
  fetchJson ? fetchJson(new URL(relPath, base)) : fetchData(`lessons/${relPath}`);

/** Loads `index.json` for a level. `fetchJson`/`base` are injectable for tests. */
export async function loadIndex(level = DEFAULT_LEVEL, opts = {}) {
  const index = await readJson(`${level}/index.json`, opts);
  return { ...index, level: index.level ?? level };
}

/** Loads one lesson file (by its index entry id). */
export async function loadLesson(level, lessonId, opts = {}) {
  const index = await loadIndex(level, opts);
  const entry = (index.lessons ?? []).find((lesson) => lesson.id === lessonId);
  if (!entry) throw new Error(`lessons: unknown lesson "${lessonId}" in ${level}`);
  const lesson = await readJson(`${level}/${entry.file ?? `${lessonId}.json`}`, opts);
  return { ...lesson, level, id: entry.id };
}

/** Storage key for a lesson's progress record. */
export function progressKey(level, lessonId) {
  return `${level}:${lessonId}`;
}

/** Progress record for a lesson, or null when it was never opened. */
export async function getProgress(level, lessonId, { store = storage } = {}) {
  return (await store.get(PROGRESS_STORE, progressKey(level, lessonId))) ?? null;
}

/**
 * Merges `patch` into the stored progress record and returns the new record.
 * Called after every answered exercise, so partial progress is persisted too.
 */
export async function saveProgress(level, lessonId, patch = {}, { store = storage, now = Date.now() } = {}) {
  const key = progressKey(level, lessonId);
  const previous = (await store.get(PROGRESS_STORE, key)) ?? { completed: false, score: 0, total: 0, answered: 0 };
  const record = { ...previous, ...patch, updatedAt: now };
  await store.set(PROGRESS_STORE, key, record);
  return record;
}

/**
 * `saveProgress` that never throws: a failed write (full quota, closed
 * IndexedDB) must not block the finish, the lesson still ends and the reward
 * still fires (REVIEW-3 I4). Shared by the lesson engine and the tones lesson.
 */
export async function saveProgressSafe(level, lessonId, patch = {}, opts = {}) {
  try {
    return await saveProgress(level, lessonId, patch, opts);
  } catch (err) {
    console.warn('lesson: save failed', err);
    return null;
  }
}

/** Inline text that works whether the lesson gives a key ('learn...') or a literal. */
const label = (value) => (typeof value === 'string' && value ? t(value) : '');

/** hanzi -> pinyin from the lesson vocabulary. */
function pinyinMapOf(vocabulary) {
  const map = new Map();
  for (const word of vocabulary ?? []) {
    if (word?.hanzi && word?.pinyin) map.set(String(word.hanzi), String(word.pinyin));
  }
  return map;
}

/* ------------------------------------------------------------------ list -- */

async function renderList(container, ctx, level) {
  const index = await loadIndex(level);
  const lessons = await Promise.all(
    (index.lessons ?? []).map(async (lesson) => ({ ...lesson, progress: await getProgress(index.level, lesson.id) })),
  );

  reset(container);
  const picker = h(
    'div',
    { class: 'level-picker', role: 'group', 'aria-label': t('home.level.label') },
    ...LEVELS.map((name) =>
      h('button', {
        type: 'button',
        class: 'btn option',
        'data-level': name,
        'aria-pressed': String(name === level),
        text: t(LEVEL_LABEL_KEYS[name] ?? `home.level.${name}`),
        onclick: () => ctx.navigate(`learn/lessons?level=${name}`),
      }),
    ),
  );
  const list = h('section', { class: 'menu', 'aria-label': t(titleKey) });
  if (!lessons.length) list.append(h('p', { class: 'card', text: t('learn.lessons.empty') }));
  for (const lesson of lessons) {
    const progress = lesson.progress;
    const status =
      !progress || !progress.total
        ? t('learn.lessons.start')
        : progress.completed
          ? t('learn.lessons.done', { score: progress.score, total: progress.total })
          : t('learn.lessons.partial', { answered: progress.answered, total: progress.total });
    list.append(
      h(
        'button',
        {
          type: 'button',
          class: 'card field',
          'data-lesson': lesson.id,
          onclick: () => ctx.navigate(`learn/lessons/${lesson.id}${level === DEFAULT_LEVEL ? '' : `?level=${level}`}`),
        },
        h('span', { text: label(lesson.title) || lesson.id }),
        h('span', { class: 'pill', text: status }),
      ),
    );
  }
  container.append(picker, list);
  container.focus({ preventScroll: true });
}

/* ---------------------------------------------------------------- lesson -- */

async function renderLesson(container, ctx, lessonId, level) {
  const index = await loadIndex(level);
  const lesson = await loadLesson(index.level, lessonId);
  const exercises = Array.isArray(lesson.exercises) ? lesson.exercises : [];
  const results = [];
  /** hanzi -> pinyin, so an exercise can show a reading under its hanzi. */
  const readings = pinyinMapOf(lesson.vocabulary);
  /** hanzi -> vocabulary entry, for the meaning in the failure text. */
  const vocabWords = new Map((lesson.vocabulary ?? []).map((word) => [String(word.hanzi), word]));
  /** The lessons screen renders the rich exercise body (readings, right/wrong, live region). */
  const viewConfig = { readings, vocabWords, orderBody, matchBody };
  let step = 'intro';
  let current = 0;

  const draw = () => {
    reset(container);
    let view;
    if (step === 'intro') view = introStep();
    else if (step === 'vocabulary') view = vocabularyStep();
    else if (step === 'exercises') view = exerciseStep();
    else view = resultStep();
    container.append(h('div', { class: 'row lesson-tools' }, pinyinToggle()), view);
    container.focus({ preventScroll: true });
  };
  const go = (next) => {
    step = next;
    draw();
  };

  function introStep() {
    return h(
      'section',
      { class: 'card lesson-intro lesson-step' },
      h('h2', { text: label(lesson.title) || lesson.id }),
      h('p', { text: label(lesson.intro) }),
      h('button', { type: 'button', class: 'btn primary', text: t('learn.lessons.next'), onclick: () => go('vocabulary') }),
    );
  }

  function vocabularyStep() {
    const words = lesson.vocabulary ?? [];
    const section = h('section', { class: 'lesson-vocabulary lesson-step' }, h('h2', { text: t('learn.lessons.vocabulary') }));
    const addAll = h('button', {
      type: 'button',
      class: 'btn',
      text: t('learn.lessons.addAllToReview'),
      onclick: async () => {
        addAll.disabled = true;
        for (const word of words) {
          await addToReview({ hanzi: word.hanzi, pinyin: word.pinyin, english: word.english, source: 'lesson' });
        }
        addAll.textContent = t('learn.lessons.addedAll');
      },
    });
    // The actions sit on top, so the way forward is reachable without scrolling 16 rows.
    section.append(h('div', { class: 'lesson-vocab-actions' }, addAll));
    section.append(
      h('button', { type: 'button', class: 'btn primary lg lesson-vocab-next', text: t('learn.lessons.next'), onclick: () => go('exercises') }),
    );
    const wordRow = (word) => {
      const button = h('button', {
        type: 'button',
        class: 'btn sm ghost vocab-add',
        text: t('learn.lessons.addToReview'),
        onclick: async () => {
          button.disabled = true;
          await addToReview({ hanzi: word.hanzi, pinyin: word.pinyin, english: word.english, source: 'lesson' });
          button.textContent = t('learn.lessons.added');
        },
      });
      return h(
        'div',
        { class: 'vocab-item field' },
        hanziCell(word.hanzi, 'md'),
        h('span', { class: 'pinyin', html: pinyinHtml(word.pinyin) }),
        h('span', { class: 'english', text: word.english }),
        word.example
          ? h(
              'span',
              { class: 'example' },
              h('span', { class: 'example-hanzi', lang: 'zh-Hans', text: word.example.hanzi }),
              h('span', { class: 'example-pinyin', html: pinyinHtml(word.example.pinyin) }),
              h('span', { class: 'example-english', text: word.example.english }),
            )
          : null,
        button,
      );
    };
    // P2-8: the first four words are enough before the first exercise; the
    // rest stay behind a disclosure so the list is not a wall.
    const rows = words.map(wordRow);
    section.append(...rows.slice(0, 4));
    if (rows.length > 4) {
      section.append(
        h(
          'details',
          { class: 'vocab-rest' },
          h('summary', { class: 'vocab-rest-summary', text: t('learn.lessons.showRest', { count: rows.length - 4 }) }),
          ...rows.slice(4),
        ),
      );
    }
    return section;
  }

  function exerciseStep() {
    const exercise = exercises[current];
    if (!exercise) return resultStep();
    const section = h(
      'section',
      { class: 'card lesson-exercise lesson-step' },
      h('h2', { text: t('learn.lessons.exerciseProgress', { current: current + 1, total: exercises.length }) }),
      progressBar(current, exercises.length),
    );
    section.append(
      exerciseView(
        exercise,
        (result) => {
          results[current] = result;
          current += 1;
          const summary = summarize(results);
          saveProgress(index.level, lesson.id, {
            score: summary.correct,
            total: exercises.length,
            answered: current,
            completed: current >= exercises.length,
          }).catch((err) => console.warn('lesson: save failed', err)).finally(() => {
            if (current >= exercises.length) go('result');
            else draw();
          });
        },
        viewConfig,
      ),
    );
    return section;
  }

  function orderBody(exercise, box, onContinue) {
    const pool = Array.isArray(exercise.tokens) ? [...exercise.tokens] : [];
    const answer = [];
    const answerRow = h('div', { class: 'answer-row' });
    const poolRow = h('div', { class: 'pool-row' });
    const feedback = feedbackBox(viewConfig);

    /** A token chip: the hanzi with its reading underneath (P2-1). */
    const tokenChip = (token, onclick) =>
      h(
        'button',
        { type: 'button', class: 'chip', onclick },
        h('span', { class: 'chip-hanzi', lang: 'zh-Hans', text: token }),
        pinyinLine(pinyinForText(token, readings)),
      );

    const redrawRows = () => {
      answerRow.replaceChildren(
        ...answer.map((token, index) =>
          tokenChip(token, () => {
            answer.splice(index, 1);
            pool.push(token);
            redrawRows();
          }),
        ),
      );
      poolRow.replaceChildren(
        ...pool.map((token, index) =>
          tokenChip(token, () => {
            pool.splice(index, 1);
            answer.push(token);
            redrawRows();
          }),
        ),
      );
    };
    redrawRows();

    const check = h('button', {
      type: 'button',
      class: 'btn primary',
      text: t('learn.lessons.check'),
      onclick: () => {
        const result = gradeExercise(exercise, answer);
        answerRow.classList.add(result.correct ? 'is-ok' : 'is-bad');
        check.disabled = true;
        for (const btn of [...poolRow.children, ...answerRow.children]) btn.disabled = true;
        finish(feedback, result, onContinue, viewConfig);
      },
    });
    box.append(h('p', { class: 'hint', text: t('learn.lessons.orderHint') }), answerRow, poolRow, check, feedback);
    return box;
  }

  function matchBody(exercise, box, onContinue) {
    const pairs = Array.isArray(exercise.pairs) ? exercise.pairs : [];
    let state = createMatchState(pairs);
    let locked = false;
    const left = h('div', { class: 'match-col left' });
    const right = h('div', { class: 'match-col right' });
    const grid = h('div', { class: 'match-grid' }, left, right);
    const feedback = feedbackBox(viewConfig);
    const leftButtons = [];
    const rightButtons = [];

    const paint = () => {
      for (const btn of leftButtons) {
        const hanzi = btn.dataset.hanzi;
        const matched = Object.prototype.hasOwnProperty.call(state.chosen, hanzi);
        btn.classList.toggle('selected', state.selected === hanzi);
        btn.classList.toggle('matched', matched);
        btn.setAttribute('aria-pressed', String(state.selected === hanzi));
        if (matched) btn.dataset.match = String(matchPairIndex(state, hanzi) + 1);
        else delete btn.dataset.match;
        btn.disabled = locked;
      }
      for (const btn of rightButtons) {
        const meaning = btn.dataset.english;
        const paired = Object.keys(state.chosen).find((hanzi) => state.chosen[hanzi] === meaning);
        btn.classList.toggle('matched', Boolean(paired));
        if (paired) {
          btn.dataset.match = String(matchPairIndex(state, paired) + 1);
          btn.dataset.pairedWith = paired;
        } else {
          delete btn.dataset.match;
          delete btn.dataset.pairedWith;
        }
        btn.disabled = locked;
      }
      check.disabled = locked || !isMatchComplete(state);
    };

    for (const pair of pairs) {
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'chip match-chip',
          'aria-pressed': 'false',
          onclick: () => {
            if (locked) return;
            const hanzi = pair.hanzi;
            state = Object.prototype.hasOwnProperty.call(state.chosen, hanzi)
              ? unmatchPair(state, hanzi)
              : toggleMatchLeft(state, hanzi);
            paint();
          },
        },
        h('span', { class: 'chip-hanzi', lang: 'zh-Hans', text: pair.hanzi }),
        pinyinLine(pinyinForText(pair.hanzi, readings)),
      );
      btn.dataset.hanzi = pair.hanzi;
      leftButtons.push(btn);
      left.append(btn);
    }

    // Rotate the meanings so the two columns are not aligned pair-for-pair.
    const rightPairs = pairs.length > 1 ? [...pairs.slice(1), pairs[0]] : pairs;
    for (const pair of rightPairs) {
      const btn = h('button', {
        type: 'button',
        class: 'chip match-chip',
        text: pair.english,
        onclick: () => {
          if (locked) return;
          if (btn.dataset.pairedWith) {
            state = unmatchPair(state, btn.dataset.pairedWith);
            paint();
            return;
          }
          if (!state.selected) return;
          state = chooseMatchRight(state, pair.english);
          paint();
        },
      });
      btn.dataset.english = pair.english;
      rightButtons.push(btn);
      right.append(btn);
    }

    const check = h('button', {
      type: 'button',
      class: 'btn primary',
      text: t('learn.lessons.check'),
      disabled: true,
      onclick: () => {
        if (locked) return;
        const result = gradeExercise(exercise, state.chosen);
        locked = true;
        paint();
        if (!result.correct) {
          const answers = h('div', { class: 'match-answer' });
          for (const pair of pairs) {
            const ok = state.chosen[pair.hanzi] === pair.english;
            answers.append(h('div', { class: ok ? 'ok' : 'bad', text: `${pair.hanzi} — ${pair.english}` }));
          }
          feedback.append(answers);
        }
        finish(feedback, result, onContinue, viewConfig);
      },
    });

    paint();
    box.append(h('p', { class: 'hint', text: t('learn.lessons.matchHint') }), grid, check, feedback);
    return box;
  }

  function resultStep() {
    const summary = summarize(results);
    const missed = missedVocabulary(exercises, results, lesson.vocabulary ?? []);
    const section = h(
      'section',
      { class: 'card lesson-result lesson-step' },
      // role=status: the ending is announced, without moving the focus (WCAG 4.1.3)
      h(
        'div',
        { class: 'lesson-result-status', role: 'status', 'aria-live': 'polite' },
        h('h2', { text: t('learn.lessons.result') }),
        h('p', { text: t('learn.lessons.resultScore', { score: summary.correct, total: exercises.length }) }),
        progressBar(summary.correct, exercises.length),
      ),
    );
    /** Saves the final score and announces the lesson as done (once). */
    let completed = false;
    const complete = async () => {
      if (completed) return;
      completed = true;
      // A second click while the save is in flight would double the reward.
      for (const button of section.querySelectorAll('button')) button.disabled = true;
      // A failed save (full quota, closed IndexedDB) must not block the finish:
      // the lesson still ends and the reward still fires (REVIEW-3 I4).
      await saveProgressSafe(index.level, lesson.id, {
        score: summary.correct,
        total: exercises.length,
        answered: exercises.length,
        completed: true,
      });
      window.dispatchEvent(
        new CustomEvent('chino:lesson_done', {
          detail: { level: index.level, lessonId: lesson.id, score: summary.correct, total: exercises.length },
        }),
      );
    };
    const actions = h('div', { class: 'lesson-result-actions' });
    if (missed.length) {
      // The error is the lesson: put every missed word back in the review deck.
      actions.append(
        h('button', {
          type: 'button',
          class: 'btn primary lg',
          text: t('learn.lessons.reviewMissed'),
          onclick: async () => {
            await complete();
            // A failed write to the review deck must not strand the screen:
            // the lesson still ends and we move on (REVIEW-3 I4).
            try {
              for (const word of missed) await addToReview(word);
            } catch (err) {
              console.warn('lesson: add to review failed', err);
            }
            ctx.navigate('review');
          },
        }),
      );
    }
    actions.append(
      h('button', {
        type: 'button',
        class: 'btn lg',
        text: t('learn.lessons.repeatLesson'),
        onclick: () => {
          results.length = 0;
          current = 0;
          go('intro');
        },
      }),
      h('button', {
        type: 'button',
        class: 'btn ghost lg',
        text: t('learn.lessons.finish'),
        onclick: async () => {
          await complete();
          ctx.navigate(index.level === DEFAULT_LEVEL ? 'learn/lessons' : `learn/lessons?level=${index.level}`);
        },
      }),
    );
    section.append(actions);
    return section;
  }

  draw();
}

/* ---------------------------------------------------------------- render -- */

export async function render(container, ctx) {
  ensureStyles(container.ownerDocument ?? document);
  const lessonId = ctx?.route?.segments?.[1];
  const requested = ctx?.route?.params?.level;
  // With no ?level=, deduce it from the lesson id prefix (hsk2-03 -> hsk2).
  const inferred = lessonId ? LEVELS.find((name) => String(lessonId).startsWith(`${name}-`)) : undefined;
  const level = LEVELS.includes(requested) ? requested : (inferred ?? DEFAULT_LEVEL);
  reset(container);
  container.append(h('p', { class: 'pill', text: t('learn.lessons.loading') }));
  try {
    if (lessonId) await renderLesson(container, ctx, lessonId, level);
    else await renderList(container, ctx, level);
  } catch (err) {
    reset(container);
    container.append(
      h('section', { class: 'card' }, h('p', { text: t('learn.lessons.error', { message: String(err?.message ?? err) }) })),
    );
  }
}
