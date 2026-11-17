/**
 * hardwords.js — "hard words" = review cards the learner keeps failing.
 *
 * Criterion (src/srs.js fields; absent = 0 / default ease, so old cards work):
 *   - a card is HARD when `lapses >= min` (default 3): answered "again" that often.
 *   - severity = lapses + (DEFAULT_EASE - ease). Low ease (SM-2 drops it on every
 *     miss, floor 1.3) breaks ties and pushes chronically failed cards up.
 *   - list is sorted by severity, highest first; ties by id (stable).
 *
 * Public API:
 *   hardWords(cards, {min})      pure: cards -> [{...card, lapses, severity}]
 *   getHardWords({min, store})   async: same over the srs deck in storage
 */
import storage from './storage.js';
import { DEFAULT_EASE } from './srs.js';

export const DEFAULT_MIN = 3;

export function hardWords(cards, { min = DEFAULT_MIN } = {}) {
  return (cards ?? [])
    .filter(Boolean)
    .map((card) => {
      const lapses = card.lapses ?? 0;
      return { ...card, lapses, severity: lapses + (DEFAULT_EASE - (card.ease ?? DEFAULT_EASE)) };
    })
    .filter((card) => card.lapses >= min)
    .sort((a, b) => b.severity - a.severity || String(a.id).localeCompare(String(b.id)));
}

export async function getHardWords({ min = DEFAULT_MIN, store = storage } = {}) {
  const rows = await store.list('srs');
  return hardWords(rows.map((row) => row.value), { min });
}
