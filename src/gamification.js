/**
 * gamification.js — streaks, points and achievements. No UI, no DOM, no direct
 * storage access: everything persists through src/storage.js (store
 * `gamification`, single key `state`).
 *
 *   record(event, payload?)  -> Promise<stats>  (stats + what it just unlocked)
 *   getStats()               -> Promise<{ streak, bestStreak, points, level,
 *                                          todayDone, daysStudied, week,
 *                                          nextLevel, streakAtRisk, achievements[] }>
 *   evaluateAchievements(stats, defs) -> defs whose rule is met (pure)
 *   createGamification({ storage, now, definitions }) -> same API, injectable
 *
 * Events and their points (see EVENTS): review_done 10, lesson_done 50,
 * reading_done 20, dialogue_done 20, stroke_done 2, draw_used 1, speak_done 5,
 * example_played 1 (capped at DAILY_CAPS.example_played points per natural day).
 * Any other event throws. `payload` is optional; the only field read today is
 * `{ level, lessonId }` on lesson_done (to track level completion).
 *
 * Streak = consecutive natural days (local time) with at least one event: a
 * second event on the same day does not count twice, a skipped day resets it to
 * 1 — unless a free streak freeze covers the gap (see below). `todayDone` is how
 * many events were recorded today. Level = 1 point per POINTS_PER_LEVEL, level 1
 * starts at 0 points.
 *
 * Streak freeze (free, one per natural week): when exactly one day is missing
 * between two study days the streak continues and the frozen day is recorded in
 * `state.freezesUsed` as `{ day: 'YYYY-MM-DD', week: <monday day number> }`.
 * Two or more missing days break it; a clock that moves backwards never does.
 *
 * Achievements come from public/data/achievements.json:
 *   [{ id, nameKey, descKey,
 *      rule: { event, count } | { streak } | { points } | { level, count } }]
 * `{ level, count }` = at least `count` distinct lessons finished at that level
 * (lesson_done payload carries `{ level, lessonId }`).
 *
 * i18n: the texts live under `gamification.ach.<id>.name` / `.desc` in
 * src/locales/en.d/gamification.json (and the es equivalent), which i18n.js
 * merges in with the other locale shards. Adding a new achievement means a new
 * entry there; nothing in this file changes.
 *
 * `now` (a function returning ms) is injectable for tests; the clock is read
 * once per call.
 */
import storage from './storage.js';
import { localDayNumber, localDayKeyFromNumber, weekStartNumber } from './day.js';

export const STORE = 'gamification';
export const STATE_KEY = 'state';

/** Points awarded per event. Anything not listed here is rejected by record(). */
export const EVENTS = {
  review_done: 10,
  lesson_done: 50,
  reading_done: 20,
  dialogue_done: 20,
  stroke_done: 2,
  draw_used: 1,
  speak_done: 5,
  example_played: 1,
};

/** Events capped to a number of *points* per natural day. */
export const DAILY_CAPS = {
  example_played: 10,
};

/** Points per level; level 1 covers 0..POINTS_PER_LEVEL-1. */
export const POINTS_PER_LEVEL = 100;

/** How many days the calendar helper (daysStudied) looks back. */
export const DAYS_WINDOW = 84;

/** Default location of the achievement definitions (public/ lands at dist root). */
export const ACHIEVEMENTS_URL = '../data/achievements.json';

const emptyState = () => ({
  points: 0,
  streak: 0,
  bestStreak: 0,
  lastDay: null,
  days: {}, // dayNumber -> event count (calendar)
  dayEvents: {}, // dayNumber -> { event: count } (per-week breakdown)
  dayPoints: {}, // dayNumber -> points earned that day
  events: {},
  levels: {}, // level -> { lessonId: true } (distinct finished lessons)
  freezesUsed: [], // [{ day: 'YYYY-MM-DD', week: <monday day number> }]
  achievements: {},
});

