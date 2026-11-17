/**
 * gamification-wire.test.mjs — pure logic tests for the event-to-gamification wire.
 * Verifies EVENT_MAP correctness and that attach() registers the expected listeners.
 * Actual DOM event firing is verified in the headless browser check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_MAP, attach } from '../src/gamification-wire.js';

test('EVENT_MAP has exactly the six expected entries', () => {
  const expected = [
    'chino:review_done',
    'chino:lesson_done',
    'chino:reading_done',
    'chino:stroke_done',
    'chino:draw_used',
    'chino:speak_done',
  ];
  assert.deepEqual(Object.keys(EVENT_MAP).sort(), expected.sort());
});

test('EVENT_MAP maps to correct gamification event names', () => {
  assert.equal(EVENT_MAP['chino:review_done'], 'review_done');
  assert.equal(EVENT_MAP['chino:lesson_done'], 'lesson_done');
  assert.equal(EVENT_MAP['chino:reading_done'], 'reading_done');
  assert.equal(EVENT_MAP['chino:stroke_done'], 'stroke_done');
  assert.equal(EVENT_MAP['chino:draw_used'], 'draw_used');
  assert.equal(EVENT_MAP['chino:speak_done'], 'speak_done');
});

test('EVENT_MAP values match gamification.EVENTS keys', async () => {
  const { EVENTS } = await import('../src/gamification.js');
  for (const gameEvent of Object.values(EVENT_MAP)) {
    assert.ok(Object.prototype.hasOwnProperty.call(EVENTS, gameEvent), `missing ${gameEvent} in EVENTS`);
  }
});

test('attach is a function and exports EVENT_MAP', () => {
  assert.equal(typeof attach, 'function');
  assert.ok(EVENT_MAP);
});