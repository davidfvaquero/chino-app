/**
 * reading/data.js — fetch the readings JSON (no DOM, fetch injectable for tests).
 *
 * Multilevel: every loader takes the HSK level (`hsk1` by default). Files live
 * per level, at `public/data/readings/<level>/`, and the load stays
 * language-aware: with locale 'es' it reads `data/es/readings/<level>/...` when
 * translated and falls back to English without an error (src/data-url.js).
 */

import { fetchData } from '../data-url.js';

/** Levels with a reading index. hsk1 is the original, default one. */
export const LEVELS = ['hsk1', 'hsk2', 'hsk3'];
export const DEFAULT_LEVEL = 'hsk1';

async function getJSON(url, fetchImpl) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const res = await doFetch(url);
  if (!res || res.ok === false) throw new Error(`reading: ${url} -> ${res && res.status}`);
  return res.json();
}

/** A selectable level name, or the default when unknown. */
export function normalizeLevel(level) {
  return LEVELS.includes(level) ? level : DEFAULT_LEVEL;
}

/** Injected fetch (tests) keeps the plain-URL contract; otherwise language-aware. */
function loadJson(level, relPath, { base, fetch: fetchImpl } = {}) {
  if (fetchImpl) {
    const root = base ?? (typeof document === 'undefined' ? `/data/readings/${level}` : new URL(`data/readings/${level}`, document.baseURI));
    return getJSON(`${root}/${relPath}`, fetchImpl);
  }
  return fetchData(`readings/${level}/${relPath}`);
}

/**
 * Index of available readings: `[{ id, title, topic }]`.
 * `loadIndex(level, opts)` — the old `loadIndex(opts)` (hsk1) still works.
 */
export async function loadIndex(level = DEFAULT_LEVEL, opts = {}) {
  if (level && typeof level === 'object') {
    opts = level;
    level = opts.level ?? DEFAULT_LEVEL;
  }
  const data = await loadJson(normalizeLevel(level), 'index.json', opts);
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.readings) ? data.readings : [];
}

/** One reading by id (the index id doubles as the file name) at `opts.level`. */
export async function loadReading(id, opts = {}) {
  return loadJson(normalizeLevel(opts.level), `${id}.json`, opts);
}
