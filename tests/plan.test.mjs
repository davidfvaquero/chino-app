/**
 * plan.test.mjs — guided 30-day plan (src/learn/plan.js).
 *
 * Browser-free: pure day/status math with an injected clock, task routing,
 * plan validation, and a guard that every id in public/data/plan/hsk1-30d.json
 * points at an existing lesson / reading / theme / grammar pattern, with an
 * i18n titleKey present in both the en and es shards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dayIndex,
  lessonLevel,
  taskRoute,
  validatePlan,
  currentDay,
  firstUnfinished,
  dayStatus,
  computeDays,
  isBehind,
  getProgress,
  startPlan,
  resetPlan,
  markDayDone,
  catchUp,
} from '../src/learn/plan.js';

const read = (rel) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
const plan = read('public/data/plan/hsk1-30d.json');

/* ----------------------------------------------------------------- clock --- */

test('dayIndex counts whole local days and is stable within a local day', () => {
  assert.equal(dayIndex(new Date(2026, 0, 5, 0, 1)), dayIndex(new Date(2026, 0, 5, 23, 59)));
  assert.equal(dayIndex(new Date(2026, 0, 6)) - dayIndex(new Date(2026, 0, 5)), 1);
});

test('currentDay: 1-based from startDay, clamped to the plan length', () => {
  const p = { startDay: dayIndex(new Date(2026, 0, 1)) };
  assert.equal(currentDay(plan, p, new Date(2026, 0, 1, 9)), 1);
  assert.equal(currentDay(plan, p, new Date(2026, 0, 3)), 3);
  assert.equal(currentDay(plan, p, new Date(2026, 5, 1)), 30, 'clamped to the last day');
  assert.equal(currentDay(plan, p, new Date(2025, 11, 1)), 1, 'clamped before the start');
  assert.equal(currentDay(plan, null, new Date(2026, 0, 9)), 1, 'unstarted -> day 1');
});

/* --------------------------------------------------------------- status ---- */

test('dayStatus and computeDays mark done / today / pending', () => {
  assert.equal(dayStatus(1, 3, []), 'pending');
  assert.equal(dayStatus(3, 3, []), 'today');
  assert.equal(dayStatus(1, 3, [1]), 'done');
  assert.equal(dayStatus(3, 3, [3]), 'done', 'completed beats today');

  const progress = { startDay: dayIndex(new Date(2026, 0, 1)), completed: [1, 2] };
  const days = computeDays(plan, progress, new Date(2026, 0, 3));
  assert.equal(days.length, 30);
  assert.deepEqual(days.slice(0, 3).map((d) => d.status), ['done', 'done', 'today']);
  assert.equal(days[3].status, 'pending');
  assert.equal(days[6].rest, true, 'day 7 is a rest day');
});

test('firstUnfinished and isBehind detect a skipped schedule', () => {
  const progress = { startDay: dayIndex(new Date(2026, 0, 1)), completed: [1, 2] };
  assert.equal(firstUnfinished(plan, progress), 3);
  assert.equal(isBehind(plan, progress, new Date(2026, 0, 3)), false, 'on schedule');
  assert.equal(isBehind(plan, progress, new Date(2026, 0, 5)), true, 'two days skipped');
  const allDone = { startDay: 0, completed: plan.days.map((d) => d.day) };
  assert.equal(firstUnfinished(plan, allDone), null);
  assert.equal(isBehind(plan, allDone, new Date(2026, 5, 1)), false);
});

/* --------------------------------------------------------------- routing --- */

test('taskRoute opens the right screen for each task type', () => {
  assert.equal(taskRoute({ type: 'lesson', id: 'hsk1-03' }), 'learn/lessons/hsk1-03');
  assert.equal(taskRoute({ type: 'lesson', id: 'practical-02' }), 'learn/lessons/practical-02?level=practical');
  assert.equal(taskRoute({ type: 'reading', id: 'reading-04' }), 'read/reading-04');
  assert.equal(taskRoute({ type: 'theme', id: 'theme-05' }), 'learn/themes/theme-05');
  assert.equal(taskRoute({ type: 'grammar', id: 'shi' }), 'learn/grammar/shi');
  assert.equal(taskRoute({ type: 'review', cards: 20 }), 'review');
  assert.equal(lessonLevel('practical-01'), 'practical');
  assert.equal(lessonLevel('hsk1-01'), 'hsk1');
});

