/**
 * reading/data.js — fetch the readings JSON (no DOM, fetch injectable for tests).
 *
 * Language-aware by default: with locale 'es' it loads
 * `data/es/readings/hsk1/...` when that file is translated and falls back to
 * English without an error (see src/data-url.js). The level is `hsk1`.
 */

import { fetchData } from '../data-url.js';

const LEVEL = 'hsk1';
const BASE =
  typeof document === 'undefined'
    ? `/data/readings/${LEVEL}`
    : new URL(`data/readings/${LEVEL}`, document.baseURI);

async function getJSON(url, fetchImpl) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const res = await doFetch(url);
  if (!res || res.ok === false) throw new Error(`reading: ${url} -> ${res && res.status}`);
  return res.json();
}

/** Injected fetch (tests) keeps the plain-URL contract; otherwise language-aware. */
function loadJson(relPath, { base = BASE, fetch: fetchImpl } = {}) {
  return fetchImpl ? getJSON(`${base}/${relPath}`, fetchImpl) : fetchData(`readings/${LEVEL}/${relPath}`);
}

/** Index of available readings: `[{ id, title, topic }]`. */
export async function loadIndex(opts = {}) {
  const data = await loadJson('index.json', opts);
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.readings) ? data.readings : [];
}

/** One reading by id (the index id doubles as the file name). */
export async function loadReading(id, opts = {}) {
  return loadJson(`${id}.json`, opts);
}
