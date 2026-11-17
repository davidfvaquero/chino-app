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
import { speak } from '../audio.js';
import { pinyinHtml } from '../tone.js';
import { gradeExercise, summarize } from './exercises.js';

export const titleKey = 'hubs.learn.lessons';
export const DEFAULT_LEVEL = 'hsk1';
export const PROGRESS_STORE = 'progress';

/** Root of the lesson data, relative to this module (works in src/ and dist/). */
export const DATA_BASE = new URL('../../data/lessons/', import.meta.url);

const defaultFetchJson = async (url) => {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`lessons: ${res.status} for ${url}`);
  return res.json();
};

/** Loads `index.json` for a level. `fetchJson`/`base` are injectable for tests. */
export async function loadIndex(level = DEFAULT_LEVEL, { base = DATA_BASE, fetchJson = defaultFetchJson } = {}) {
  const url = new URL(`${level}/index.json`, base);
  const index = await fetchJson(url);
  return { ...index, level: index.level ?? level };
}

/** Loads one lesson file (by its index entry id). */
export async function loadLesson(level, lessonId, { base = DATA_BASE, fetchJson = defaultFetchJson } = {}) {
  const index = await loadIndex(level, { base, fetchJson });
  const entry = (index.lessons ?? []).find((lesson) => lesson.id === lessonId);
  if (!entry) throw new Error(`lessons: unknown lesson "${lessonId}" in ${level}`);
  const url = new URL(`${level}/${entry.file ?? `${lessonId}.json`}`, base);
  const lesson = await fetchJson(url);
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

/** Inline text that works whether the lesson gives a key ('learn...') or a literal. */
const label = (value) => (typeof value === 'string' && value ? t(value) : '');

/* ------------------------------------------------------------------ list -- */

async function renderList(container, ctx) {
  const index = await loadIndex(DEFAULT_LEVEL);
  const lessons = await Promise.all(
    (index.lessons ?? []).map(async (lesson) => ({ ...lesson, progress: await getProgress(index.level, lesson.id) })),
  );

  reset(container);
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
          onclick: () => ctx.navigate(`learn/lessons/${lesson.id}`),
        },
        h('span', { text: label(lesson.title) || lesson.id }),
        h('span', { class: 'pill', text: status }),
      ),
    );
  }
  container.append(list);
  container.focus({ preventScroll: true });
}

/* ---------------------------------------------------------------- lesson -- */

