/**
 * tones.js — Tones & Pinyin lesson.
 *
 * A standalone lesson covering pinyin basics (initials/finals) and the
 * four tones plus neutral tone, using the classic "ma" examples.
 * Reuses the exercise grading from src/learn/exercises.js and audio
 * playback from src/audio.js. Fires 'chino:lesson_done' on completion.
 *
 * Public API:
 *   titleKey          // i18n key for the hub menu label
 *   LESSON_ID         // 'tones'
 *   loadLesson()      -> lesson object (injectable fetch for tests)
 *   getProgress()     -> progress record | null
 *   saveProgress()    -> merged progress record
 *   render(container, ctx)
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import storage from '../storage.js';
import { speak } from '../audio.js';
import { pinyinHtml } from '../tone.js';
import { gradeExercise, summarize } from './exercises.js';
import { ensureExerciseStyles } from './exercise-ui.css.js';
import { fetchData } from '../data-url.js';

export const titleKey = 'hubs.learn.tones';
export const LESSON_ID = 'tones';
export const PROGRESS_STORE = 'progress';

/** Root of the lesson data, relative to this module (works in src/ and dist/). */
export const DATA_BASE = new URL('../../data/lessons/', import.meta.url);

/** Loads the tones lesson. `fetchJson`/`base` are injectable for tests. */
export async function loadLesson({ base = DATA_BASE, fetchJson } = {}) {
  const lesson = fetchJson ? await fetchJson(new URL('tones.json', base)) : await fetchData('lessons/tones.json');
  return { ...lesson, id: LESSON_ID };
}

/** Storage key for the tones lesson progress record. */
export function progressKey() {
  return `hsk1:${LESSON_ID}`;
}

/** Progress record for the tones lesson, or null when it was never opened. */
export async function getProgress({ store = storage } = {}) {
  return (await store.get(PROGRESS_STORE, progressKey())) ?? null;
}

/**
 * Merges `patch` into the stored progress record and returns the new record.
 * Called after every answered exercise, so partial progress is persisted too.
 */
export async function saveProgress(patch = {}, { store = storage, now = Date.now() } = {}) {
  const key = progressKey();
  const previous = (await store.get(PROGRESS_STORE, key)) ?? { completed: false, score: 0, total: 0, answered: 0 };
  const record = { ...previous, ...patch, updatedAt: now };
  await store.set(PROGRESS_STORE, key, record);
  return record;
}

/** Inline text that works whether the lesson gives a key ('tones...') or a literal. */
const label = (value) => (typeof value === 'string' && value ? t(value) : '');

/* ------------------------------------------------------------------ render -- */

export async function render(container, ctx) {
  ensureExerciseStyles(container.ownerDocument ?? document);
  const lesson = await loadLesson();
  const exercises = Array.isArray(lesson.exercises) ? lesson.exercises : [];
  const results = [];
  let step = 'intro';
  let current = 0;

  const draw = () => {
    reset(container);
    let view;
    if (step === 'intro') view = introStep();
    else if (step === 'pinyin') view = pinyinStep();
    else if (step === 'vocabulary') view = vocabularyStep();
    else if (step === 'exercises') view = exerciseStep();
    else view = resultStep();
    // Tones lesson: pinyin is the content here, so it is never hidden by the setting.
    container.append(h('div', { class: 'py-keep' }, view));
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
      h('h2', { text: label(lesson.titleKey) || lesson.id }),
      h('p', { text: label(lesson.introKey) }),
      h('button', { type: 'button', class: 'btn primary', text: t('learn.lessons.next'), onclick: () => go('pinyin') }),
    );
  }

  function pinyinStep() {
    const section = h('section', { class: 'card lesson-pinyin' }, h('h2', { text: t('tones.explanation.pinyinTitle') }));

    // Initials
    section.append(
      h('div', { class: 'explanation-block' },
        h('h3', { text: t('tones.explanation.initialsTitle') }),
        h('p', { text: t('tones.explanation.initialsDesc') }),
      ),
    );

    // Finals
    section.append(
      h('div', { class: 'explanation-block' },
        h('h3', { text: t('tones.explanation.finalsTitle') }),
        h('p', { text: t('tones.explanation.finalsDesc') }),
      ),
    );

    // Tones overview
    section.append(
      h('div', { class: 'explanation-block' },
        h('h3', { text: t('tones.explanation.tonesTitle') }),
        h('div', { class: 'tone-list' },
          h('div', { class: 'tone-item' }, h('span', { class: 'tone-badge', text: '1' }), h('span', { text: t('tones.explanation.tone1Desc') })),
          h('div', { class: 'tone-item' }, h('span', { class: 'tone-badge', text: '2' }), h('span', { text: t('tones.explanation.tone2Desc') })),
          h('div', { class: 'tone-item' }, h('span', { class: 'tone-badge', text: '3' }), h('span', { text: t('tones.explanation.tone3Desc') })),
          h('div', { class: 'tone-item' }, h('span', { class: 'tone-badge', text: '4' }), h('span', { text: t('tones.explanation.tone4Desc') })),
          h('div', { class: 'tone-item' }, h('span', { class: 'tone-badge', text: '0' }), h('span', { text: t('tones.explanation.tone0Desc') })),
        ),
      ),
    );

    section.append(h('button', { type: 'button', class: 'btn primary', text: t('learn.lessons.next'), onclick: () => go('vocabulary') }));
    return section;
  }

  function vocabularyStep() {
    const section = h('section', { class: 'card lesson-vocabulary' }, h('h2', { text: t('learn.lessons.vocabulary') }));

    // Table header
    const header = h('div', { class: 'vocab-header field' },
      h('span', { class: 'hanzi', text: t('tones.vocabulary.hanziLabel') }),
      h('span', { class: 'pinyin', text: t('tones.vocabulary.pinyinLabel') }),
      h('span', { class: 'tone', text: t('tones.vocabulary.toneLabel') }),
      h('span', { class: 'english', text: t('tones.vocabulary.meaningLabel') }),
    );
    section.append(header);

    for (const word of lesson.vocabulary ?? []) {
      const toneDisplay = t(`tones.toneName.${word.tone ?? 0}`);
      section.append(
        h('div', { class: 'vocab-item field' },
          h('span', { class: 'hanzi', text: word.hanzi }),
          h('span', { class: 'pinyin', html: pinyinHtml(word.pinyin) }),
          h('span', { class: 'tone', text: toneDisplay }),
          h('span', { class: 'english', text: word.english }),
          h('button', {
            type: 'button',
            class: 'btn option',
            text: t('tones.explanation.playTone', { tone: toneDisplay }),
            onclick: () => speak(word.pinyin, { lang: 'zh-CN' }),
          }),
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
        saveProgress({
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
    box.append(h('p', { class: 'prompt', text: label(exercise.promptKey) || exercise.prompt || '' }));

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
          await saveProgress({
            score: summary.correct,
            total: exercises.length,
            answered: exercises.length,
            completed: true,
          });
          window.dispatchEvent(
            new CustomEvent('chino:lesson_done', {
              detail: { level: 'hsk1', lessonId: LESSON_ID, score: summary.correct, total: exercises.length },
            }),
          );
          ctx.navigate('learn/tones');
        },
      }),
    );
  }

  draw();
}