/**
 * exercise-view.js — the exercise body shared by the lessons screen
 * (src/learn/lessons.js) and the Tones lesson (src/learn/tones.js).
 *
 * docs/REVIEW.md #20: tones.js used to carry its own copy of `exerciseView`,
 * `choiceBody` and `finish`, and the copy had drifted from lessons.js. Both
 * screens now build the exercise from here.
 *
 * The two lessons now share one full body: pinyin readings under the hanzi,
 * right/wrong marking on the options, the answer named in the failure text and
 * a `role=status` live region (docs/REVIEW-2.md I3 removed the flag that kept
 * Tones on a poorer copy).
 *
 * `config`:
 *   readings    Map      hanzi -> pinyin, for the prompt/option reading.
 *   vocabWords  Map      hanzi -> vocabulary entry, for the meaning in the
 *                        failure text.
 *   promptOf    fn       exercise -> prompt text. Default `ex.prompt ?? ''`.
 *   listenClass string   class of the Play button. Default 'btn primary'.
 *   orderBody   fn       optional: (exercise, box, onContinue) for `order`.
 *   matchBody   fn       optional: (exercise, box, onContinue) for `match`.
 *
 * `h`/`t` still come from the app, so this stays a pure renderer: no storage,
 * no routing, no state.
 */
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { speak } from '../audio.js';
import { pinyinHtml } from '../tone.js';
import { gradeExercise, expectedAnswer } from './exercises.js';

const HAN = /\p{Script=Han}/u;
const HAN_RUN = /\p{Script=Han}+/gu;

/** Reading without tone marks, so a display pinyin can be compared with an option. */
const bareReading = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s'’-]/g, '')
    .toLowerCase();

/** Pinyin of every hanzi run in `value`; whole vocabulary words first, then single characters. */
export function pinyinForText(value, map) {
  const out = [];
  for (const run of String(value ?? '').match(HAN_RUN) ?? []) {
    const chars = [...run];
    let i = 0;
    while (i < chars.length) {
      let hit = '';
      for (let len = Math.min(4, chars.length - i); len >= 1; len -= 1) {
        const slice = chars.slice(i, i + len).join('');
        if (map?.has(slice)) {
          hit = map.get(slice);
          i += len;
          break;
        }
      }
      if (hit) out.push(hit);
      else i += 1;
    }
  }
  return out.join(' ').trim();
}

/** `<span class="pinyin">` from pinyinHtml (the global pinyin switch hides it), or null. */
export const pinyinLine = (pinyin) => (pinyin ? h('span', { class: 'pinyin', html: pinyinHtml(pinyin) }) : null);

/** Thin progress bar: `value` of `max` steps done. */
export function progressBar(value, max) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return h(
    'div',
    { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(max), 'aria-valuenow': String(value) },
    h('span', { style: `width:${pct}%` }),
  );
}

/** Live region for the right/wrong message (WCAG 4.1.3); the focus never moves to it. */
export function feedbackBox() {
  return h('div', { class: 'feedback-box', role: 'status', 'aria-live': 'polite' });
}

/** The correct answer as display text, with its meaning when the answer is a lesson word. */
function answerLabel(result, vocabWords) {
  const expected = expectedAnswer(result);
  if (!expected || result.type === 'match') return expected;
  const meaning = vocabWords?.get(expected)?.english;
  return meaning ? `${expected} (${meaning})` : expected;
}

/** The failure text: names the right answer. */
function wrongText(result, config = {}) {
  return t('learn.lessons.incorrectAnswer', { answer: answerLabel(result, config.vocabWords) });
}

/**
 * Reading of the hanzi inside a `choose` prompt (P2-1). Empty for the other
 * types (their hanzi are the option/chip buttons) and when the reading would
 * be the answer — the pinyin-choice exercise must not give itself away.
 */
function promptReading(exercise, readings) {
  if (exercise.type !== 'choose') return '';
  const reading = pinyinForText(exercise.prompt ?? '', readings);
  if (!reading) return '';
  const candidates = [...(exercise.options ?? []), exercise.answer];
  if (candidates.some((value) => bareReading(value) === bareReading(reading))) return '';
  return reading;
}

export function finish(feedback, result, onContinue, config = {}) {
  feedback.append(
    h('p', {
      class: result.correct ? 'feedback ok' : 'feedback bad',
      text: result.correct ? t('learn.lessons.correct') : wrongText(result, config),
    }),
  );
  feedback.append(h('button', {
    type: 'button',
    class: 'btn primary',
    text: t('learn.lessons.continue'),
    onclick: (event) => {
      const button = event.currentTarget;
      if (button.disabled) return; // a double click must not skip an exercise
      button.disabled = true;
      onContinue(result);
    },
  }));
}

function choiceBody(exercise, box, onContinue, config = {}) {
  const feedback = feedbackBox(config);
  const options = h('div', { class: 'options' });
  for (const option of exercise.options ?? []) {
    const value = String(option);
    const isHan = HAN.test(value);
    const reading = isHan ? pinyinForText(value, config.readings) : '';
    options.append(
      h(
        'button',
        {
          type: 'button',
          class: `btn option${isHan ? ' hz' : ''}`,
          'data-value': value,
          onclick: (event) => {
            const result = gradeExercise(exercise, option);
            for (const btn of options.children) {
              btn.disabled = true;
              if (btn.dataset.value === result.expected) btn.classList.add(result.correct ? 'is-correct' : 'is-missed');
            }
            if (!result.correct) event.currentTarget.classList.add('is-wrong');
            finish(feedback, result, onContinue, config);
          },
        },
        ...(isHan ? [h('span', { class: 'option-label', text: value }), pinyinLine(reading)] : [value]),
      ),
    );
  }
  box.append(options, feedback);
  return box;
}

/** Builds the body of one exercise: prompt, optional Play button, then its controls. */
export function exerciseView(exercise, onContinue, config = {}) {
  const promptOf = config.promptOf ?? ((value) => value.prompt ?? '');
  const box = h('div', { class: 'exercise-body' });
  box.append(h('p', { class: 'prompt', text: promptOf(exercise) }));
  const reading = promptReading(exercise, config.readings);
  if (reading) box.append(h('p', { class: 'pinyin', html: pinyinHtml(reading) }));
  if (exercise.type === 'listen') {
    box.append(
      h('button', {
        type: 'button',
        class: config.listenClass ?? 'btn primary',
        text: t('learn.lessons.playAudio'),
        onclick: () => speak(exercise.audio, { lang: 'zh-CN' }),
      }),
    );
  }
  if (exercise.type === 'choose' || exercise.type === 'listen') return choiceBody(exercise, box, onContinue, config);
  if (exercise.type === 'order' && config.orderBody) return config.orderBody(exercise, box, onContinue);
  if (exercise.type === 'match' && config.matchBody) return config.matchBody(exercise, box, onContinue);
  return box;
}