async function renderLesson(container, ctx, lessonId) {
  const index = await loadIndex(DEFAULT_LEVEL);
  const lesson = await loadLesson(index.level, lessonId);
  const exercises = Array.isArray(lesson.exercises) ? lesson.exercises : [];
  const results = [];
  let step = 'intro';
  let current = 0;

  const draw = () => {
    reset(container);
    let view;
    if (step === 'intro') view = introStep();
    else if (step === 'vocabulary') view = vocabularyStep();
    else if (step === 'exercises') view = exerciseStep();
    else view = resultStep();
    container.append(view);
    container.focus({ preventScroll: true });
  };
  const go = (next) => {
    step = next;
    draw();
  };

  function introStep() {
    return h(
      'section',
      { class: 'card lesson-intro' },
      h('h2', { text: label(lesson.title) || lesson.id }),
      h('p', { text: label(lesson.intro) }),
      h('button', { type: 'button', class: 'btn primary', text: t('learn.lessons.next'), onclick: () => go('vocabulary') }),
    );
  }

  function vocabularyStep() {
    const section = h('section', { class: 'card lesson-vocabulary' }, h('h2', { text: t('learn.lessons.vocabulary') }));
    for (const word of lesson.vocabulary ?? []) {
      const button = h('button', {
        type: 'button',
        class: 'btn option',
        text: t('learn.lessons.addToReview'),
        onclick: async () => {
          button.disabled = true;
          await addToReview({ hanzi: word.hanzi, pinyin: word.pinyin, english: word.english, source: 'lesson' });
          button.textContent = t('learn.lessons.added');
        },
      });
      section.append(
        h(
          'div',
          { class: 'vocab-item field' },
          h('span', { class: 'hanzi', text: word.hanzi }),
          h('span', { class: 'pinyin', html: pinyinHtml(word.pinyin) }),
          h('span', { class: 'english', text: word.english }),
          word.example
            ? h(
                'span',
                { class: 'example' },
                `${word.example.hanzi} · `,
                h('span', { html: pinyinHtml(word.example.pinyin) }),
                ` · ${word.example.english}`,
              )
            : null,
          button,
        ),
      );
    }
    section.append(h('button', { type: 'button', class: 'btn primary', text: t('learn.lessons.next'), onclick: () => go('exercises') }));
    return section;
  }

  function exerciseStep() {
    const exercise = exercises[current];
    if (!exercise) return resultStep();
    const section = h(
      'section',
      { class: 'card lesson-exercise' },
      h('h2', { text: t('learn.lessons.exerciseProgress', { current: current + 1, total: exercises.length }) }),
    );
    section.append(
      exerciseView(exercise, (result) => {
        results[current] = result;
        current += 1;
        const summary = summarize(results);
        saveProgress(index.level, lesson.id, {
          score: summary.correct,
          total: exercises.length,
          answered: current,
          completed: current >= exercises.length,
        }).then(() => {
          if (current >= exercises.length) go('result');
          else draw();
        });
      }),
    );
    return section;
  }

  function exerciseView(exercise, onContinue) {
    const box = h('div', { class: 'exercise-body' });
    box.append(h('p', { class: 'prompt', text: exercise.prompt ?? '' }));
    if (exercise.type === 'listen') {
      box.append(
        h('button', {
          type: 'button',
          class: 'btn primary',
          text: t('learn.lessons.playAudio'),
          onclick: () => speak(exercise.audio, { lang: 'zh-CN' }),
        }),
      );
    }
    if (exercise.type === 'choose' || exercise.type === 'listen') return choiceBody(exercise, box, onContinue);
    if (exercise.type === 'order') return orderBody(exercise, box, onContinue);
    if (exercise.type === 'match') return matchBody(exercise, box, onContinue);
    return box;
  }

  function finish(feedback, result, onContinue) {
    feedback.append(
      h('p', {
        class: result.correct ? 'feedback ok' : 'feedback bad',
        text: result.correct ? t('learn.lessons.correct') : t('learn.lessons.incorrect'),
      }),
    );
    feedback.append(h('button', { type: 'button', class: 'btn primary', text: t('learn.lessons.continue'), onclick: () => onContinue(result) }));
  }

  function choiceBody(exercise, box, onContinue) {
    const feedback = h('div', { class: 'feedback-box' });
    const options = h('div', { class: 'options' });
    for (const option of exercise.options ?? []) {
      options.append(
        h('button', {
          type: 'button',
          class: 'btn option',
          text: String(option),
          onclick: () => {
            const result = gradeExercise(exercise, option);
            for (const btn of options.children) btn.disabled = true;
            finish(feedback, result, onContinue);
          },
        }),
      );
    }
    box.append(options, feedback);
    return box;
  }

  function orderBody(exercise, box, onContinue) {
    const pool = Array.isArray(exercise.tokens) ? [...exercise.tokens] : [];
    const answer = [];
    const answerRow = h('div', { class: 'answer-row' });
    const poolRow = h('div', { class: 'pool-row' });
    const feedback = h('div', { class: 'feedback-box' });

    const redrawRows = () => {
      answerRow.replaceChildren(
        ...answer.map((token, index) =>
          h('button', {
            type: 'button',
            class: 'chip',
            text: token,
            onclick: () => {
              answer.splice(index, 1);
              pool.push(token);
              redrawRows();
            },
          }),
        ),
      );
      poolRow.replaceChildren(
        ...pool.map((token, index) =>
          h('button', {
            type: 'button',
            class: 'chip',
            text: token,
            onclick: () => {
              pool.splice(index, 1);
              answer.push(token);
              redrawRows();
            },
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
        check.disabled = true;
        for (const btn of [...poolRow.children, ...answerRow.children]) btn.disabled = true;
        finish(feedback, result, onContinue);
      },
    });
    box.append(h('p', { class: 'hint', text: t('learn.lessons.orderHint') }), answerRow, poolRow, check, feedback);
    return box;
  }

  function matchBody(exercise, box, onContinue) {
    const pairs = Array.isArray(exercise.pairs) ? exercise.pairs : [];
    const chosen = {};
    let selected = null;
    const left = h('div', { class: 'match-col left' });
    const right = h('div', { class: 'match-col right' });
    const feedback = h('div', { class: 'feedback-box' });

    for (const pair of pairs) {
      const btn = h('button', {
        type: 'button',
        class: 'chip',
        text: pair.hanzi,
        onclick: () => {
          selected = pair.hanzi;
          for (const other of left.children) other.classList.toggle('selected', other === btn);
        },
      });
      left.append(btn);
    }
    for (const pair of pairs) {
      const btn = h('button', {
        type: 'button',
        class: 'chip',
        text: pair.english,
        onclick: () => {
          if (!selected) return;
          chosen[selected] = pair.english;
          btn.classList.add('selected');
          const leftBtn = [...left.children].find((node) => node.textContent === selected);
          if (leftBtn) leftBtn.classList.add('selected');
          selected = null;
        },
      });
      right.append(btn);
    }

    const check = h('button', {
      type: 'button',
      class: 'btn primary',
      text: t('learn.lessons.check'),
      onclick: () => {
        const result = gradeExercise(exercise, chosen);
        check.disabled = true;
        finish(feedback, result, onContinue);
      },
    });
    box.append(h('p', { class: 'hint', text: t('learn.lessons.matchHint') }), left, right, check, feedback);
    return box;
  }

  function resultStep() {
    const summary = summarize(results);
    return h(
      'section',
      { class: 'card lesson-result' },
      h('h2', { text: t('learn.lessons.result') }),
      h('p', { text: t('learn.lessons.resultScore', { score: summary.correct, total: exercises.length }) }),
      h('button', {
        type: 'button',
        class: 'btn primary',
        text: t('learn.lessons.finish'),
        onclick: async () => {
          await saveProgress(index.level, lesson.id, {
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
          ctx.navigate('learn/lessons');
        },
      }),
    );
  }

  draw();
}

/* ---------------------------------------------------------------- render -- */

export async function render(container, ctx) {
  const lessonId = ctx?.route?.segments?.[1];
  reset(container);
  container.append(h('p', { class: 'pill', text: t('learn.lessons.loading') }));
  try {
    if (lessonId) await renderLesson(container, ctx, lessonId);
    else await renderList(container, ctx);
  } catch (err) {
    reset(container);
    container.append(
      h('section', { class: 'card' }, h('p', { text: t('learn.lessons.error', { message: String(err?.message ?? err) }) })),
    );
  }
}
