/**
 * stats.js — study stats: daily activity counters + active-time tracking.
 *
 * attach() listens on window for the six chino:* progress events and on
 * document for visibilitychange. Active study time is the sum of the gaps
 * between checkpoints (an event or a visibility flip) that are shorter than
 * IDLE_THRESHOLD_MS; longer gaps are discarded as idle pauses. A short pause
 * while the tab is hidden still counts (the user is usually still studying).
 *
 * One record per day in the 'progress' store under 'stats:YYYY-MM-DD':
 *   { reviews, lessons, readings, strokes, minutes }
 *
 * Public API (reads are async, storage-backed):
 *   attach({ now, visible, storage }) -> { detach, flush }
 *   flush()                 -> Promise: persist the current session's counters
 *   getDay(dateStr)         -> { reviews, lessons, readings, strokes, minutes }
 *   getRange(days)          -> [{ date, reviews, lessons, readings, strokes, minutes }] (today first)
 *   getSummary()            -> { known, learning, total, minutesTotal, daysStudied }
 *   _resetForTest()         -> detach + drop injected clock/visibility/storage
 *
 * known = SRS cards with interval >= KNOWN_INTERVAL_DAYS, learning = the rest.
 * draw_used / speak_done carry no counter of their own: they only mark activity
 * (so they count toward study time).
 */
import storage from './storage.js';
import { createDeck } from './srs.js';
import { localDayKey } from './day.js';

export const STORE = 'progress';
export const KEY_PREFIX = 'stats:';
/** A gap this long or longer is an idle pause, not study time. */
export const IDLE_THRESHOLD_MS = 5 * 60 * 1000;
export const KNOWN_INTERVAL_DAYS = 21;
/** chino:* event -> counter field on the daily record. */
export const EVENT_FIELDS = {
  'chino:review_done': 'reviews',
  'chino:lesson_done': 'lessons',
  'chino:reading_done': 'readings',
  'chino:stroke_done': 'strokes',
};
/** Events with no counter of their own: activity (and study time) only. */
export const ACTIVITY_EVENTS = ['chino:draw_used', 'chino:speak_done'];
const EVENT_NAMES = [...Object.keys(EVENT_FIELDS), ...ACTIVITY_EVENTS];

const zeros = () => ({ reviews: 0, lessons: 0, readings: 0, strokes: 0, minutes: 0 });

const dayOf = localDayKey;

/** 'YYYY-MM-DD' shifted by whole days (calendar math, no DST surprises). */
function shiftDay(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return dayOf(new Date(y, m - 1, d + delta).getTime());
}

/** Injectable edges: clock, visibility and storage (tests swap them). */
const defaultDeps = () => ({
  now: () => Date.now(),
  visible: () => (typeof document === 'undefined' ? true : document.visibilityState === 'visible'),
  store: storage,
});
let deps = defaultDeps();

/** Current session: one day's unsaved counters plus the time base they add to. */
let session = null; // { day, ms, counts, base, dirty }
let lastTick = 0;
let active = false;
let writing = Promise.resolve();
let detachFns = [];

function blank(day) {
  return { day, ms: 0, counts: zeros(), base: null, dirty: false };
}

/** Persist the session's counters (queued, so writes never interleave). */
export function flush() {
  const s = session;
  if (!s || !s.dirty) return writing;
  s.dirty = false;
  writing = writing
    .then(async () => {
      const base = s.base ?? (await deps.store.get(STORE, KEY_PREFIX + s.day)) ?? zeros();
      s.base = base;
      await deps.store.set(STORE, KEY_PREFIX + s.day, {
        reviews: (base.reviews ?? 0) + s.counts.reviews,
        lessons: (base.lessons ?? 0) + s.counts.lessons,
        readings: (base.readings ?? 0) + s.counts.readings,
        strokes: (base.strokes ?? 0) + s.counts.strokes,
        minutes: (base.minutes ?? 0) + Math.floor(s.ms / 60000),
      });
    })
    .catch((err) => console.warn('stats: could not save', err));
  return writing;
}

/** Add the gap since the last checkpoint, then move the checkpoint. */
function tick(now) {
  if (!session) {
    session = blank(dayOf(now));
    lastTick = now;
    return;
  }
  if (dayOf(now) !== session.day) {
    // Day rolled over: the gap spans two days, so drop it and start fresh.
    flush();
    session = blank(dayOf(now));
    lastTick = now;
    return;
  }
  const gap = now - lastTick;
  if (gap > 0 && gap < IDLE_THRESHOLD_MS && (active || deps.visible())) {
    session.ms += gap;
    session.dirty = true;
  }
  lastTick = now;
}

function onEvent(field) {
  tick(deps.now());
  if (field) {
    session.counts[field] += 1;
    session.dirty = true;
  }
  flush();
}

function onVisibility() {
  tick(deps.now());
  active = deps.visible();
  flush();
}

/**
 * Start listening. Call once at startup (src/main.js).
 * Options (tests): { now, visible, storage }; `visibility` is an alias of
 * `visible`. Returns { detach, flush }.
 */
export function attach({ now, visible, visibility, storage: store } = {}) {
  if (detachFns.length) return { detach: () => {}, flush };
  deps = {
    now: now ?? deps.now,
    visible: visible ?? visibility ?? deps.visible,
    store: store ?? deps.store,
  };

  session = blank(dayOf(deps.now()));
  lastTick = deps.now();
  active = deps.visible();

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  const handlers = EVENT_NAMES.map((name) => [name, () => onEvent(EVENT_FIELDS[name])]);
  if (typeof window !== 'undefined') for (const [name, fn] of handlers) window.addEventListener(name, fn);

  const detach = () => {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') for (const [name, fn] of handlers) window.removeEventListener(name, fn);
    detachFns = [];
    session = null;
  };
  detachFns.push(detach);
  return { detach, flush };
}

/** Test helper: drop listeners and the injected clock/visibility/storage. */
export function _resetForTest() {
  for (const fn of detachFns) fn();
  detachFns = [];
  deps = defaultDeps();
  session = null;
  lastTick = 0;
  active = false;
  writing = Promise.resolve();
}

/** Stats for one day ('YYYY-MM-DD'); zeros when nothing was recorded. */
export async function getDay(dateStr) {
  const value = await deps.store.get(STORE, KEY_PREFIX + dateStr);
  return { ...zeros(), ...(value ?? {}) };
}

/** Last `days` days, today first, zeros for days with no record. */
export async function getRange(days) {
  const today = dayOf(deps.now());
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const date = shiftDay(today, -i);
    out.push({ date, ...(await getDay(date)) });
  }
  return out;
}

/** All-time summary: word counts, total minutes and days with any activity. */
export async function getSummary() {
  const cards = await createDeck(deps.store).listCards();
  let known = 0;
  for (const card of cards) if ((card.interval ?? 0) >= KNOWN_INTERVAL_DAYS) known += 1;

  let minutesTotal = 0;
  let daysStudied = 0;
  for (const { key, value } of await deps.store.list(STORE)) {
    if (!key.startsWith(KEY_PREFIX) || !value) continue;
    const minutes = value.minutes ?? 0;
    minutesTotal += minutes;
    const activity =
      (value.reviews ?? 0) + (value.lessons ?? 0) + (value.readings ?? 0) + (value.strokes ?? 0);
    if (activity > 0 || minutes > 0) daysStudied += 1;
  }

  return { known, learning: cards.length - known, total: cards.length, minutesTotal, daysStudied };
}

export default { attach, flush, getDay, getRange, getSummary, _resetForTest };
