/**
 * User settings — theme, font scale, tone colors, daily goal.
 *
 * Public API:
 *   getSettings()         -> { theme, fontScale, toneColors, pinyin, dailyGoal }
 *   pinyinToggle()        -> header chip that flips the same `pinyin` setting
 *   setSetting(key, value)  validates, persists to storage 'settings', fires 'chino:settings_changed'
 *   applySettings()       applies theme + fontScale to <html> (data-theme attr, font-scale var)
 *   DEFAULTS              exported constants for validation & tests
 *
 * Theme values: 'auto' | 'light' | 'dark'
 *   'auto' follows prefers-color-scheme and reacts to its change.
 * Font scale values: 1 | 1.15 | 1.3
 * Tone colors: boolean (default true)
 * Pinyin: boolean (default true = shown). Off sets <html data-pinyin="off">,
 *   which hides every .py element (see styles.css).
 * Daily goal: integer (default 20)
 * Reading level: 'hsk1' | 'hsk2' | 'hsk3' (default 'hsk1'), the last level
 *   opened on the Read screen
 *
 * This module owns NO colours. It only sets two things on <html>:
 *   data-theme="light|dark"   -> src/styles.css switches its light-dark() tokens
 *   --font-scale              -> src/styles.css scales the root font size
 */

import storage from './storage.js';
import { t } from './i18n.js';
import { h } from './dom.js';

/** Default values and allowed values for validation. */
export const DEFAULTS = {
  theme: 'auto',
  fontScale: 1,
  toneColors: true,
  pinyin: true,
  dailyGoal: 20,
  readingLevel: 'hsk1',
};

const ALLOWED = {
  theme: ['auto', 'light', 'dark'],
  fontScale: [1, 1.15, 1.3],
  toneColors: [true, false],
  pinyin: [true, false],
  dailyGoal: [10, 20, 30, 50],
  readingLevel: ['hsk1', 'hsk2', 'hsk3'],
};

/** Storage keys (single 'settings' store, one key per setting). */
const KEYS = Object.keys(DEFAULTS);

/** Current cached settings (populated by initCache). */
let settingsCache = null;
let cacheInitialized = false;
let initPromise = null;

/** Media query listener for 'auto' theme. */
let mqlListener = null;

/**
 * Validate a single setting value.
 * @param {string} key
 * @param {*} value
 * @returns {boolean}
 */
function validate(key, value) {
  const allowed = ALLOWED[key];
  if (!allowed) return false;
  if (key === 'dailyGoal') return Number.isInteger(value) && allowed.includes(value);
  return allowed.includes(value);
}

/**
 * Apply theme and font scale to <html>.
 * - data-theme: 'light' | 'dark' (never 'auto'; 'auto' resolves to one of the two)
 * - style.setProperty('--font-scale', value)
 * @param {Object} settings
 * @param {Document} [doc=document]
 */
function applyToDocument(settings, doc = document) {
  if (typeof doc === 'undefined') return;

  const theme = settings.theme === 'auto'
    ? (doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : settings.theme;

  doc.documentElement.dataset.theme = theme;
  doc.documentElement.dataset.pinyin = settings.pinyin === false ? 'off' : 'on';
  doc.documentElement.style.setProperty('--font-scale', String(settings.fontScale));
}

/**
 * Set up or update the prefers-color-scheme listener for 'auto' theme.
 * @param {Object} settings
 * @param {Document} [doc=document]
 */
function syncAutoListener(settings, doc = document) {
  if (typeof doc === 'undefined' || typeof doc.defaultView === 'undefined') return;

  const mql = doc.defaultView.matchMedia('(prefers-color-scheme: dark)');

  // Remove old listener
  if (mqlListener) {
    mql.removeEventListener('change', mqlListener);
    mqlListener = null;
  }

  // Only listen when theme is 'auto'
  if (settings.theme !== 'auto') return;

  mqlListener = () => {
    // Re-apply with current settings (theme will resolve to new preference)
    applyToDocument(settings, doc);
  };
  mql.addEventListener('change', mqlListener);
}

/**
 * Load all settings from storage, falling back to DEFAULTS.
 * @returns {Promise<Object>}
 */
async function loadFromStorage() {
  const out = { ...DEFAULTS };
  for (const key of KEYS) {
    try {
      const value = await storage.get('settings', key);
      if (value !== undefined && validate(key, value)) {
        out[key] = value;
      }
    } catch {
      // ignore storage errors, keep default
    }
  }
  return out;
}

/**
 * Initialize the in-memory cache from storage (called once on boot).
 */
async function initCache() {
  if (cacheInitialized) return initPromise;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    settingsCache = await loadFromStorage();
    cacheInitialized = true;
    if (typeof document !== 'undefined') {
      applyToDocument(settingsCache);
      syncAutoListener(settingsCache);
    }
  })();
  return initPromise;
}

/**
 * Get current settings (from cache, initializing if needed).
 * @returns {Promise<Object>}
 */
export async function getSettings() {
  if (!cacheInitialized) await initCache();
  return { ...settingsCache };
}

/**
 * Set a single setting, validate, persist, fire event, update cache & DOM.
 * @param {string} key
 * @param {*} value
 * @returns {Promise<boolean>} true if changed
 */
export async function setSetting(key, value) {
  if (!validate(key, value)) {
    throw new Error(`Invalid value for ${key}: ${value}`);
  }

  // Initialize cache if not yet done
  if (!cacheInitialized) await initCache();

  // No change?
  if (settingsCache[key] === value) return false;

  // Persist
  await storage.set('settings', key, value);

  // Update cache
  settingsCache[key] = value;

  // Apply to document immediately
  if (typeof document !== 'undefined') {
    applyToDocument(settingsCache);
    syncAutoListener(settingsCache);
  }

  // Fire event for other modules (tone.js, etc.)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('chino:settings_changed', { detail: { key, value } }));
  }

  return true;
}

/**
 * Apply current settings to the document (theme + font scale).
 * Called on boot and after any settings change.
 */
export function applySettings() {
  if (!cacheInitialized || typeof document === 'undefined') return;
  applyToDocument(settingsCache);
  syncAutoListener(settingsCache);
}

/**
 * Quick "Pinyin" toggle for screen headers. Flips the same global `pinyin`
 * setting as the Settings screen; aria-pressed = pinyin shown. A shared
 * `.chip` (48 px, border, pressed state) so it reads as a switch, not text.
 * Follows 'chino:settings_changed' and stops listening once it leaves the DOM.
 * @returns {HTMLButtonElement}
 */
export function pinyinToggle() {
  const shown = () => document.documentElement.dataset.pinyin !== 'off';
  const label = () => t('settings.pinyin.quickState', { state: t(shown() ? 'settings.pinyin.on' : 'settings.pinyin.off') });
  const sync = () => {
    if (!btn.isConnected) {
      window.removeEventListener('chino:settings_changed', sync);
      return;
    }
    btn.setAttribute('aria-pressed', String(shown()));
    btn.textContent = label();
  };
  const btn = h('button', {
    type: 'button',
    class: 'chip pinyin-toggle',
    'data-action': 'toggle-pinyin',
    text: label(),
    onclick: () => setSetting('pinyin', !shown()),
  });
  btn.setAttribute('aria-pressed', String(shown()));
  window.addEventListener('chino:settings_changed', sync);
  return btn;
}

// Browser bootstrap: initialize cache and apply on load.
if (typeof window !== 'undefined') {
  initCache();
}