/**
 * Local natural-day number (days since 1970-01-01 in the local timezone).
 * Same calendar day -> same number, consecutive days -> +1.
 */
export const dayIndex = localDayNumber;

export function levelFor(points) {
  return Math.floor(Math.max(0, points) / POINTS_PER_LEVEL) + 1;
}

/** Distinct finished lessons per level, as a plain count map. */
function levelCounts(state) {
  const out = {};
  for (const [level, ids] of Object.entries(state.levels ?? {})) {
    out[level] = Object.keys(ids).length;
  }
  return out;
}

/** Points/events/streak for one natural week (Monday..Sunday). */
function weekTotals(state, today, weeksAgo) {
  const start = weekStartNumber(today) - weeksAgo * 7;
  const out = { reviews: 0, lessons: 0, readings: 0, dialogues: 0, points: 0 };
  for (let day = start; day < start + 7; day += 1) {
    const ev = state.dayEvents?.[day];
    if (ev) {
      out.reviews += ev.review_done ?? 0;
      out.lessons += ev.lesson_done ?? 0;
      out.readings += ev.reading_done ?? 0;
      out.dialogues += ev.dialogue_done ?? 0;
    }
    out.points += state.dayPoints?.[day] ?? 0;
  }
  return out;
}

/**
 * Pure: which definitions are satisfied by these stats?
 * `stats` needs { points, streak, events: { event: count }, levels: { level: count } }.
 */
export function evaluateAchievements(stats, defs) {
  const points = stats?.points ?? 0;
  const streak = stats?.streak ?? 0;
  const events = stats?.events ?? {};
  const levels = stats?.levels ?? {};
  return (defs ?? []).filter((def) => {
    const rule = def?.rule ?? {};
    if (rule.streak != null) return streak >= rule.streak;
    if (rule.points != null) return points >= rule.points;
    if (rule.level != null) return (levels[rule.level] ?? 0) >= (rule.count ?? 1);
    if (rule.event) return (events[rule.event] ?? 0) >= (rule.count ?? 1);
    return false;
  });
}

/** Loads the achievement definitions (JSON array; also accepts {achievements:[]}). */
export async function loadAchievements({ base = ACHIEVEMENTS_URL, fetchJson } = {}) {
  const url = base instanceof URL ? base : new URL(base, import.meta.url);
  const read = fetchJson ?? (async (u) => (await fetch(u)).json());
  const data = await read(url);
  return Array.isArray(data) ? data : (data?.achievements ?? []);
}

/**
 * Builds a gamification API. All three dependencies are injectable:
 * `storage` (default: the app storage), `now` (ms clock) and `definitions`
 * (an array, or an async loader resolved once and cached).
 */
