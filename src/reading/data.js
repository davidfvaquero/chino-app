/**
 * reading/data.js — fetch the readings JSON (no DOM, fetch injectable for tests).
 *
 * Runtime URLs are `/data/readings/<level>/...` (public/ is copied to the site
 * root by the build). The level defaults to `hsk1`.
 */

const BASE = typeof document === 'undefined' ? '/data/readings/hsk1' : new URL('data/readings/hsk1', document.baseURI);

async function getJSON(url, fetchImpl) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const res = await doFetch(url);
  if (!res || res.ok === false) throw new Error(`reading: ${url} -> ${res && res.status}`);
  return res.json();
}

/** Index of available readings: `[{ id, title, topic }]`. */
export async function loadIndex({ base = BASE, fetch: fetchImpl } = {}) {
  const data = await getJSON(`${base}/index.json`, fetchImpl);
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.readings) ? data.readings : [];
}

/** One reading by id (the index id doubles as the file name). */
export async function loadReading(id, { base = BASE, fetch: fetchImpl } = {}) {
  return getJSON(`${base}/${id}.json`, fetchImpl);
}
