/**
 * sync-merge.test.mjs — pure merge rules (src/sync/merge.js). No I/O.
 * Run: node --test tests/sync-merge.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRecord, mergeAll, recordKey, SYNC_STORES } from '../src/sync/merge.js';

const blob = (over = {}) => ({ store: 'settings', key: 'theme', value: 'light', updated_at: 100, deleted: false, ...over });
const card = (reviews, updated_at, key = 'd1') => ({
  store: 'srs',
  key,
  value: { id: key, reviews },
  updated_at,
  deleted: false,
});

test('SYNC_STORES lists exactly the four synced stores (meta stays local)', () => {
  assert.deepEqual(SYNC_STORES, ['srs', 'progress', 'gamification', 'settings']);
});

test('recordKey identifies a blob by store + key', () => {
  assert.equal(recordKey({ store: 'srs', key: 'd1' }), recordKey({ store: 'srs', key: 'd1' }));
  assert.notEqual(recordKey({ store: 'srs', key: 'd1' }), recordKey({ store: 'progress', key: 'd1' }));
});

test('a missing side wins to the other one', () => {
  assert.deepEqual(mergeRecord(null, blob()), blob());
  assert.deepEqual(mergeRecord(blob(), null), blob());
  assert.equal(mergeRecord(undefined, undefined), undefined);
});

test('two devices: newest updated_at wins for a plain value', () => {
  const local = blob({ value: 'light', updated_at: 1000 });
  const remote = blob({ value: 'dark', updated_at: 2000 });
  assert.equal(mergeRecord(local, remote).value, 'dark');
  assert.equal(mergeRecord(remote, local).value, 'dark', 'symmetric on different timestamps');
});

test('an exact tie keeps the local side (no pointless rewrite)', () => {
  const local = blob({ value: 'light', updated_at: 1000 });
  const remote = blob({ value: 'dark', updated_at: 1000 });
  assert.equal(mergeRecord(local, remote).value, 'light');
});

test('review cards keep the copy with more reviews, even against a future clock', () => {
  const local = card(9, 1000); // studied a lot, older stamp
  const remote = card(2, 9_999_999); // device with a badly skewed (future) clock
  assert.equal(mergeRecord(local, remote).value.reviews, 9);
  assert.equal(mergeRecord(remote, local).value.reviews, 9, 'the rule is not order-dependent');
});

test('review cards fall back to updated_at when reviews are equal', () => {
  assert.equal(mergeRecord(card(4, 1000), card(4, 2000)).updated_at, 2000);
  assert.equal(mergeRecord(card(4, 2000), card(4, 1000)).updated_at, 2000);
});

test('a deletion is a write: the newest side wins', () => {
  const live = blob({ updated_at: 1000 });
  const tombstone = blob({ value: null, deleted: true, updated_at: 2000 });
  assert.equal(mergeRecord(live, tombstone).deleted, true, 'newer tombstone deletes');
  assert.equal(mergeRecord(tombstone, live).deleted, true);
  // …and a later edit resurrects a key deleted earlier.
  const newerLive = blob({ updated_at: 3000 });
  assert.equal(mergeRecord(newerLive, tombstone).deleted, false);
  assert.equal(mergeRecord(tombstone, newerLive).deleted, false);
});

test('on an exact tie a tombstone beats a live value (never resurrect for free)', () => {
  const live = blob({ updated_at: 1000 });
  const tombstone = blob({ value: null, deleted: true, updated_at: 1000 });
  assert.equal(mergeRecord(live, tombstone).deleted, true);
  assert.equal(mergeRecord(tombstone, live).deleted, true);
});

test('a clock skewed into the past loses to a normal record', () => {
  const slow = blob({ value: 'a', updated_at: 0 }); // never stamped locally
  const normal = blob({ value: 'b', updated_at: 5 });
  assert.equal(mergeRecord(slow, normal).value, 'b');
});

test('mergeAll unions both sides and resolves shared keys', () => {
  const local = [blob({ key: 'theme', value: 'light', updated_at: 1000 }), card(3, 1000, 'd2')];
  const remote = [blob({ key: 'theme', value: 'dark', updated_at: 2000 }), blob({ key: 'fontScale', value: 1.3, updated_at: 500 })];
  const merged = mergeAll(local, remote);
  const byKey = new Map(merged.map((r) => [recordKey(r), r]));

  assert.equal(merged.length, 3, 'union: two local + one remote-only');
  assert.equal(byKey.get(recordKey(blob({ key: 'theme' }))).value, 'dark');
  assert.equal(byKey.get(recordKey({ store: 'srs', key: 'd2' })).value.reviews, 3, 'local-only record kept');
  assert.equal(byKey.get(recordKey(blob({ key: 'fontScale' }))).value, 1.3, 'remote-only record added');
});

test('mergeAll is empty-safe and never mutates its inputs', () => {
  assert.deepEqual(mergeAll(), []);
  const local = [blob()];
  const remote = [blob({ updated_at: 999 })];
  mergeAll(local, remote);
  assert.equal(local[0].updated_at, 100);
  assert.equal(remote[0].updated_at, 999);
});

test('two devices, many keys: a realistic merge picks the right winner per key', () => {
  const local = [card(7, 5000, 'd1'), card(1, 6000, 'd2'), blob({ key: 'dailyGoal', value: 20, updated_at: 4000 })];
  const remote = [card(2, 9000, 'd1'), card(5, 3000, 'd2'), blob({ key: 'dailyGoal', value: 50, updated_at: 1000 })];
  const byKey = new Map(mergeAll(local, remote).map((r) => [recordKey(r), r]));
  assert.equal(byKey.get(recordKey({ store: 'srs', key: 'd1' })).value.reviews, 7, 'more reviews wins despite older stamp');
  assert.equal(byKey.get(recordKey({ store: 'srs', key: 'd2' })).value.reviews, 5);
  assert.equal(byKey.get(recordKey(blob({ key: 'dailyGoal' }))).value, 20, 'newer local setting kept');
});
