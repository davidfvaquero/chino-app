/**
 * Home screen (`#/home`, default route): next step, word of the day, daily goal, streak.
 *
 * Pure helpers (tested without DOM): dayKey, dayNumber, pickWordOfDay, goalProgress,
 * findNextLesson, chooseNextStep. Contract: titleKey + render(container, ctx).
 *
 * Next step: due cards -> Review; else first unfinished HSK1 lesson; else a reading;
 * else the Learn menu. Hard words are suggested as a secondary line when any exist.
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import { countDue, addToReview } from '../srs.js';
import { speak } from '../audio.js';
import { pinyinHtml } from '../tone.js';
import { hanziCell } from '../hanzi.js';
import { getDay } from '../stats.js';
import { getStats } from '../gamification.js';
import { getSettings, DEFAULTS } from '../settings.js';
import { getHardWords } from '../hardwords.js';
import { loadIndex as loadLessonIndex, getProgress } from '../learn/lessons.js';
import { loadIndex as loadReadingIndex } from '../reading/data.js';
import { loadPlan, getProgress as getPlanProgress, currentDay } from '../learn/plan.js';
import { fetchData } from '../data-url.js';

export const titleKey = 'screens.home.title';

const WOTD_STEP = 37; // coprime with 150 words: visits every word, no neighbours on consecutive days

/** Local 'YYYY-MM-DD' (same key format as src/stats.js). */
export function dayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Whole local days since 1970-01-01 (stable across the local day). */
export function dayNumber(date = new Date()) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

/** Deterministic word for a date; null when the list is empty. */
export function pickWordOfDay(items, date = new Date()) {
  if (!Array.isArray(items) || !items.length) return null;
  return items[(dayNumber(date) * WOTD_STEP) % items.length];
}

/** {done, goal, pct (0-100), reached} for the daily-goal bar. */
export function goalProgress(done, goal) {
  const d = Math.max(0, Number(done) || 0);
  const g = Math.max(1, Number(goal) || DEFAULTS.dailyGoal);
  return { done: d, goal: g, pct: Math.min(100, Math.round((d / g) * 100)), reached: d >= g };
}

/** First lesson of an index whose progress is not completed, or null. */
export async function findNextLesson(index, progressOf) {
  for (const lesson of index?.lessons ?? []) {
    const progress = await progressOf(lesson.id);
    if (!progress?.completed) return lesson;
  }
  return null;
}

/**
 * Pure decision: { kind: 'review'|'lesson'|'read'|'learn', path, ...detail }.
 * `lesson` / `reading` are index entries (or null), `due` a count.
 */
export function chooseNextStep({ due = 0, lesson = null, reading = null } = {}) {
  if (due > 0) return { kind: 'review', path: 'review', n: due };
  if (lesson) return { kind: 'lesson', path: `learn/lessons/${lesson.id}`, title: lesson.title ?? lesson.id };
  if (reading) return { kind: 'read', path: `read/${reading.id}`, title: reading.title ?? reading.id };
  return { kind: 'learn', path: 'learn' };
}

const safe = (promise, fallback) => Promise.resolve(promise).catch(() => fallback);

async function loadWordList() {
  const data = await fetchData('hsk/1.json');
  return data.items ?? [];
}

async function gather(now) {
  const lessonIndex = await safe(loadLessonIndex('hsk1'), null);
  const readings = await safe(loadReadingIndex(), []);
  const [due, hard, day, stats, settings, words, lesson] = await Promise.all([
    safe(countDue(), 0),
    safe(getHardWords(), []),
    safe(getDay(dayKey(now)), { reviews: 0 }),
    safe(getStats(), { streak: 0 }),
    safe(getSettings(), DEFAULTS),
    safe(loadWordList(), []),
    safe(findNextLesson(lessonIndex, (id) => getProgress('hsk1', id)), null),
  ]);
  const reading = readings.length ? readings[dayNumber(now) % readings.length] : null;
  const [plan, planProgress] = await Promise.all([safe(loadPlan(), null), safe(getPlanProgress(), null)]);
  let planInfo = null;
  if (plan && planProgress) {
    const day = currentDay(plan, planProgress, now);
    planInfo = { day, titleKey: plan.days[day - 1]?.titleKey ?? '' };
  }
  return {
    next: chooseNextStep({ due, lesson, reading }),
    hard: hard.length,
    goal: goalProgress(day.reviews, settings.dailyGoal),
    streak: stats.streak ?? 0,
    word: pickWordOfDay(words, now),
    plan: planInfo,
  };
}

