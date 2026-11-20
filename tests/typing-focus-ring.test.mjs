// A6 — the typing input must show the system focus ring (3px --focus), not
// only a border-color change. Static, browser-free. Run with
// `node --test tests/typing-focus-ring.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('typing input keeps the accent border and adds the system focus ring', () => {
  const css = src('src/learn/typing.js');
  assert.match(css, /\.typing-input:focus\s*\{[^}]*border-color:\s*var\(--accent\)/);
  assert.match(
    css,
    /\.typing-input:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\);[^}]*outline-offset:\s*2px/,
    'missing .typing-input:focus-visible ring',
  );
});
