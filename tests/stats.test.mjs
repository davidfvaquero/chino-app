/**
 * stats.test.mjs — src/stats.js with an injected clock, visibility and storage.
 * Run: node --test tests/stats.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDriver, createStorage } from '../src/storage.js';
import { createDeck } from '../src/srs.js';
import {
  attach,
  flush,
  getDay,
  getRange,
  getSummary,
  _resetForTest,
  STORE,
  KEY_PREFIX,
  IDLE_THRESHOLD_MS,
  KNOWN_INTERVAL_DAYS,
} from '../src/stats.js';

const MIN = 60_000;
const BASE = new Date(2026, 0, 15, 10, 0, 0).getTime(); // fixed local instant

const dayStr = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const at = (day, hour = 10) => new Date(2026, 0, day, hour, 0, 0).getTime();

/** Fake window/document + in-memory storage + injectable clock. */
function makeEnv() {
  const store = createStorage(memoryDriver());
  let clock = BASE;
  let visibility = 'visible';

  const target = () => {
    const listeners = new Map();
    return {
      listeners,
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn);
      },
      dispatchEvent(event) {
        for (const fn of listeners.get(event.type) ?? []) fn(event);
        return true;
      },
    };
  };
  const win = target();
  const doc = target();
  Object.defineProperty(doc, 'visibilityState', { get: () => visibility });
  globalThis.window = win;
  globalThis.document = doc;

  return {
    store,
    now: () => clock,
    setClock: (t) => {
      clock = t;
    },
    advance: (ms) => {
      clock += ms;
    },
    /** Flip visibility and fire the event, like a real tab switch. */
    setVisibility(state) {
      visibility = state;
      doc.dispatchEvent({ type: 'visibilitychange' });
    },
    fire: (type) => win.dispatchEvent({ type }),
    day: (ts) => dayStr(ts ?? clock),
  };
}

let env;
beforeEach(() => {
  env = makeEnv();
  _resetForTest();
});
afterEach(() => {
  _resetForTest();
});

describe('stats.js — activity counters', () => {
  it('attach returns detach + flush; a second attach is a no-op', () => {
    const { detach, flush: f } = attach({ now: env.now, storage: env.store });
    assert.equal(typeof detach, 'function');
    assert.equal(typeof f, 'function');
    const second = attach({ now: env.now, storage: env.store });
    assert.equal(typeof second.detach, 'function');
    second.detach(); // must not throw
    detach();
  });

  it('counts one field per event type on the current day', async () => {
    attach({ now: env.now, storage: env.store });
    env.fire('chino:review_done');
    env.fire('chino:review_done');
    env.fire('chino:lesson_done');
    env.fire('chino:reading_done');
    env.fire('chino:stroke_done');
    env.fire('chino:draw_used'); // activity only: no counter
    env.fire('chino:speak_done');
    await flush();

    const day = await getDay(env.day());
    assert.deepEqual(day, { reviews: 2, lessons: 1, readings: 1, strokes: 1, minutes: 0 });
  });

  it('groups by calendar day across midnight', async () => {
    attach({ now: env.now, storage: env.store });

    env.setClock(at(15));
    env.fire('chino:review_done');
    env.fire('chino:lesson_done');
    await flush();

    env.setClock(at(16, 8)); // next day, morning
    env.fire('chino:review_done');
    env.fire('chino:stroke_done');
    await flush();

    env.setClock(at(17, 23)); // third day, late
    env.fire('chino:lesson_done');
    await flush();

    assert.deepEqual(await getDay('2026-01-15'), { reviews: 1, lessons: 1, readings: 0, strokes: 0, minutes: 0 });
    assert.deepEqual(await getDay('2026-01-16'), { reviews: 1, lessons: 0, readings: 0, strokes: 1, minutes: 0 });
    assert.deepEqual(await getDay('2026-01-17'), { reviews: 0, lessons: 1, readings: 0, strokes: 0, minutes: 0 });
  });

  it('adds to a day that already has a record (earlier session)', async () => {
    await env.store.set(STORE, `${KEY_PREFIX}2026-01-15`, { reviews: 4, lessons: 1, readings: 0, strokes: 0, minutes: 7 });
    attach({ now: env.now, storage: env.store });
    env.fire('chino:review_done');
    await flush();

    const day = await getDay('2026-01-15');
    assert.equal(day.reviews, 5);
    assert.equal(day.lessons, 1);
    assert.equal(day.minutes, 7);
  });

  it('detach stops counting', async () => {
    const { detach } = attach({ now: env.now, storage: env.store });
    detach();
    env.fire('chino:review_done');
    await flush();
    assert.equal((await getDay(env.day())).reviews, 0);
  });
});

