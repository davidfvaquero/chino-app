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
import { getDay } from '../stats.js';
import { getStats } from '../gamification.js';
import { getSettings, DEFAULTS } from '../settings.js';
import { getHardWords } from '../hardwords.js';
import { loadIndex as loadLessonIndex, getProgress } from '../learn/lessons.js';
import { loadIndex as loadReadingIndex } from '../reading/data.js';

export const titleKey = 'screens.home.title';

const HSK1_URL = new URL('../../data/hsk/1.json', import.meta.url);
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

const CSS = `
.home { display: grid; gap: 0.75rem; }
.home .card { display: grid; gap: 0.5rem; padding: var(--pad); border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg-soft); }
.home h2 { margin: 0; font-size: 0.8rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--fg-soft); }
.home .home-go { min-height: 3rem; border: 0; border-radius: var(--radius); background: var(--accent); color: var(--accent-fg); font: inherit; font-weight: 600; cursor: pointer; }
.home .home-link { min-height: 2.75rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); color: inherit; font: inherit; cursor: pointer; }
.home .home-hanzi { font-size: 3rem; line-height: 1.2; font-weight: 600; }
.home .home-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.home .home-row > * { flex: 1 1 8rem; }
.home .home-bar { height: 0.6rem; border-radius: 999px; background: var(--line); overflow: hidden; }
.home .home-bar > span { display: block; height: 100%; background: var(--accent); }
.home .home-muted { color: var(--fg-soft); margin: 0; }
`;

function ensureStyles() {
  if (document.getElementById('home-styles')) return;
  document.head.append(h('style', { id: 'home-styles', text: CSS }));
}

const safe = (promise, fallback) => Promise.resolve(promise).catch(() => fallback);

async function loadWordList() {
  const res = await fetch(HSK1_URL);
  if (!res.ok) throw new Error(`home: ${res.status}`);
  return (await res.json()).items ?? [];
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
  return {
    next: chooseNextStep({ due, lesson, reading }),
    hard: hard.length,
    goal: goalProgress(day.reviews, settings.dailyGoal),
    streak: stats.streak ?? 0,
    word: pickWordOfDay(words, now),
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
    class: 'home-link',
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
    { class: 'card', 'data-role': 'wotd' },
    h('h2', { text: t('home.wotd.title') }),
    h('div', { class: 'home-hanzi', text: word.hanzi }),
    h('div', { class: 'pinyin', html: pinyinHtml(word.pinyin) }),
    h('p', { class: 'home-muted', text: word.english }),
    h(
      'div',
      { class: 'home-row' },
      h('button', { type: 'button', class: 'home-link', 'data-role': 'wotd-audio', text: t('home.wotd.audio'), onclick: () => speak(word.hanzi) }),
      add,
    ),
  );
}

export async function render(container, ctx = {}) {
  ensureStyles();
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

  const { next, hard, goal, streak, word } = state;
  const nextCard = h(
    'section',
    { class: 'card', 'data-role': 'next', 'data-kind': next.kind },
    h('h2', { text: t('home.next.title') }),
    h('button', { type: 'button', class: 'home-go', 'data-role': 'next-go', text: nextLabel(next), onclick: () => go(next.path) }),
  );
  if (hard > 0) {
    nextCard.append(
      h('button', { type: 'button', class: 'home-link', 'data-role': 'hard', text: t('home.hard', { n: hard }), onclick: () => go('learn/hardwords') }),
    );
  }

  const goalCard = h(
    'section',
    { class: 'card', 'data-role': 'goal' },
    h('h2', { text: t('home.goal.title') }),
    h('p', { class: 'home-muted', text: t(goal.reached ? 'home.goal.reached' : 'home.goal.progress', { done: goal.done, goal: goal.goal }) }),
    h('div', { class: 'home-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(goal.goal), 'aria-valuenow': String(Math.min(goal.done, goal.goal)) }, h('span', { style: `width:${goal.pct}%` })),
    h('p', { class: 'home-muted', 'data-role': 'streak', text: t('home.streak', { n: streak }) }),
  );

  reset(container).append(h('div', { class: 'home' }, nextCard, goalCard, word ? wordCard(word) : null));
  container.focus({ preventScroll: true });
}