export function createGamification({
  storage: store = storage,
  now = () => Date.now(),
  definitions = [],
} = {}) {
  let defsPromise = null;
  const defs = () => {
    if (Array.isArray(definitions)) return Promise.resolve(definitions);
    if (!defsPromise) {
      defsPromise = Promise.resolve()
        .then(() => definitions())
        .then((list) => (Array.isArray(list) ? list : (list?.achievements ?? [])))
        .catch(() => []);
    }
    return defsPromise;
  };

  const load = async () => ({ ...emptyState(), ...((await store.get(STORE, STATE_KEY)) ?? {}) });
  const save = (state) => store.set(STORE, STATE_KEY, state);

  const snapshot = (state, list, at) => {
    const today = dayIndex(at);
    // A streak only survives if the last study day is today or yesterday (a
    // clock that moved backwards also keeps it: the difference goes negative).
    const alive = state.lastDay != null && today - state.lastDay <= 1;
    const points = state.points;
    const into = points % POINTS_PER_LEVEL;
    const daysStudied = [];
    for (let day = today - (DAYS_WINDOW - 1); day <= today; day += 1) {
      const count = state.days?.[day];
      if (count) daysStudied.push({ date: localDayKeyFromNumber(day), count });
    }
    return {
      streak: alive ? state.streak : 0,
      bestStreak: state.bestStreak,
      points,
      level: levelFor(points),
      todayDone: state.days?.[today] ?? 0,
      daysStudied,
      week: {
        current: weekTotals(state, today, 0),
        previous: weekTotals(state, today, 1),
      },
      nextLevel: { points: into, needed: POINTS_PER_LEVEL - into, pct: Math.round((into / POINTS_PER_LEVEL) * 100) },
      streakAtRisk: (state.days?.[today] ?? 0) === 0 && (state.days?.[today - 1] ?? 0) > 0,
      freezesUsed: state.freezesUsed ?? [],
      achievements: list.map((def) => ({
        ...def,
        unlocked: state.achievements[def.id] != null,
        unlockedAt: state.achievements[def.id] ?? null,
      })),
    };
  };

  async function getStats() {
    const at = now();
    return snapshot(await load(), await defs(), at);
  }

  async function doRecord(event, payload = {}) {
    if (!Object.prototype.hasOwnProperty.call(EVENTS, event)) {
      throw new Error(`gamification: unknown event "${event}"`);
    }
    const at = now();
    const today = dayIndex(at);
    const list = await defs();
    const state = await load();

    // Points, capped per day for events listed in DAILY_CAPS.
    const dayEvents = (state.dayEvents[today] ??= {});
    const already = dayEvents[event] ?? 0;
    const cap = DAILY_CAPS[event];
    const gained = cap != null && already >= cap ? 0 : EVENTS[event];

    state.points += gained;
    state.events[event] = (state.events[event] ?? 0) + 1;
    state.days[today] = (state.days[today] ?? 0) + 1;
    dayEvents[event] = already + 1;
    state.dayPoints[today] = (state.dayPoints[today] ?? 0) + gained;

    // Track distinct finished lessons per level (for { level } achievements).
    if (event === 'lesson_done' && payload?.level && payload?.lessonId) {
      (state.levels[payload.level] ??= {})[payload.lessonId] = true;
    }

    // Streak only moves on the first event of a new natural day.
    if (state.lastDay !== today) {
      if (state.lastDay == null) {
        state.streak = 1;
        state.lastDay = today;
      } else if (today > state.lastDay) {
        const gap = today - state.lastDay;
        if (gap === 1) {
          state.streak += 1;
        } else if (gap === 2) {
          // Exactly one missing day: spend a free freeze for that week if any.
          const missing = state.lastDay + 1;
          const week = weekStartNumber(missing);
          const usedThisWeek = state.freezesUsed.some((f) => f.week === week);
          if (usedThisWeek) {
            state.streak = 1;
          } else {
            state.freezesUsed.push({ day: localDayKeyFromNumber(missing), week });
            state.streak += 1;
          }
        } else {
          state.streak = 1;
        }
        state.lastDay = today;
      }
      // today < lastDay: a clock that moved backwards keeps the streak as-is.
      if (state.streak > state.bestStreak) state.bestStreak = state.streak;
    }

    const unlocked = [];
    const view = { ...state, levels: levelCounts(state) };
    for (const def of evaluateAchievements(view, list)) {
      if (state.achievements[def.id] == null) {
        state.achievements[def.id] = at; // unlocked once, never again
        unlocked.push(def);
      }
    }

    await save(state);
    return { event, gained, unlocked, ...snapshot(state, list, at) };
  }

  // Serialize records: simultaneous events used to read-modify-write the same
  // state and lose points (3 parallel events stored 1 point instead of 21).
  let queue = Promise.resolve();
  const record = (event, payload) => {
    const run = queue.then(() => doRecord(event, payload));
    queue = run.catch(() => {});
    return run;
  };

  return { record, getStats };
}

/** App-wide instance: real storage, real clock, definitions fetched on demand. */
export const gamification = createGamification({
  definitions: () => loadAchievements(),
});

export const record = (...args) => gamification.record(...args);
export const getStats = (...args) => gamification.getStats(...args);
export default gamification;