function nextLabel(next) {
  if (next.kind === 'review') return t('home.next.review', { n: next.n });
  if (next.kind === 'lesson') return t('home.next.lesson', { title: next.title });
  if (next.kind === 'read') return t('home.next.read', { title: next.title });
  return t('home.next.learn');
}

function wordCard(word) {
  const add = h('button', {
    type: 'button',
    class: 'btn',
    'data-role': 'wotd-add',
    text: t('home.wotd.add'),
    onclick: async () => {
      add.disabled = true;
      await addToReview({ hanzi: word.hanzi, trad: word.trad, pinyin: word.pinyin, pinyinNumeric: word.pinyinNumeric, english: word.english, source: 'wotd' });
      add.textContent = t('home.wotd.added');
    },
  });
  return h(
    'section',
    { class: 'card home-wotd', 'data-role': 'wotd' },
    h('h2', { text: t('home.wotd.title') }),
    hanziCell(word.hanzi, 'lg'),
    h('div', { class: 'pinyin', html: pinyinHtml(word.pinyin) }),
    h('p', { class: 'home-muted', text: word.english }),
    h(
      'div',
      { class: 'home-row' },
      h('button', { type: 'button', class: 'btn', 'data-role': 'wotd-audio', text: t('home.wotd.audio'), onclick: () => speak(word.hanzi) }),
      add,
    ),
  );
}

export async function render(container, ctx = {}) {
  const go = (path) => (typeof ctx.navigate === 'function' ? ctx.navigate(path) : (location.hash = `#/${path}`));
  reset(container).append(h('p', { class: 'home-muted', text: t('common.loading') }));
  let state;
  try {
    state = await gather(new Date());
  } catch (err) {
    console.error('home screen', err);
    reset(container).append(h('p', { class: 'home-muted', text: t('home.error') }));
    return;
  }

  const { next, hard, goal, streak, word, plan } = state;
  const nextCard = h(
    'section',
    { class: 'home-next', 'data-role': 'next', 'data-kind': next.kind },
    h('h2', { text: t('home.next.title') }),
    h('button', { type: 'button', class: 'btn primary lg block', 'data-role': 'next-go', text: nextLabel(next), onclick: () => go(next.path) }),
  );
  if (hard > 0) {
    nextCard.append(
      h('button', { type: 'button', class: 'btn block', 'data-role': 'hard', text: t('home.hard', { n: hard }), onclick: () => go('learn/hardwords') }),
    );
  }

  const goalCard = h(
    'section',
    { class: 'home-goal', 'data-role': 'goal' },
    h('h2', { text: t('home.goal.title') }),
    h('p', { class: 'home-muted', text: t(goal.reached ? 'home.goal.reached' : 'home.goal.progress', { done: goal.done, goal: goal.goal }) }),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(goal.goal), 'aria-valuenow': String(Math.min(goal.done, goal.goal)) }, h('span', { style: `width:${goal.pct}%` })),
    h('p', { class: 'home-muted', 'data-role': 'streak', text: t('home.streak', { n: streak }) }),
  );

  const planCard = plan
    ? h(
        'section',
        { class: 'card home-plan', 'data-role': 'plan' },
        h('h2', { text: t('plan.home.title') }),
        h('p', { class: 'home-muted', 'data-role': 'plan-day', text: t('plan.home.day', { n: plan.day, title: t(plan.titleKey) }) }),
        h('button', { type: 'button', class: 'btn', 'data-role': 'plan-go', text: t('plan.home.open'), onclick: () => go('learn/plan') }),
      )
    : null;

  reset(container).append(h('div', { class: 'home' }, nextCard, planCard, goalCard, word ? wordCard(word) : null));
  container.focus({ preventScroll: true });
}