/* ------------------------------------------------------------ validation --- */

test('validatePlan accepts the shipped plan and rejects broken ones', () => {
  assert.deepEqual(validatePlan(plan), []);
  assert.deepEqual(validatePlan({ days: [{ day: 1, titleKey: 'plan.days.1', tasks: [{ type: 'review' }] }] }), []);
  assert.ok(validatePlan({}).length, 'no days');
  assert.ok(validatePlan({ days: [{ day: 1, titleKey: 'x', tasks: [] }] }).length, 'empty tasks');
  assert.ok(
    validatePlan({ days: [{ day: 1, titleKey: 'x', tasks: [{ type: 'lesson' }] }] }).length,
    'lesson without id',
  );
  assert.ok(
    validatePlan({ days: [{ day: 1, titleKey: 'x', tasks: [{ type: 'review' }] }, { day: 1, titleKey: 'y', tasks: [{ type: 'review' }] }] }).length,
    'duplicate day',
  );
});

/* ------------------------------------------------------- ids really exist -- */

test('every id in the plan points at an existing lesson / reading / theme / grammar pattern', () => {
  const lessonIds = new Set([
    ...read('public/data/lessons/hsk1/index.json').lessons.map((l) => l.id),
    ...read('public/data/lessons/practical/index.json').lessons.map((l) => l.id),
  ]);
  const readingIds = new Set(read('public/data/readings/hsk1/index.json').map((r) => r.id));
  const themeIds = new Set(read('public/data/themes/index.json').map((x) => x.id));
  const grammarIds = new Set(read('public/data/grammar/index.json').patterns.map((p) => p.id));
  const pools = { lesson: lessonIds, reading: readingIds, theme: themeIds, grammar: grammarIds };

  for (const day of plan.days) {
    for (const task of day.tasks) {
      if (task.type === 'review') continue;
      assert.ok(pools[task.type], `unknown task type ${task.type}`);
      assert.ok(pools[task.type].has(task.id), `day ${day.day}: ${task.type} "${task.id}" does not exist`);
    }
  }
});

test('every day titleKey exists in both the en and es shards', () => {
  const leaf = (obj, parents = []) => {
    const out = new Set();
    for (const [k, v] of Object.entries(obj)) {
      const path = [...parents, k];
      if (v && typeof v === 'object') for (const p of leaf(v, path)) out.add(p);
      else out.add(path.join('.'));
    }
    return out;
  };
  const en = leaf(read('src/locales/en.d/plan.json'));
  const es = leaf(read('src/locales/es.d/plan.json'));
  for (const day of plan.days) {
    assert.ok(en.has(day.titleKey), `en shard missing ${day.titleKey}`);
    assert.ok(es.has(day.titleKey), `es shard missing ${day.titleKey}`);
  }
  assert.deepEqual([...en].sort(), [...es].sort(), 'en/es shards have the same keys');
});

/* -------------------------------------------------------------- progress --- */

function memoryStore() {
  const data = new Map();
  return {
    async get(store, key) {
      return data.get(`${store}:${key}`);
    },
    async set(store, key, value) {
      data.set(`${store}:${key}`, structuredClone(value));
      return value;
    },
    async delete(store, key) {
      return data.delete(`${store}:${key}`);
    },
  };
}

test('start / markDone / catchUp / reset drive the stored progress', async () => {
  const store = memoryStore();
  assert.equal(await getProgress({ store }), null);

  const start = new Date(2026, 0, 1);
  await startPlan({ store, now: start });
  assert.deepEqual(await getProgress({ store }), { startDay: dayIndex(start), completed: [] });

  await markDayDone(1, { store });
  await markDayDone(1, { store }); // idempotent
  await markDayDone(2, { store });
  assert.deepEqual((await getProgress({ store })).completed, [1, 2]);

  // Two days skipped: catch up so today (Jan 5) is day 3.
  const today = new Date(2026, 0, 5);
  assert.equal(isBehind(plan, await getProgress({ store }), today), true);
  await catchUp({ store, now: today, plan });
  const after = await getProgress({ store });
  assert.equal(currentDay(plan, after, today), 3, 'catch up makes today the first unfinished day');

  await resetPlan({ store });
  assert.equal(await getProgress({ store }), null);
});
