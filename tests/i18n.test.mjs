import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCALE,
  availableLocales,
  getLocale,
  has,
  hasLocale,
  loadLocale,
  localeLabel,
  registerLocale,
  setLocale,
  subscribe,
  t,
} from '../src/i18n.js';

// Unique locale codes per test: module state is shared across the file.
registerLocale('en', {
  locale: { name: 'English' },
  nav: { review: 'Review' },
  only: { inDefault: 'default only' },
  greet: 'Hello {name}, you have {count} cards',
  literal: 'Use {braces} carefully',
});
registerLocale('xx', {
  locale: { name: 'Xxish' },
  nav: { review: 'Rexxiew' },
  greet: 'Hola {name}',
});

test('t() returns an existing key from the active locale', () => {
  setLocale('xx');
  assert.equal(t('nav.review'), 'Rexxiew');
  setLocale(DEFAULT_LOCALE);
  assert.equal(t('nav.review'), 'Review');
});

test('t() returns the key itself when the key is missing', () => {
  assert.equal(t('nope.not.here'), 'nope.not.here');
  assert.equal(t('nav.review'), 'Review'); // sanity: real keys still resolve
});

test('t() falls back to the default locale when the active locale lacks the key', () => {
  setLocale('xx');
  assert.equal(t('only.inDefault'), 'default only');
  setLocale(DEFAULT_LOCALE);
});

test('t() interpolates {placeholders}', () => {
  assert.equal(t('greet', { name: 'Ana', count: 3 }), 'Hello Ana, you have 3 cards');
});

test('t() keeps unknown placeholders untouched', () => {
  assert.equal(t('greet', { name: 'Ana' }), 'Hello Ana, you have {count} cards');
  assert.equal(t('literal', { other: 1 }), 'Use {braces} carefully');
});

test('has() distinguishes present from missing keys', () => {
  assert.equal(has('nav.review'), true);
  assert.equal(has('nav.revieww'), false);
});

test('locale registry: available, hasLocale, label, unknown locale rejected', () => {
  assert.ok(availableLocales().includes('xx'));
  assert.equal(hasLocale('xx'), true);
  assert.equal(hasLocale('zz'), false);
  assert.equal(localeLabel('xx'), 'Xxish');
  assert.equal(localeLabel('zz'), 'zz');
  assert.throws(() => setLocale('zz'), /not loaded/);
});

test('setLocale notifies subscribers', () => {
  const seen = [];
  const off = subscribe((code) => seen.push(code));
  setLocale('xx');
  setLocale('xx'); // same locale: no duplicate notification
  setLocale(DEFAULT_LOCALE);
  off();
  assert.deepEqual(seen, ['xx', DEFAULT_LOCALE]);
  assert.equal(getLocale(), DEFAULT_LOCALE);
});

test('registerLocale validates its arguments', () => {
  assert.throws(() => registerLocale('', {}), TypeError);
  assert.throws(() => registerLocale('ok', null), TypeError);
});

test('loadLocale() fetches and registers a JSON file (mechanism for new languages)', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({ locale: { name: 'Testish' }, nav: { learn: 'Lern' } }) };
  };
  try {
    await loadLocale('tt', new URL('https://example.test/locales/'));
    assert.ok(calls[0].endsWith('/locales/tt.json'));
    assert.equal(hasLocale('tt'), true);
    setLocale('tt');
    assert.equal(t('nav.learn'), 'Lern');
    setLocale(DEFAULT_LOCALE);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadLocale() reports a clear error on HTTP failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  try {
    await assert.rejects(() => loadLocale('zz', new URL('https://example.test/locales/')), /404/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
