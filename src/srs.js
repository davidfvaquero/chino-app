/**
 * srs.js — spaced repetition (SM-2) for the review deck.
 *
 * CARD FORMAT (documented contract, stored in the `srs` store, key = id):
 *   {
 *     id:            string   stable id, from entry.id (CC-CEDICT) else `hanzi|pinyin`
 *     hanzi:         string   front of the card (Chinese, simplified)
 *     simp:          string   alias of hanzi (the review UI reads this)
 *     trad:          string   traditional form, defaults to hanzi
 *     pinyin:        string   accented reading
 *     pinyinNumeric: string   toneless/numeric reading, used for id + search
 *     english:       string[] meanings (the review UI reads this as `defs`)
 *     defs:          string[] alias of english
 *     source:        string   where the card came from: 'dict' | 'lesson' | 'reading' | ...
 *     sourceDetail:  string|null  optional finer origin (theme/lesson id); null when absent
 *     addedAt:       number   epoch ms when first added
 *     reviews:       number   how many times it was answered
 *     ease:          number   SM-2 ease factor, never below 1.3
 *     reps:          number   consecutive successful reviews
 *     lapses:        number   how many times it was failed (answered "again")
 *     interval:      number   days until the next review
 *     due:           number   epoch ms when it is due next
 *     lastReviewed:  number|null
 *     lastRating:    string|null
 *   }
 *
 * addToReview() also accepts `{ id?, hanzi|simp, pinyin, english|defs, source, sourceDetail, ... }`
 * with `hanzi`/`english` as the canonical names — every entry shape works.
 *
 * Two layers, so the algorithm is testable on its own:
 *  - pure: `grade(card, rating, now)` -> next card, `nextDue(card, rating, now)`.
 *  - async deck API: `addToReview`, `getDueCards` (optional source/sourceDetail
 *    filter), `answer`, `countDue`, `countDueBySource`. Persistence goes through src/storage.js ONLY (store 'srs'), never
 *    IndexedDB/localStorage directly. `createDeck(store)` binds the API to any
 *    storage instance — tests pass an in-memory one.
 */
import storage from './storage.js';
import { tonelessKey } from './pinyin.js';

export const DAY_MS = 86_400_000;
export const RATINGS = ['again', 'hard', 'good', 'easy'];
export const DEFAULT_EASE = 2.5;
export const MIN_EASE = 1.3;
/** Rating below this quality is a lapse: the card restarts its interval ladder. */
export const FAIL_BELOW = 3;

/** SM-2 "quality" per rating. */
const QUALITY = { again: 0, hard: 3, good: 4, easy: 5 };
/** Extra interval malus/bonus applied once the card is in the review phase. */
const INTERVAL_MODIFIER = { hard: 0.8, good: 1, easy: 1.3 };

const asArray = (value) =>
  Array.isArray(value) ? value.filter(Boolean) : value === undefined || value === null || value === '' ? [] : [value];

const clampEase = (ease) => Math.max(MIN_EASE, ease);

/** Stable card id: the dataset id when present, else the word + reading. */
export function cardId(entry) {
  if (entry?.id !== undefined && entry?.id !== null && entry.id !== '') return `d${entry.id}`;
  return `x${entry?.hanzi ?? entry?.simp ?? ''}|${entry?.pinyinNumeric ?? entry?.pinyin ?? ''}`;
}

/** Scheduling state for a card first seen at `now`, before any answer. */
export function newCardState(now = Date.now()) {
  return {
    ease: DEFAULT_EASE,
    reps: 0,
    lapses: 0,
    interval: 0,
    due: now,
    lastReviewed: null,
    lastRating: null,
  };
}

/**
 * Pure SM-2 step: card in, `{...card, ...nextState}` out. No I/O.
 *
 *  - again (quality 0): a lapse. reps reset to 0, lapses +1, due in 1 day.
 *  - hard/good/easy (3/4/5): interval ladder 1 -> 6 -> round(previous * ease * modifier).
 *  - ease follows the SM-2 update and never drops below MIN_EASE (1.3).
 *
 * Ratings are restricted to RATINGS; anything else throws.
 */
