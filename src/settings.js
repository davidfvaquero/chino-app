/**
 * User settings — theme, font scale, tone colors, daily goal, locale.
 *
 * Public API:
 *   getSettings()         -> { theme, fontScale, toneColors, dailyGoal, locale }
 *   setSetting(key, value)  validates, persists to storage 'settings', fires 'chino:settings_changed'
 *   applySettings()       applies theme + fontScale to <html> (data-theme attr, font-scale var)
 *   DEFAULTS              exported constants for validation & tests
 *
 * Theme values: 'auto' | 'light' | 'dark'
 *   'auto' follows prefers-color-scheme and reacts to its change.
 * Font scale values: 1 | 1.15 | 1.3
 * Tone colors: boolean (default true)
 * Daily goal: integer (default 20)
 * Locale: string (managed by i18n, persisted here for restore)
 *
 * Dark theme is implemented by injecting a <style> that overrides the CSS variables
 * defined in src/styles.css (--bg, --bg-soft, --fg, --fg-soft, --line). The original
 * styles.css is never edited.
 */

import storage from './storage.js';

/** Default values and allowed values for validation. */
export const DEFAULTS = {
  theme: 'auto',
  fontScale: 1,
  toneColors: true,
  dailyGoal: 20,
  locale: 'en',
};

const ALLOWED = {
  theme: ['auto', 'light', 'dark'],
  fontScale: [1, 1.15, 1.3],
  toneColors: [true, false],
  dailyGoal: [10, 20, 30, 50],
};

/** Storage keys (single 'settings' store, one key per setting). */
const KEYS = Object.keys(DEFAULTS);

/** Injected style element ID for dark theme overrides. */
const STYLE_ID = 'settings-theme-overrides';

/** CSS variables that exist in src/styles.css and need dark overrides. */
const DARK_VARS = {
  '--bg': '#131211',
  '--bg-soft': '#1e1c1b',
  '--fg': '#f2f0ee',
  '--fg-soft': '#b3aeaa',
  '--line': '#302d2b',
};

/** Light variables (explicit, for when data-theme="light" forces light). */
const LIGHT_VARS = {
  '--bg': '#ffffff',
  '--bg-soft': '#f5f5f4',
  '--fg': '#1c1b1a',
  '--fg-soft': '#5f5c58',
  '--line': '#e3e1df',
};

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
 * Build the CSS text for the theme override <style>.
 * @param {'light'|'dark'} theme
 * @returns {string}
 */
function buildThemeCSS(theme) {
  const vars = theme === 'dark' ? DARK_VARS : LIGHT_VARS;
  const lines = Object.entries(vars).map(([name, value]) => `  ${name}: ${value};`);
  return `html[data-theme="${theme}"] {\n${lines.join('\n')}\n}`;
}

/**
 * Ensure the override <style> exists in <head>.
 * @param {Document} doc
 */
function ensureStyleElement(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
${buildThemeCSS('light')}

${buildThemeCSS('dark')}
`;
  doc.head.append(style);
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

  ensureStyleElement(doc);

  const theme = settings.theme === 'auto'
    ? (doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : settings.theme;

  doc.documentElement.dataset.theme = theme;
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

// Browser bootstrap: initialize cache and apply on load.
if (typeof window !== 'undefined') {
  initCache();
}