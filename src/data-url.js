/**
 * data-url.js — which data file to load, per language.
 *
 * English study content lives in `public/data/<path>` (served as `data/<path>`).
 * Its complete Spanish translation lives in `public/data/es/<path>` — same
 * structure, same keys, same ids (see docs/i18n-content.md). This module picks
 * the right one and never repeats a 404: the first probe of a missing Spanish
 * file is remembered for the rest of the session.
 *
 * Public API:
 *   dataUrl(path)          -> Promise<string>   URL to load for the active locale
 *   fetchData(path)        -> Promise<object>   that URL, parsed as JSON
 *   hasLocalizedData(path) -> Promise<boolean>  is there a Spanish file for it?
 *   loadManifest()         -> Promise<Set|null> the es listing (data/es/files.json)
 *   normalizePath(path)    -> string            'public/data/x.json' -> 'x.json'
 *   configure({base, fetch}) / resetCache()     injectables for Node/tests
 *
 * `path` is relative to the data root: 'lessons/hsk1/lesson-01.json',
 * 'themes/theme-01.json', … (a leading `data/`, `public/data/` or `es/` is
 * accepted and stripped).
 *
 * URLs are always built against `document.baseURI`, so the app also works from
 * a GitHub Pages subdirectory — never a hard-coded '/data/...'.
 *
 * Fallback order in locale 'es': `data/es/<path>` if it exists (manifest or a
 * successful fetch), otherwise `data/<path>`. In any other locale: always
 * `data/<path>`. `public/data/es/files.json`, when present, lists the files
 * that are translated (same relative names as the English listing), which lets
 * us skip the 404 probe entirely; without it every path is probed once.
 *
 * The manifest is an optimisation, not a requirement: a translation that exists
 * on disk is found even if nobody updated the listing.
 */

import { getLocale } from './i18n.js';

const DEFAULT_BASE = 'http://localhost/'; // Node fallback; tests inject their own

let injected = { base: null, fetch: null };

/** normalized path -> Promise<boolean>, cached for the session (no repeated 404). */
const existence = new Map();
/** url -> Promise<value> for successful JSON only. */
const jsonCache = new Map();
/** Set of translated paths, or null when there is no es/files.json. */
let manifest = null;
let manifestTried = false;

/** Inject a base URL and/or a fetch (Node tests, workers). Clears the caches.
 *  `base: null` restores the default (document.baseURI, or /data/ in Node). */
export function configure({ base, fetch: fetchImpl } = {}) {
  if (base !== undefined) injected.base = base;
  if (typeof fetchImpl === 'function') injected.fetch = fetchImpl;
  resetCache();
}

/** Drop every cached answer (the 404 memory included). */
export function resetCache() {
  existence.clear();
  jsonCache.clear();
  manifest = null;
  manifestTried = false;
}

function doFetch() {
  return injected.fetch || globalThis.fetch;
}

function baseUrl() {
  if (injected.base) {
    return injected.base instanceof URL ? injected.base : new URL(String(injected.base), DEFAULT_BASE);
  }
  if (typeof document !== 'undefined' && document.baseURI) {
    return new URL('data/', document.baseURI);
  }
  return new URL('/data/', DEFAULT_BASE);
}

/** 'public/data/es/lessons/x.json' -> 'lessons/x.json' */
export function normalizePath(path) {
  return String(path ?? '')
    .trim()
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/^public\//, '')
    .replace(/^data\//, '')
    .replace(/^es\//, '');
}

const englishUrl = (path) => new URL(normalizePath(path), baseUrl()).href;
const spanishUrl = (path) => new URL(`es/${normalizePath(path)}`, baseUrl()).href;

function getJson(url) {
  let pending = jsonCache.get(url);
  if (!pending) {
    pending = Promise.resolve()
      .then(() => doFetch()(url))
      .then((res) => {
        if (!res || res.ok === false) throw new Error(`data-url: ${url} -> ${res && res.status}`);
        return res.json();
      });
    jsonCache.set(url, pending);
    pending.catch(() => jsonCache.delete(url));
  }
  return pending;
}

/** The list of translated files, or null when there is no es/files.json. */
async function ensureManifest() {
  if (manifestTried) return manifest;
  manifestTried = true;
  try {
    const data = await getJson(spanishUrl('files.json'));
    const list = Array.isArray(data) ? data : Array.isArray(data?.files) ? data.files : [];
    manifest = new Set(
      list.map((entry) => normalizePath(typeof entry === 'string' ? entry : entry?.file)).filter(Boolean),
    );
  } catch {
    manifest = null; // no listing: probe each file instead
  }
  return manifest;
}

/** Public: force-load the es listing (also loaded lazily by dataUrl/fetchData). */
export async function loadManifest() {
  return ensureManifest();
}

function localizedExists(path) {
  const key = normalizePath(path);
  let pending = existence.get(key);
  if (!pending) {
    pending = (async () => {
      const list = await ensureManifest();
      if (list) return list.has(key);
      try {
        await getJson(spanishUrl(key));
        return true;
      } catch {
        return false;
      }
    })();
    existence.set(key, pending);
  }
  return pending;
}

/**
 * True when `public/data/es/<path>` exists. Independent of the active locale:
 * it answers "is this file translated?", not "which one would load now".
 */
export async function hasLocalizedData(path) {
  return localizedExists(path);
}

/** URL of the data file to load for the active locale (string, fetch-ready). */
export async function dataUrl(path) {
  if (getLocale() !== 'es') return englishUrl(path);
  return (await localizedExists(path)) ? spanishUrl(path) : englishUrl(path);
}

/** `dataUrl(path)` fetched and parsed. Throws on a missing/broken file. */
export async function fetchData(path) {
  return getJson(await dataUrl(path));
}