export function grade(card, rating, now = Date.now()) {
  if (!RATINGS.includes(rating)) {
    throw new RangeError(`srs: unknown rating "${rating}" (expected ${RATINGS.join('/')})`);
  }
  const base = card ?? {};
  const quality = QUALITY[rating];
  const ease = clampEase((base.ease ?? DEFAULT_EASE) + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  let reps = base.reps ?? 0;
  let lapses = base.lapses ?? 0;
  let interval;

  if (quality < FAIL_BELOW) {
    reps = 0;
    lapses += 1;
    interval = 1;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.max(1, Math.round((base.interval ?? 0) * (base.ease ?? DEFAULT_EASE) * INTERVAL_MODIFIER[rating]));
  }

  return { ...base, ease, reps, lapses, interval, due: now + interval * DAY_MS, lastReviewed: now, lastRating: rating };
}

/** When the card would be due next if answered `rating` at `now`. */
export function nextDue(card, rating, now = Date.now()) {
  return grade(card, rating, now).due;
}

/** Card record built from a dictionary/lesson entry (accepts both field namings). */
export function makeCard(entry = {}, now = Date.now()) {
  const hanzi = entry.hanzi ?? entry.simp ?? '';
  const english = asArray(entry.english ?? entry.defs ?? entry.meaning);
  return {
    id: cardId(entry),
    hanzi,
    simp: hanzi,
    trad: entry.trad ?? hanzi,
    pinyin: entry.pinyin ?? '',
    pinyinNumeric: entry.pinyinNumeric ?? '',
    english,
    defs: english,
    /** Spanish translation of `defs`, when the entry had one (review in es). */
    meaningEs: asArray(entry.meaningEs ?? entry.defsEs ?? []),
    source: entry.source ?? 'dict',
    sourceDetail: entry.sourceDetail ?? null,
    addedAt: now,
    reviews: 0,
    ...newCardState(now),
  };
}

/**
 * Deck API bound to a storage instance (defaults to the app's shared storage).
 * `createDeck(store)` is how tests get an isolated in-memory deck.
 */
export function createDeck(store = storage) {
  const getCard = (id) => store.get('srs', id);

  const listCards = async () => (await store.list('srs')).map((row) => row.value).filter(Boolean);

  /**
   * Cards due at or before `now`, soonest first (ties broken by id, stable).
   *
   * Accepts either a plain `now` (legacy call: `getDueCards(Date.now())`) or an
   * options object `{ now?, source?, sourceDetail? }`. When `source` (and/or
   * `sourceDetail`) is given, only matching cards are returned; a card with no
   * source counts as 'unknown'. Omitting the filters keeps the old behavior.
   */
  const getDueCards = async (nowOrOptions = Date.now()) => {
    const opts = typeof nowOrOptions === 'object' && nowOrOptions !== null ? nowOrOptions : { now: nowOrOptions };
    const now = opts.now ?? Date.now();
    return (await listCards())
      .filter((card) => (card.due ?? 0) <= now)
      .filter((card) => opts.source === undefined || (card.source || 'unknown') === opts.source)
      .filter((card) => opts.sourceDetail === undefined || card.sourceDetail === opts.sourceDetail)
      .sort((a, b) => (a.due ?? 0) - (b.due ?? 0) || String(a.id).localeCompare(String(b.id)));
  };

  const countDue = async (now = Date.now()) => (await getDueCards(now)).length;

  /** Due cards grouped by source: `{ [source]: n }`; cards without one -> 'unknown'. */
  const countDueBySource = async (now = Date.now()) => {
    const counts = {};
    for (const card of await getDueCards(now)) {
      const key = card.source || 'unknown';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  };

  /**
   * Adds an entry to the deck. Idempotent by id AND by content: the same word
   * (same hanzi + reading) never enters twice, whatever id a screen passed.
   */
  const addToReview = async (entry = {}, { now = Date.now() } = {}) => {
    const id = cardId(entry);
    const existing = await store.get('srs', id);
    if (existing) return { card: existing, created: false };
    const hz = entry.hanzi ?? entry.simp;
    if (hz) {
      const py = entry.pinyin ?? entry.pinyinNumeric;
      const same = (await listCards()).find(
        (c) => (c.hanzi ?? c.simp) === hz && (!py || !c.pinyin || tonelessKey(c.pinyin) === tonelessKey(py)),
      );
      if (same) return { card: same, created: false };
    }
    const card = makeCard(entry, now);
    await store.set('srs', id, card);
    return { card, created: true };
  };

  /**
   * Adds many entries in one pass: one `listCards()` for the whole batch instead
   * of one per entry, so importing N cards stays linear (docs/REVIEW-2.md I12).
   * Same dedupe rules as `addToReview` (id, then hanzi + toneless reading).
   * Returns `{ results, createdCards }`: one `{card, created}` per entry, and the
   * cards this call actually inserted (so a caller can post-process them).
   */
  const addMany = async (entries = [], { now = Date.now() } = {}) => {
    const byId = new Map();
    const byContent = new Map();
    const byHanzi = new Map();
    const byHanziNoPy = new Map();
    for (const card of await listCards()) {
      byId.set(card.id, card);
      const hz = card.hanzi ?? card.simp;
      if (!hz) continue;
      const py = card.pinyin ?? card.pinyinNumeric;
      if (py) byContent.set(`${hz}\u0000${tonelessKey(py)}`, card);
      else byHanziNoPy.set(hz, card);
      if (!byHanzi.has(hz)) byHanzi.set(hz, card);
    }
    const results = [];
    const createdCards = [];
    for (const entry of entries) {
      const id = cardId(entry);
      const hz = entry.hanzi ?? entry.simp;
      const py = entry.pinyin ?? entry.pinyinNumeric;
      let card = byId.get(id);
      if (!card && hz) {
        card = (py ? byContent.get(`${hz}\u0000${tonelessKey(py)}`) : undefined) ?? byHanziNoPy.get(hz) ?? (py ? undefined : byHanzi.get(hz));
      }
      if (card) {
        results.push({ card, created: false });
        continue;
      }
      const fresh = makeCard(entry, now);
      await store.set('srs', fresh.id, fresh);
      byId.set(fresh.id, fresh);
      if (hz) {
        if (py) byContent.set(`${hz}\u0000${tonelessKey(py)}`, fresh);
        else byHanziNoPy.set(hz, fresh);
        if (!byHanzi.has(hz)) byHanzi.set(hz, fresh);
      }
      results.push({ card: fresh, created: true });
      createdCards.push(fresh);
    }
    return { results, createdCards };
  };

  /** Applies a rating to a stored card, persists and returns the new card. */
  const answer = async (id, rating, now = Date.now()) => {
    const card = await store.get('srs', id);
    if (!card) throw new Error(`srs: unknown card "${id}"`);
    const next = { ...grade(card, rating, now), reviews: (card.reviews ?? 0) + 1 };
    await store.set('srs', id, next);
    return next;
  };

  const removeCard = (id) => store.remove('srs', id);

  const deckStats = async (now = Date.now()) => {
    const cards = await listCards();
    return { total: cards.length, due: cards.filter((card) => (card.due ?? 0) <= now).length };
  };

  return { addToReview, addMany, getDueCards, answer, gradeCard: answer, countDue, countDueBySource, getCard, listCards, removeCard, deckStats };
}

const deck = createDeck();

/**
 * Applies a rating and announces it on `chino:review_done`. Shared by the review
 * and hard-words screens so both advance/notify identically. Throws (and does
 * not notify) if the card cannot be saved, so callers can avoid advancing.
 */
export async function answerAndNotify(id, rating, remaining, now = Date.now()) {
  const updated = await deck.answer(id, rating, now);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('chino:review_done', {
        detail: { id: updated.id, rating, interval: updated.interval, due: updated.due, reviews: updated.reviews, remaining },
      }),
    );
  }
  return updated;
}

export const addToReview = deck.addToReview;
export const getDueCards = deck.getDueCards;
export const answer = deck.answer;
export const countDue = deck.countDue;
export const countDueBySource = deck.countDueBySource;
export const getCard = deck.getCard;
export const listCards = deck.listCards;
export const removeCard = deck.removeCard;
export const deckStats = deck.deckStats;

/* Aliases so the screens that were written against the earlier names keep working. */
export const dueCards = deck.getDueCards;
export const gradeCard = deck.answer;
/** Kept for the pure-step name used before `grade` landed. */
export const schedule = grade;
