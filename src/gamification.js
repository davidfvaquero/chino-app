/**
 * gamification.js — streaks, points and achievements. No UI, no DOM, no direct
 * storage access: everything persists through src/storage.js (store
 * `gamification`, single key `state`).
 *
 *   record(event, payload?)  -> Promise<stats>  (stats + what it just unlocked)
 *   getStats()               -> Promise<{ streak, bestStreak, points, level,
 *                                          achievements[], todayDone }>
 *   evaluateAchievements(stats, defs) -> defs whose rule is met (pure)
 *   createGamification({ storage, now, definitions }) -> same API, injectable
 *
 * Events and their points (see EVENTS): review_done 10, lesson_done 50,
 * reading_done 20, stroke_done 2, draw_used 1, speak_done 5. Any other event
 * throws. `payload` is optional and currently ignored (kept in the signature so
 * callers can pass context without breaking).
 *
 * Streak = consecutive natural days (local time) with at least one event: a
 * second event on the same day does not count twice, a skipped day resets it to
 * 1. `todayDone` is how many events were recorded today. Level = 1 point per
 * POINTS_PER_LEVEL, level 1 starts at 0 points.
 *
 * Achievements come from public/data/achievements.json:
 *   [{ id, nameKey, descKey, rule: { event, count } | { streak } | { points } }]
 *
 * i18n: the texts live behind `gamification.ach.<id>.name` / `.desc`. There is
 * no docs/CONVENTIONS.md yet and src/i18n.js has no src/locales/en.d/*.json
 * merge (it loads src/locales/en.json only), so those keys are undefined for
 * now and t() falls back to the key itself. When the CONVENTIONS task lands the
 * en.d mechanism, write them into src/locales/en.d/gamification.json — nothing
 * in this file changes (same note left on the kanban card).
 *
 * `now` (a function returning ms) is injectable for tests; the clock is read
 * once per call.
 */
import storage from './storage.js';

export const STORE = 'gamification';
export const STATE_KEY = 'state';

/** Points awarded per event. Anything not listed here is rejected by record(). */
export const EVENTS = {
  review_done: 10,
  lesson_done: 50,
  reading_done: 20,
  stroke_done: 2,
  draw_used: 1,
  speak_done: 5,
};

/** Points per level; level 1 covers 0..POINTS_PER_LEVEL-1. */
export const POINTS_PER_LEVEL = 100;

/** Default location of the achievement definitions (public/ lands at dist root). */
export const ACHIEVEMENTS_URL = '../data/achievements.json';

const emptyState = () => ({
  points: 0,
  streak: 0,
  bestStreak: 0,
  lastDay: null,
  days: {},
  events: {},
  achievements: {},
});

/**
 * Local natural-day number (days since the UTC epoch shifted by the local tz
 * offset). Same calendar day -> same number, consecutive days -> +1.
 */
export function dayIndex(now = Date.now()) {
  const d = new Date(now);
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
}

export function levelFor(points) {
  return Math.floor(Math.max(0, points) / POINTS_PER_LEVEL) + 1;
}

/**
 * Pure: which definitions are satisfied by these stats?
 * `stats` needs { points, streak, events: { event: count } }.
 */
export function evaluateAchievements(stats, defs) {
  const points = stats?.points ?? 0;
  const streak = stats?.streak ?? 0;
  const events = stats?.events ?? {};
  return (defs ?? []).filter((def) => {
    const rule = def?.rule ?? {};
    if (rule.streak != null) return streak >= rule.streak;
    if (rule.points != null) return points >= rule.points;
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
    // A streak only survives if the last study day is today or yesterday.
    const alive = state.lastDay != null && today - state.lastDay <= 1;
    return {
      streak: alive ? state.streak : 0,
      bestStreak: state.bestStreak,
      points: state.points,
      level: levelFor(state.points),
      todayDone: state.days[today] ?? 0,
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
    void payload; // accepted for callers' convenience, deliberately unused
    if (!Object.prototype.hasOwnProperty.call(EVENTS, event)) {
      throw new Error(`gamification: unknown event "${event}"`);
    }
    const at = now();
    const today = dayIndex(at);
    const list = await defs();
    const state = await load();

    state.points += EVENTS[event];
    state.events[event] = (state.events[event] ?? 0) + 1;
    state.days[today] = (state.days[today] ?? 0) + 1;

    // Streak only moves on the first event of a new natural day.
    if (state.lastDay !== today) {
      state.streak = state.lastDay != null && today - state.lastDay === 1 ? state.streak + 1 : 1;
      state.lastDay = today;
      if (state.streak > state.bestStreak) state.bestStreak = state.streak;
    }

    const unlocked = [];
    for (const def of evaluateAchievements(state, list)) {
      if (state.achievements[def.id] == null) {
        state.achievements[def.id] = at; // unlocked once, never again
        unlocked.push(def);
      }
    }

    await save(state);
    return { event, gained: EVENTS[event], unlocked, ...snapshot(state, list, at) };
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
