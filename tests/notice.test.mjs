// tests/notice.test.mjs — REVIEW-9 M3: the accessible toast is announced.
//
// notice.js must make #app-status visible FIRST and set its text in the next
// frame; a screen reader only announces an aria-live region whose content
// changes after the region is already in the accessibility tree. Nothing else
// imports notice.js, so without this test the requestAnimationFrame can be
// deleted and `npm test` stays green.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installFakeDom } from './helpers/fake-dom.mjs';
import { registerLocale } from '../src/i18n.js';
import { notice } from '../src/notice.js';

registerLocale('en', { errors: { routeMissing: 'Screen "{screen}" does not exist.' } });

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('notice shows the region before it writes the text (announceable toast)', async () => {
  const dom = installFakeDom();
  try {
    const status = new dom.FakeNode('div');
    status.setAttribute('id', 'app-status');
    status.hidden = true;
    globalThis.document.body.append(status);

    notice('errors.routeMissing', { screen: 'nope' });

    assert.equal(status.hidden, false, 'the region must be visible before the text lands');
    assert.equal(status.textContent, '', 'the text must land in the next frame, not synchronously');

    await tick();
    assert.equal(status.textContent, 'Screen "nope" does not exist.');
  } finally {
    dom.restore();
  }
});