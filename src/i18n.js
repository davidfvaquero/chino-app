/**
 * i18n: single source of truth for every UI string.
 *
 * Rules for the rest of the app:
 *  - never write user-visible text in a module; add a key to src/locales/<code>.json
 *    and read it with t('some.key').
 *  - adding a language = drop src/locales/<code>.json and list the code in
 *    src/locales/index.json (that is all; the app loads whatever is listed).
 *
 * Keys are dotted paths ("nav.review", "screens.learn.title").
 * Missing keys fall back to the default locale, then to the key itself.
 */

export const DEFAULT_LOCALE = 'en';

/** code -> flat? no: nested dictionaries kept as-is, resolved per lookup. */
const dictionaries = new Map();
let current = DEFAULT_LOCALE;
const listeners = new Set();

/** Registers (or replaces) a locale dictionary. Mechanism for new languages. */
export function registerLocale(code, dictionary) {
  if (!code || typeof dictionary !== 'object' || dictionary === null) {
    throw new TypeError('registerLocale(code, dictionary) needs a code and an object');
  }
  dictionaries.set(code, dictionary);
  return code;
}

export function availableLocales() {
  return [...dictionaries.keys()].sort();
}

export function hasLocale(code) {
  return dictionaries.has(code);
}

export function getLocale() {
  return current;
}

export function setLocale(code) {
  if (!dictionaries.has(code)) {
    throw new Error(`locale not loaded: ${code}`);
  }
  if (code === current) return code;
  current = code;
  for (const fn of listeners) fn(code);
  return code;
}

/** Subscribe to locale changes (used to re-render chrome and screens). */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Loads `<code>.json` next to this module (works in dev and in dist/). */
export async function loadLocale(code, base = new URL('./locales/', import.meta.url)) {
  const url = new URL(`${code}.json`, base);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`cannot load locale ${code} (${res.status})`);
  return registerLocale(code, await res.json());
}

/** Loads every locale listed in locales/index.json. Falls back to DEFAULT_LOCALE. */
export async function loadAvailableLocales(base = new URL('./locales/', import.meta.url)) {
  let codes = null;
  try {
    const res = await fetch(new URL('index.json', base), { cache: 'no-cache' });
    if (res.ok) codes = await res.json();
  } catch {
    codes = null;
  }
  if (!Array.isArray(codes) || codes.length === 0) codes = [DEFAULT_LOCALE];
  const loaded = [];
  for (const code of codes) {
    try {
      loaded.push(await loadLocale(code, base));
    } catch (err) {
      // Missing/broken locale file must not take the whole app down.
      console.warn(String(err));
    }
  }
  if (loaded.length === 0 && !dictionaries.has(DEFAULT_LOCALE)) {
    registerLocale(DEFAULT_LOCALE, {});
  }
  return loaded;
}

function lookup(code, key) {
  const dict = dictionaries.get(code);
  if (!dict) return undefined;
  return key
    .split('.')
    .reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), dict);
}

function interpolate(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/** Translates a key. Returns the key itself when the key is missing anywhere. */
export function t(key, params) {
  const value = lookup(current, key) ?? lookup(DEFAULT_LOCALE, key);
  if (typeof value !== 'string') return key;
  return interpolate(value, params);
}

/** Native name of a locale ("English", "Español") from its own `locale.name` key. */
export function localeLabel(code) {
  const value = lookup(code, 'locale.name');
  return typeof value === 'string' ? value : code;
}

/** True when the key exists in the active (or default) locale. */
export function has(key) {
  return typeof (lookup(current, key) ?? lookup(DEFAULT_LOCALE, key)) === 'string';
}
