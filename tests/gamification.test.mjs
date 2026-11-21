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
  DAILY_CAPS,
} from '../src/gamification.js';
import { localDayKeyFromNumber, weekStartNumber } from '../src/day.js';

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
    daysStudied: [],
    week: {
      current: { reviews: 0, lessons: 0, readings: 0, dialogues: 0, points: 0 },
      previous: { reviews: 0, lessons: 0, readings: 0, dialogues: 0, points: 0 },
    },
    nextLevel: { points: 0, needed: POINTS_PER_LEVEL, pct: 0 },
    streakAtRisk: false,
    freezesUsed: [],
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
    'dialogue_done',
    'draw_used',
    'example_played',
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
    assert.ok(
      rule.event || rule.level || rule.streak != null || rule.points != null,
      `no rule on ${def.id}`,
    );
    if (rule.event) assert.ok(rule.event in EVENTS, `unknown event ${rule.event} on ${def.id}`);
    if (rule.event || rule.level) assert.ok((rule.count ?? 0) > 0, `count required on ${def.id}`);
  }
  const covered = new Set(defs.map((d) => d.rule.event).filter(Boolean));
  for (const event of Object.keys(EVENTS)) {
    if (event === 'example_played') continue; // optional micro-event, no achievement of its own
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

/* ------------------------------------------------ new events / caps --- */

test('dialogue_done earns points and counts toward the streak', async () => {
  const { g } = setup();
  const r = await g.record('dialogue_done');
  assert.equal(r.gained, EVENTS.dialogue_done);
  assert.equal(r.points, EVENTS.dialogue_done);
  assert.equal(r.streak, 1);
});

test('example_played is worth 1 point and capped per natural day', async () => {
  const { g, tick } = setup();
  let total = 0;
  for (let i = 0; i < DAILY_CAPS.example_played + 5; i += 1) {
    total += (await g.record('example_played')).gained;
  }
  assert.equal(total, DAILY_CAPS.example_played, 'only the first N examples pay');
  const stats = await g.getStats();
  assert.equal(stats.points, DAILY_CAPS.example_played);
  assert.equal(stats.todayDone, DAILY_CAPS.example_played + 5, 'still counts as activity');

  tick(DAY);
  assert.equal((await g.record('example_played')).gained, 1, 'the cap resets on a new day');
});

test('unknown events still throw after the new ones are added', async () => {
  const { g } = setup();
  await assert.rejects(() => g.record('dialogue_finished'), /unknown event/);
});

/* ------------------------------------------------ stats for the UI --- */

test('getStats: daysStudied lists recent days with their event counts', async () => {
  const { g, tick } = setup();
  const day0 = dayIndex(at(2026, 1, 5));
  await g.record('review_done');
  await g.record('review_done');
  tick(DAY);
  await g.record('lesson_done');
  const { daysStudied } = await g.getStats();
  assert.deepEqual(daysStudied, [
    { date: localDayKeyFromNumber(day0), count: 2 },
    { date: localDayKeyFromNumber(day0 + 1), count: 1 },
  ]);
});

test('getStats: week breaks the current and previous natural week down', async () => {
  const { g, tick } = setup(); // 2026-01-05 is a Monday
  await g.record('review_done');
  await g.record('review_done');
  await g.record('lesson_done');
  await g.record('dialogue_done');
  const first = await g.getStats();
  assert.deepEqual(first.week.current, { reviews: 2, lessons: 1, readings: 0, dialogues: 1, points: 90 });
  assert.deepEqual(first.week.previous, { reviews: 0, lessons: 0, readings: 0, dialogues: 0, points: 0 });

  tick(7 * DAY); // the following Monday
  const next = await g.getStats();
  assert.deepEqual(next.week.current, { reviews: 0, lessons: 0, readings: 0, dialogues: 0, points: 0 });
  assert.deepEqual(next.week.previous, { reviews: 2, lessons: 1, readings: 0, dialogues: 1, points: 90 });
});

test('getStats: nextLevel tracks progress into the current level', async () => {
  const { g } = setup();
  assert.deepEqual((await g.getStats()).nextLevel, { points: 0, needed: POINTS_PER_LEVEL, pct: 0 });
  await g.record('review_done'); // 10 points
  assert.deepEqual((await g.getStats()).nextLevel, { points: 10, needed: 90, pct: 10 });
  for (let i = 0; i < 9; i += 1) await g.record('review_done'); // 100 -> level 2
  assert.deepEqual((await g.getStats()).nextLevel, { points: 0, needed: POINTS_PER_LEVEL, pct: 0 });
});

test('getStats: streakAtRisk is true when today is empty but yesterday was not', async () => {
  const { g, tick } = setup();
  assert.equal((await g.getStats()).streakAtRisk, false);
  await g.record('review_done');
  assert.equal((await g.getStats()).streakAtRisk, false, 'today already has an event');
  tick(DAY);
  assert.equal((await g.getStats()).streakAtRisk, true);
  await g.record('review_done');
  assert.equal((await g.getStats()).streakAtRisk, false);
});

/* ------------------------------------------------ streak freeze --- */

test('streak freeze: exactly one missing day keeps the streak and is recorded', async () => {
  const { g, tick } = setup();
  const day0 = dayIndex(at(2026, 1, 5));
  await g.record('review_done');
  tick(2 * DAY); // day 1 skipped
  const stats = await g.record('review_done');
  assert.equal(stats.streak, 2, 'the streak survives the gap');
  assert.equal(stats.freezesUsed.length, 1);
  assert.equal(stats.freezesUsed[0].day, localDayKeyFromNumber(day0 + 1));
  assert.equal(stats.freezesUsed[0].week, weekStartNumber(day0 + 1));
});

test('streak freeze: only one per natural week, the next gap breaks it', async () => {
  const { g, tick } = setup();
  await g.record('review_done'); // Mon
  tick(2 * DAY);
  assert.equal((await g.record('review_done')).streak, 2); // Wed, freeze spent
  tick(2 * DAY);
  const stats = await g.record('review_done'); // Fri, second gap the same week
  assert.equal(stats.streak, 1, 'no freeze left this week');
  assert.equal(stats.freezesUsed.length, 1);
});

test('streak: two missing days break it even with a freeze available', async () => {
  const { g, tick } = setup();
  await g.record('review_done');
  tick(3 * DAY); // two days skipped
  const stats = await g.record('review_done');
  assert.equal(stats.streak, 1);
  assert.equal(stats.freezesUsed.length, 0, 'a freeze never covers two days');
});

test('streak: an hour of drift (DST-style) still reads as the next day', async () => {
  const { g, tick } = setup({ start: at(2026, 3, 28, 10) });
  await g.record('review_done');
  tick(23 * 60 * 60 * 1000); // 23 real hours can land on a 25-hour wall-clock day
  assert.equal((await g.record('review_done')).streak, 2);
});

test('streak: crossing midnight extends it and resets the daily counter', async () => {
  const { g, tick } = setup({ start: new Date(2026, 0, 5, 23, 59).getTime() });
  await g.record('review_done');
  tick(2 * 60 * 1000); // 00:01
  const stats = await g.record('review_done');
  assert.equal(stats.streak, 2);
  assert.equal(stats.todayDone, 1);
});

test('streak: a clock that moves backwards does not break it', async () => {
  const { g, tick } = setup();
  await g.record('review_done');
  tick(-DAY); // the device clock jumps a day back
  const back = await g.record('review_done');
  assert.equal(back.streak, 1, 'a backwards clock keeps the streak');
  tick(2 * DAY); // the clock catches up past the last real study day
  assert.equal((await g.record('review_done')).streak, 2);
});

/* ------------------------------------------------ level achievements --- */

test('achievements: a { level } rule counts distinct lessons of that level', async () => {
  const defs = [{ id: 'h1', nameKey: 'k.n', descKey: 'k.d', rule: { level: 'hsk1', count: 2 } }];
  const { g } = setup({ definitions: defs });
  const first = await g.record('lesson_done', { level: 'hsk1', lessonId: 'hsk1-01' });
  assert.deepEqual(first.unlocked, [], 'one of two lessons done');
  const repeat = await g.record('lesson_done', { level: 'hsk1', lessonId: 'hsk1-01' });
  assert.deepEqual(repeat.unlocked, [], 'the same lesson never counts twice');
  const done = await g.record('lesson_done', { level: 'hsk1', lessonId: 'hsk1-02' });
  assert.deepEqual(done.unlocked.map((d) => d.id), ['h1']);
});

test('evaluateAchievements: covers the level rule', () => {
  const defs = [{ id: 'h', rule: { level: 'hsk2', count: 2 } }];
  assert.deepEqual(evaluateAchievements({ levels: { hsk2: 1 } }, defs), []);
  assert.deepEqual(evaluateAchievements({ levels: { hsk2: 2 } }, defs).map((d) => d.id), ['h']);
});

test('achievements.json: the new set is present and level counts match the lesson index', async () => {
  const fetchJson = async (url) => JSON.parse(await readFile(url, 'utf8'));
  const defs = await loadAchievements({
    base: new URL('../public/data/achievements.json', import.meta.url),
    fetchJson,
  });
  const ids = new Set(defs.map((d) => d.id));
  for (const id of [
    'streak_14', 'streak_100', 'points_500', 'points_2000', 'reviews_500',
    'readings_10', 'dialogues_10', 'drawings_50', 'hsk1', 'hsk2', 'hsk3', 'hsk4',
  ]) {
    assert.ok(ids.has(id), `missing achievement ${id}`);
  }
  for (const level of ['hsk1', 'hsk2', 'hsk3', 'hsk4']) {
    const def = defs.find((d) => d.id === level);
    const index = JSON.parse(
      await readFile(new URL(`../public/data/lessons/${level}/index.json`, import.meta.url), 'utf8'),
    );
    assert.equal(def.rule.count, index.lessons.length, `${level} count must match its index`);
  }
});

/* ------------------------------------------------ migration --- */

test('migration: an old state without the new fields keeps working', async () => {
  const storage = createStorage(memoryDriver());
  const day0 = dayIndex(at(2026, 1, 5));
  await storage.set('gamification', 'state', {
    points: 50,
    streak: 2,
    bestStreak: 2,
    lastDay: day0,
    days: { [day0]: 3 },
    events: { review_done: 3 },
    achievements: {},
  });
  const g = createGamification({ storage, now: () => at(2026, 1, 5) });
  const stats = await g.getStats();
  assert.equal(stats.points, 50);
  assert.equal(stats.streak, 2);
  assert.deepEqual(stats.daysStudied, [{ date: localDayKeyFromNumber(day0), count: 3 }]);
  assert.deepEqual(stats.week.current, { reviews: 0, lessons: 0, readings: 0, dialogues: 0, points: 0 });
  const next = await g.record('review_done');
  assert.equal(next.points, 60);
  assert.equal(next.week.current.reviews, 1);
});
