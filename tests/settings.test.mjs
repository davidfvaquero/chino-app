/**
 * Settings module tests — validation, defaults, persistence, applySettings.
 * Run with: node --test tests/settings.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDriver, createStorage } from '../src/storage.js';

/** Minimal document stand-in for Node tests. */
function createMockDocument(prefersDark = false) {
  const documentElement = {
    dataset: {},
    style: { properties: new Map(), setProperty(name, value) { this.properties.set(name, value); } },
    classList: { tokens: new Set(), toggle(name, force) { if (force) this.tokens.add(name); else this.tokens.delete(name); }, contains(name) { return this.tokens.has(name); } },
  };
  const head = {
    children: [],
    append(child) { this.children.push(child); },
    querySelector(id) { return this.children.find(c => c.id === id); },
  };
  const defaultView = {
    matchMedia: (query) => ({
      matches: prefersDark,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  };
  return {
    documentElement,
    head,
    defaultView,
    getElementById(id) { return head.querySelector(id); },
    createElement(tag) {
      if (tag === 'style') {
        return { id: '', textContent: '', tagName: 'STYLE' };
      }
      return {};
    },
  };
}

/** Install a mock document/window for testing. */
function installMockDocument(prefersDark = false) {
  const mockDoc = createMockDocument(prefersDark);
  globalThis.document = mockDoc;
  globalThis.window = {
    document: mockDoc,
    matchMedia: mockDoc.defaultView.matchMedia,
    dispatchEvent: (event) => {
      if (event.type === 'chino:settings_changed' && globalThis.window._settingsHandler) {
        globalThis.window._settingsHandler(event);
      }
      return true;
    },
    addEventListener: (type, handler) => {
      if (type === 'chino:settings_changed') globalThis.window._settingsHandler = handler;
    },
    removeEventListener: () => {},
    _settingsHandler: null,
  };
  return mockDoc;
}

/** Restore globals (for tests that need no document). */
function restoreGlobals() {
  delete globalThis.document;
  delete globalThis.window;
}

// Install mock BEFORE importing the module (bootstrap runs at import time)
const mockDoc = installMockDocument(false);

// Import the module once after mock is installed
const settingsModule = await import('../src/settings.js');
const { getSettings, setSetting, applySettings, DEFAULTS } = settingsModule;

test('DEFAULTS exports expected keys and values', () => {
  assert.deepEqual(Object.keys(DEFAULTS).sort(), ['dailyGoal', 'fontScale', 'locale', 'theme', 'toneColors']);
  assert.equal(DEFAULTS.theme, 'auto');
  assert.equal(DEFAULTS.fontScale, 1);
  assert.equal(DEFAULTS.toneColors, true);
  assert.equal(DEFAULTS.dailyGoal, 20);
  assert.equal(DEFAULTS.locale, 'en');
});

test('getSettings returns defaults when storage is empty', async () => {
  const settings = await getSettings();
  assert.deepEqual(settings, DEFAULTS);
});

test('setSetting validates theme values', async () => {
  await assert.rejects(() => setSetting('theme', 'invalid'), /Invalid value/);
  await assert.rejects(() => setSetting('theme', 'blue'), /Invalid value/);
  await setSetting('theme', 'light');
  await setSetting('theme', 'dark');
  await setSetting('theme', 'auto');
});

test('setSetting validates fontScale values', async () => {
  await assert.rejects(() => setSetting('fontScale', 1.1), /Invalid value/);
  await assert.rejects(() => setSetting('fontScale', 2), /Invalid value/);
  await setSetting('fontScale', 1);
  await setSetting('fontScale', 1.15);
  await setSetting('fontScale', 1.3);
});

test('setSetting validates toneColors boolean', async () => {
  await assert.rejects(() => setSetting('toneColors', 'yes'), /Invalid value/);
  await assert.rejects(() => setSetting('toneColors', 1), /Invalid value/);
  await setSetting('toneColors', true);
  await setSetting('toneColors', false);
});

test('setSetting validates dailyGoal values', async () => {
  await assert.rejects(() => setSetting('dailyGoal', 5), /Invalid value/);
  await assert.rejects(() => setSetting('dailyGoal', 25), /Invalid value/);
  await assert.rejects(() => setSetting('dailyGoal', 20.5), /Invalid value/);
  await setSetting('dailyGoal', 10);
  await setSetting('dailyGoal', 20);
  await setSetting('dailyGoal', 30);
  await setSetting('dailyGoal', 50);
});

test('settings persist across getSettings calls (memory driver)', async () => {
  await setSetting('theme', 'dark');
  await setSetting('fontScale', 1.3);
  await setSetting('toneColors', false);
  await setSetting('dailyGoal', 50);

  const settings = await getSettings();
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.fontScale, 1.3);
  assert.equal(settings.toneColors, false);
  assert.equal(settings.dailyGoal, 50);
});

test('setSetting returns false when value unchanged', async () => {
  await setSetting('theme', 'light');
  const changed = await setSetting('theme', 'light');
  assert.equal(changed, false);
});

test('setSetting returns true when value changes', async () => {
  await setSetting('theme', 'light');
  const changed = await setSetting('theme', 'dark');
  assert.equal(changed, true);
});

test('applySettings sets data-theme and --font-scale on document', async () => {
  await setSetting('theme', 'dark');
  await setSetting('fontScale', 1.15);
  applySettings();

  assert.equal(mockDoc.documentElement.dataset.theme, 'dark');
  assert.equal(mockDoc.documentElement.style.properties.get('--font-scale'), '1.15');
});

test('applySettings resolves auto theme to light when prefers-color-scheme is light', async () => {
  // Re-install mock with prefersDark = false
  const newMockDoc = installMockDocument(false);
  await setSetting('theme', 'auto');
  await setSetting('fontScale', 1);
  applySettings();

  assert.equal(newMockDoc.documentElement.dataset.theme, 'light');
});

test('applySettings resolves auto theme to dark when prefers-color-scheme is dark', async () => {
  const newMockDoc = installMockDocument(true);
  await setSetting('theme', 'auto');
  await setSetting('fontScale', 1);
  applySettings();

  assert.equal(newMockDoc.documentElement.dataset.theme, 'dark');
});

test('theme override style element is injected with light and dark CSS', async () => {
  const newMockDoc = installMockDocument(false);
  await setSetting('theme', 'dark');
  applySettings();

  const styleEl = newMockDoc.getElementById('settings-theme-overrides');
  assert.ok(styleEl, 'style element should exist');
  assert.ok(styleEl.textContent.includes('html[data-theme="light"]'));
  assert.ok(styleEl.textContent.includes('html[data-theme="dark"]'));
  assert.ok(styleEl.textContent.includes('--bg:'));
  assert.ok(styleEl.textContent.includes('--fg:'));
});

test('dark theme CSS overrides match src/styles.css variables', async () => {
  const newMockDoc = installMockDocument(false);
  await setSetting('theme', 'dark');
  applySettings();

  const styleEl = newMockDoc.getElementById('settings-theme-overrides');
  const css = styleEl.textContent;

  assert.ok(css.includes('--bg: #131211'));
  assert.ok(css.includes('--bg-soft: #1e1c1b'));
  assert.ok(css.includes('--fg: #f2f0ee'));
  assert.ok(css.includes('--fg-soft: #b3aeaa'));
  assert.ok(css.includes('--line: #302d2b'));
});

test('light theme CSS overrides use correct values', async () => {
  const newMockDoc = installMockDocument(false);
  await setSetting('theme', 'light');
  applySettings();

  const styleEl = newMockDoc.getElementById('settings-theme-overrides');
  const css = styleEl.textContent;

  assert.ok(css.includes('--bg: #ffffff'));
  assert.ok(css.includes('--bg-soft: #f5f5f4'));
  assert.ok(css.includes('--fg: #1c1b1a'));
  assert.ok(css.includes('--fg-soft: #5f5c58'));
  assert.ok(css.includes('--line: #e3e1df'));
});

test('applySettings does nothing when document is undefined (Node)', async () => {
  restoreGlobals();
  // Should not throw
  await applySettings();
  assert.ok(true);
  // Reinstall for remaining tests
  installMockDocument(false);
});

test('getSettings returns a copy, not the internal cache', async () => {
  const s1 = await getSettings();
  const s2 = await getSettings();
  assert.notStrictEqual(s1, s2);
  s1.theme = 'mutated';
  const s3 = await getSettings();
  assert.notEqual(s3.theme, 'mutated');
});

test('settings change fires chino:settings_changed event (window exists)', async () => {
  let eventFired = false;
  let eventDetail = null;
  globalThis.window._settingsHandler = (event) => {
    eventFired = true;
    eventDetail = event.detail;
  };

  await setSetting('theme', 'dark');

  assert.ok(eventFired);
  assert.deepEqual(eventDetail, { key: 'theme', value: 'dark' });
});

test('toneColors setting change fires event with boolean value', async () => {
  let eventDetail = null;
  globalThis.window._settingsHandler = (event) => {
    eventDetail = event.detail;
  };

  // Ensure we start from a known state (true is default)
  await setSetting('toneColors', true);
  eventDetail = null;

  await setSetting('toneColors', false);
  assert.deepEqual(eventDetail, { key: 'toneColors', value: false });

  await setSetting('toneColors', true);
  assert.deepEqual(eventDetail, { key: 'toneColors', value: true });
});