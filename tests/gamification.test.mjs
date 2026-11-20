import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStorage, memoryDriver } from '../src/storage.js';
import {
  POINTS_PER_LEVEL,
  createGamification,
  dayIndex,
  evaluateAchievements,
  levelFor,
  loadAchievements,
  EVENTS,
} from '../src/gamification.js';

const DAY = 86_400_000;
/** Local 10:00 on the given date, so adding whole days keeps the same local hour. */
const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h).getTime();

/** Fresh instance over an isolated memory store with a controllable clock. */
function setup({ start = at(2026, 1, 5), definitions = [] } = {}) {
  const storage = createStorage(memoryDriver());
  let clock = start;
  return {
    storage,
    g: createGamification({ storage, now: () => clock, definitions }),
    tick: (ms) => {
      clock += ms;
    },
  };
}

test('dayIndex: same local day is equal, the next one is +1', () => {
  assert.equal(dayIndex(at(2026, 1, 5, 0)), dayIndex(at(2026, 1, 5, 23, 59)));
  assert.equal(dayIndex(at(2026, 1, 6, 0)) - dayIndex(at(2026, 1, 5, 23, 59)), 1);
});

test('getStats: a fresh state is all zeroes', async () => {
  const { g } = setup();
  assert.deepEqual(await g.getStats(), {
    streak: 0,
    bestStreak: 0,
    points: 0,
    level: 1,
    todayDone: 0,
    achievements: [],
  });
});

test('streak: two events on the same day count once', async () => {
  const { g } = setup();
  await g.record('review_done');
  const stats = await g.record('review_done');
  assert.equal(stats.streak, 1);
  assert.equal(stats.bestStreak, 1);
  assert.equal(stats.todayDone, 2);
});

test('streak: the next natural day extends it', async () => {
  const { g, tick } = setup();
  await g.record('review_done');
  tick(DAY);
  const stats = await g.record('lesson_done');
  assert.equal(stats.streak, 2);
  assert.equal(stats.bestStreak, 2);
  assert.equal(stats.todayDone, 1); // counter restarts each day
});

test('streak: a skipped day resets it but keeps bestStreak', async () => {
  const { g, tick } = setup();
  await g.record('review_done'); // day 0
  tick(DAY);
  await g.record('review_done'); // day 1
  tick(DAY);
  await g.record('review_done'); // day 2 -> streak 3
  assert.equal((await g.getStats()).streak, 3);
  tick(3 * DAY); // two days skipped
  const stats = await g.record('review_done');
  assert.equal(stats.streak, 1);
  assert.equal(stats.bestStreak, 3);
});

test('points: every event adds its value from the table', async () => {
  const { g } = setup();
  const a = await g.record('review_done');
  const b = await g.record('lesson_done');
  const c = await g.record('stroke_done');
  assert.equal(a.gained, EVENTS.review_done);
  assert.equal(a.points, EVENTS.review_done);
  assert.equal(b.points, EVENTS.review_done + EVENTS.lesson_done);
  assert.equal(c.points, EVENTS.review_done + EVENTS.lesson_done + EVENTS.stroke_done);
});

test('points: every documented event has a table entry', () => {
  assert.deepEqual(Object.keys(EVENTS).sort(), [
    'draw_used',
    'lesson_done',
    'reading_done',
    'review_done',
    'speak_done',
    'stroke_done',
  ]);
});

test('record rejects an unknown event and leaves the state untouched', async () => {
  const { g } = setup();
  await assert.rejects(() => g.record('nope'), /unknown event/);
  assert.equal((await g.getStats()).points, 0);
});

test('level: one level per POINTS_PER_LEVEL, starting at 1', async () => {
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(POINTS_PER_LEVEL - 1), 1);
  assert.equal(levelFor(POINTS_PER_LEVEL), 2);
  assert.equal(levelFor(2 * POINTS_PER_LEVEL + 50), 3);
  const { g } = setup();
  await g.record('lesson_done');
  await g.record('lesson_done');
  const stats = await g.getStats();
  assert.equal(stats.points, 2 * EVENTS.lesson_done);
  assert.equal(stats.points, POINTS_PER_LEVEL);
  assert.equal(stats.level, levelFor(POINTS_PER_LEVEL)); // level 2 at 100 points
});

