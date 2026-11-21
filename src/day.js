/**
 * day.js — the one local-calendar-day rule, shared by screens, stats, the plan
 * and gamification (previously copied, with the same maths, in six modules).
 *
 * Both helpers accept a `Date` or a timestamp and default to "now".
 */

const pad = (n) => String(n).padStart(2, '0');

/** Local 'YYYY-MM-DD' (same day for the whole local calendar day). */
export function localDayKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole local days since 1970-01-01 (stable across the local day). */
export function localDayNumber(date = new Date()) {
  const d = new Date(date);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** Local 'YYYY-MM-DD' for a day number from localDayNumber (the inverse). */
export function localDayKeyFromNumber(dayNumber) {
  return new Date(dayNumber * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Day number of the Monday that starts the natural (ISO) week of `dayNumber`.
 * 1970-01-01 (day 0) was a Thursday, so `(dayNumber + 3) % 7` gives the offset
 * from Monday.
 */
export function weekStartNumber(dayNumber) {
  return dayNumber - ((dayNumber + 3) % 7);
}
