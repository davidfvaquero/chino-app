/**
 * achievements.test.mjs — pure presentation logic of the achievements screen
 * (#/extras/achievements). No DOM: counter and unlocked/locked state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achievementSummary, achievementView } from '../src/extras/achievements.js';

test('achievementSummary counts unlocked against the total', () => {
  const list = [
    { id: 'a', unlocked: true },
    { id: 'b', unlocked: false },
    { id: 'c', unlocked: true },
  ];
  assert.deepEqual(achievementSummary(list), { unlocked: 2, total: 3 });
  assert.deepEqual(achievementSummary([]), { unlocked: 0, total: 0 });
  assert.deepEqual(achievementSummary(undefined), { unlocked: 0, total: 0 });
});

test('achievementView maps a definition to its presentation state', () => {
  const unlocked = achievementView({ id: 'streak_7', nameKey: 'gamification.ach.streak_7.name', descKey: 'gamification.ach.streak_7.desc', unlocked: true });
  assert.deepEqual(unlocked, {
    id: 'streak_7',
    nameKey: 'gamification.ach.streak_7.name',
    descKey: 'gamification.ach.streak_7.desc',
    unlocked: true,
    className: 'unlocked',
  });

  const locked = achievementView({ id: 'reviews_500', nameKey: 'n', descKey: 'd', unlocked: false });
  assert.equal(locked.className, 'locked');
  assert.equal(locked.unlocked, false);

  // A bare definition is treated as locked (never enabled by accident).
  assert.equal(achievementView().className, 'locked');
  assert.equal(achievementView({ id: 'x' }).unlocked, false);
});
