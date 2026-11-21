/**
 * progress.test.mjs — pure presentation logic of the progress screen
 * (#/extras/progress). No DOM, no browser: intensities, calendar shape,
 * week comparison, freeze state and plural-key selection.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayIntensity,
  calendarRows,
  weekComparison,
  freezeStatus,
  pluralKey,
  WEEKS,
} from '../src/extras/progress.js';
import { localDayNumber, localDayKeyFromNumber, weekStartNumber } from '../src/day.js';
import { pluralKey as homePluralKey } from '../src/screens/home.js';

test('dayIntensity buckets a day into 0..4', () => {
  assert.equal(dayIntensity(0), 0);
  assert.equal(dayIntensity(1), 1);
  assert.equal(dayIntensity(2), 2);
  assert.equal(dayIntensity(3), 2);
  assert.equal(dayIntensity(4), 3);
  assert.equal(dayIntensity(6), 3);
  assert.equal(dayIntensity(7), 4);
  assert.equal(dayIntensity(999), 4);
  assert.equal(dayIntensity(-5), 0);
  assert.equal(dayIntensity(undefined), 0);
  assert.equal(dayIntensity('3'), 2);
});

test('calendarRows: 7 weekday rows x 12 weeks, oldest first, today marked', () => {
  const today = localDayNumber(new Date(2026, 10, 21)); // a Saturday
  const start = weekStartNumber(today) - (WEEKS - 1) * 7;
  const daysStudied = [];
  for (let i = 0; i < 30; i += 1) {
    const day = today - i;
    daysStudied.push({ date: localDayKeyFromNumber(day), count: 1 });
  }
  // One day just outside the window must not appear.
  daysStudied.push({ date: localDayKeyFromNumber(start - 10), count: 9 });

  const rows = calendarRows(daysStudied, today);
  assert.equal(rows.length, 7);
  assert.ok(rows.every((week) => week.length === WEEKS));
  const all = rows.flat();
  assert.equal(all.length, WEEKS * 7);
  assert.equal(all[0].day, start);
  assert.equal(all.at(-1).day, weekStartNumber(today) + 6);
  // Weekday-major: row 0 is every Monday, each next cell +7 days.
  assert.ok(rows[0].every((cell) => (cell.day - start) % 7 === 0));
  assert.equal(rows[1][0].day, start + 1);

  const todayCells = all.filter((cell) => cell.today);
  assert.equal(todayCells.length, 1);
  assert.equal(todayCells[0].day, today);
  assert.equal(todayCells[0].count, 1);
  assert.equal(todayCells[0].intensity, 1);
  assert.equal(todayCells[0].future, false);

  const future = all.filter((cell) => cell.future);
  assert.ok(future.every((cell) => cell.day > today && cell.intensity === 0));
  assert.ok(all.filter((cell) => cell.day <= today).every((cell) => cell.future === false));

  // The seeded count for a studied day is reflected; the out-of-window day is dropped.
  const first = all.find((cell) => cell.day === today - 5);
  assert.equal(first.count, 1);
  assert.equal(all.filter((cell) => cell.count === 9).length, 0);
});

test('calendarRows with no data is an empty grid', () => {
  const today = localDayNumber(new Date(2026, 10, 21));
  const rows = calendarRows([], today);
  assert.equal(rows.flat().length, WEEKS * 7);
  assert.ok(rows.flat().every((cell) => cell.count === 0 && cell.intensity === 0));
});

test('weekComparison reports direction and delta on reviews', () => {
  assert.deepEqual(weekComparison({ reviews: 5 }, { reviews: 2 }), { current: 5, previous: 2, delta: 3, direction: 'up' });
  assert.deepEqual(weekComparison({ reviews: 1 }, { reviews: 4 }), { current: 1, previous: 4, delta: -3, direction: 'down' });
  assert.deepEqual(weekComparison({ reviews: 3 }, { reviews: 3 }), { current: 3, previous: 3, delta: 0, direction: 'same' });
  assert.deepEqual(weekComparison(undefined, undefined), { current: 0, previous: 0, delta: 0, direction: 'same' });
});

test('freezeStatus: one per week, used vs available', () => {
  const today = localDayNumber(new Date(2026, 10, 21));
  const week = weekStartNumber(today);
  assert.deepEqual(freezeStatus([], today), { available: true, usedDay: null });
  assert.deepEqual(freezeStatus(undefined, today), { available: true, usedDay: null });
  assert.deepEqual(
    freezeStatus([{ day: '2026-11-18', week }], today),
    { available: false, usedDay: '2026-11-18' },
  );
  // A freeze used a previous week does not count against this week.
  assert.deepEqual(
    freezeStatus([{ day: '2026-11-10', week: week - 7 }], today),
    { available: true, usedDay: null },
  );
});

test('pluralKey picks singular only for exactly one', () => {
  assert.equal(pluralKey('progress.x', 1), 'progress.x.one');
  assert.equal(pluralKey('progress.x', 0), 'progress.x.other');
  assert.equal(pluralKey('progress.x', 2), 'progress.x.other');
  assert.equal(pluralKey('progress.x', '1'), 'progress.x.one');
  assert.equal(homePluralKey('home.streak.days', 1), 'home.streak.days.one');
  assert.equal(homePluralKey('home.streak.days', 5), 'home.streak.days.other');
});