test('evaluateAchievements: pure, covers the three rule kinds', () => {
  const defs = [
    { id: 'ev', rule: { event: 'review_done', count: 2 } },
    { id: 'st', rule: { streak: 3 } },
    { id: 'pt', rule: { points: 100 } },
    { id: 'never', rule: { event: 'speak_done', count: 5 } },
  ];
  const stats = { points: 120, streak: 3, events: { review_done: 2 } };
  assert.deepEqual(
    evaluateAchievements(stats, defs).map((d) => d.id),
    ['ev', 'st', 'pt'],
  );
  assert.deepEqual(evaluateAchievements({}, defs), []);
  assert.deepEqual(evaluateAchievements(stats, undefined), []);
  // a bare { event } rule means "at least once"
  assert.deepEqual(
    evaluateAchievements({ events: { review_done: 1 } }, [{ id: 'x', rule: { event: 'review_done' } }]).map(
      (d) => d.id,
    ),
    ['x'],
  );
});

test('achievements unlock exactly once and remember when', async () => {
  const defs = [{ id: 'first', nameKey: 'k.n', descKey: 'k.d', rule: { event: 'review_done', count: 1 } }];
  const { g } = setup({ definitions: defs });
  const first = await g.record('review_done');
  assert.deepEqual(first.unlocked.map((d) => d.id), ['first']);
  assert.equal(first.achievements[0].unlocked, true);
  assert.equal(typeof first.achievements[0].unlockedAt, 'number');

  const second = await g.record('review_done');
  assert.deepEqual(second.unlocked, [], 'already unlocked -> not reported again');

  const stats = await g.getStats();
  assert.equal(stats.achievements[0].unlocked, true);
  assert.equal(stats.achievements[0].unlockedAt, first.achievements[0].unlockedAt);
});

test('definitions can be an async loader and are resolved once', async () => {
  let calls = 0;
  const storage = createStorage(memoryDriver());
  const g = createGamification({
    storage,
    now: () => at(2026, 1, 5),
    definitions: async () => {
      calls += 1;
      return [{ id: 'first', nameKey: 'k.n', descKey: 'k.d', rule: { event: 'review_done', count: 1 } }];
    },
  });
  const stats = await g.record('review_done');
  await g.getStats();
  assert.deepEqual(stats.unlocked.map((d) => d.id), ['first']);
  assert.equal(calls, 1);
});

test('state persists in the gamification store under a single key', async () => {
  const storage = createStorage(memoryDriver());
  const clock = at(2026, 3, 1);
  await createGamification({ storage, now: () => clock }).record('reading_done');
  const stats = await createGamification({ storage, now: () => clock }).getStats();
  assert.equal(stats.points, EVENTS.reading_done);
  assert.equal(stats.todayDone, 1);
  assert.ok(await storage.get('gamification', 'state'));
  assert.equal((await storage.list('gamification')).length, 1);
});

test('points: three simultaneous record calls add up to the exact sum', async () => {
  const { g } = setup();
  const results = await Promise.all([
    g.record('review_done'),
    g.record('lesson_done'),
    g.record('stroke_done'),
  ]);
  const total = EVENTS.review_done + EVENTS.lesson_done + EVENTS.stroke_done;
  assert.deepEqual(
    results.map((r) => r.gained).sort((a, b) => a - b),
    [EVENTS.review_done, EVENTS.lesson_done, EVENTS.stroke_done].sort((a, b) => a - b),
    'every call reports its own gain',
  );
  assert.equal((await g.getStats()).points, total, 'no point is lost to a concurrent write');
});

test('public/data/achievements.json is well formed and covers every event', async () => {
  const fetchJson = async (url) => JSON.parse(await readFile(url, 'utf8'));
  const base = new URL('../public/data/achievements.json', import.meta.url);
  const defs = await loadAchievements({ base, fetchJson });

  assert.ok(defs.length >= 8, 'expected a decent starter set');
  const ids = new Set();
  for (const def of defs) {
    assert.match(def.id, /^[a-z0-9_]+$/);
    assert.ok(!ids.has(def.id), `duplicate id ${def.id}`);
    ids.add(def.id);
    assert.equal(def.nameKey, `gamification.ach.${def.id}.name`);
    assert.equal(def.descKey, `gamification.ach.${def.id}.desc`);
    const rule = def.rule ?? {};
    assert.ok(rule.event || rule.streak != null || rule.points != null, `no rule on ${def.id}`);
    if (rule.event) assert.ok(rule.event in EVENTS, `unknown event ${rule.event} on ${def.id}`);
    if (rule.event) assert.ok((rule.count ?? 0) > 0, `count required on ${def.id}`);
  }
  const covered = new Set(defs.map((d) => d.rule.event).filter(Boolean));
  for (const event of Object.keys(EVENTS)) {
    assert.ok(covered.has(event), `no achievement for event ${event}`);
  }
});

test('loadAchievements also accepts a { achievements: [] } wrapper', async () => {
  const defs = await loadAchievements({
    base: new URL('file:///dev/null'),
    fetchJson: async () => ({ achievements: [{ id: 'a' }] }),
  });
  assert.deepEqual(defs, [{ id: 'a' }]);
});