describe('stats.js — active time', () => {
  it('counts visible time and short hidden pauses, discards long pauses', async () => {
    attach({ now: env.now, storage: env.store });

    env.advance(1 * MIN); // 1 min visible
    env.setVisibility('hidden'); // +1
    env.advance(2 * MIN); // 2 min hidden (short: counts)
    env.setVisibility('visible'); // +2
    env.advance(1 * MIN); // 1 min visible
    env.setVisibility('hidden'); // +1
    env.advance(6 * MIN); // 6 min hidden (long: dropped)
    env.setVisibility('visible');
    env.advance(1 * MIN); // 1 min visible
    env.setVisibility('hidden'); // +1
    await flush();

    assert.equal((await getDay(env.day())).minutes, 5);
  });

  it('drops a pause of exactly IDLE_THRESHOLD_MS and keeps a shorter one', async () => {
    attach({ now: env.now, storage: env.store });
    env.setVisibility('hidden');
    env.advance(IDLE_THRESHOLD_MS);
    env.setVisibility('visible'); // exactly at the limit: dropped
    env.advance(1 * MIN);
    env.setVisibility('hidden'); // +1 min
    env.advance(IDLE_THRESHOLD_MS - 1 * MIN);
    env.setVisibility('visible'); // just under the limit: counted (+4)
    env.advance(1 * MIN);
    env.setVisibility('hidden'); // +1 min
    await flush();

    assert.equal((await getDay(env.day())).minutes, 6);
  });

  it('does not count time while the tab stays hidden', async () => {
    attach({ now: env.now, storage: env.store });
    env.setVisibility('hidden');
    env.advance(1 * MIN);
    env.setVisibility('visible'); // 1 min hidden pause -> counts
    env.advance(1 * MIN);
    env.setVisibility('hidden');
    env.advance(30 * MIN); // hidden the whole time
    env.setVisibility('visible'); // long pause -> dropped
    env.advance(2 * MIN);
    env.setVisibility('hidden');
    await flush();

    assert.equal((await getDay(env.day())).minutes, 4);
  });

  it('starts the session hidden without counting the gap', async () => {
    env.setVisibility('hidden'); // before attach
    attach({ now: env.now, storage: env.store });
    env.advance(10 * MIN);
    env.setVisibility('visible');
    env.advance(2 * MIN);
    env.setVisibility('hidden');
    await flush();

    assert.equal((await getDay(env.day())).minutes, 2);
  });
});

describe('stats.js — getRange', () => {
  it('returns the last N days, today first, zeros for empty days', async () => {
    attach({ now: env.now, storage: env.store });
    env.fire('chino:review_done');
    await flush();

    const range = await getRange(3);
    assert.equal(range.length, 3);
    assert.deepEqual(range.map((d) => d.date), ['2026-01-15', '2026-01-14', '2026-01-13']);
    assert.equal(range[0].reviews, 1);
    assert.equal(range[1].reviews, 0);
    assert.equal(range[1].minutes, 0);
  });

  it('walks back over a month boundary', async () => {
    env.setClock(new Date(2026, 2, 2, 9, 0, 0).getTime()); // March 2nd
    attach({ now: env.now, storage: env.store });
    const range = await getRange(3);
    assert.deepEqual(range.map((d) => d.date), ['2026-03-02', '2026-03-01', '2026-02-28']);
  });
});

describe('stats.js — getSummary', () => {
  /** Seed the deck: `known` cards at 30 days, `learning` cards at 5 days. */
  async function seedDeck(known, learning) {
    const deck = createDeck(env.store);
    for (let i = 0; i < known + learning; i += 1) {
      const { card } = await deck.addToReview({ hanzi: `字${i}`, pinyin: 'zi4', english: ['char'], source: 'test' });
      await env.store.set('srs', card.id, { ...card, interval: i < known ? 30 : 5 });
    }
  }

  it('counts known / learning / total, minutes and days studied', async () => {
    await seedDeck(3, 2);
    await env.store.set(STORE, `${KEY_PREFIX}2026-01-15`, { reviews: 5, lessons: 1, readings: 0, strokes: 3, minutes: 15 });
    await env.store.set(STORE, `${KEY_PREFIX}2026-01-14`, { reviews: 0, lessons: 0, readings: 2, strokes: 0, minutes: 10 });
    await env.store.set(STORE, `${KEY_PREFIX}2026-01-13`, { reviews: 0, lessons: 0, readings: 0, strokes: 0, minutes: 0 });
    attach({ now: env.now, storage: env.store });

    const summary = await getSummary();
    assert.deepEqual(summary, { known: 3, learning: 2, total: 5, minutesTotal: 25, daysStudied: 2 });
  });

  it('counts a card exactly at KNOWN_INTERVAL_DAYS as known', async () => {
    const deck = createDeck(env.store);
    const { card } = await deck.addToReview({ hanzi: '知', pinyin: 'zhi1', english: ['know'] });
    await env.store.set('srs', card.id, { ...card, interval: KNOWN_INTERVAL_DAYS });
    attach({ now: env.now, storage: env.store });

    const summary = await getSummary();
    assert.equal(summary.known, 1);
    assert.equal(summary.learning, 0);
  });

  it('is all zeros with no data', async () => {
    attach({ now: env.now, storage: env.store });
    assert.deepEqual(await getSummary(), { known: 0, learning: 0, total: 0, minutesTotal: 0, daysStudied: 0 });
  });
});
