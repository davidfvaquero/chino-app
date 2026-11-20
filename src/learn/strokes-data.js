/**
 * strokes-data.js — stroke dataset loading and normalisation
 * (docs/REVIEW-2.md I14 split of `src/learn/strokes.js`).
 *
 * Drawings come from `public/data/strokes/` (Make Me a Hanzi — see CREDITS.md):
 * `index.json` maps a character to a shard file, and each entry is
 * `{ character, strokes: [svgPath], medians: [[[x, y]]] }` in a 1024 box with y
 * UP (baseline at y=900). `toStrokeSet` flips the medians to screen space
 * (y DOWN); outline paths get `OUTLINE_FLIP` in every SVG.
 */
export const titleKey = 'hubs.learn.strokes';

/** Side of the square viewBox the stroke data lives in. */
export const VIEW_BOX_SIZE = 1024;
/** Make Me a Hanzi baseline: the data is y UP, screen is y DOWN. */
export const BASELINE_Y = 900;
/** Same flip as hanzi-writer; applied to every outline path (medians are flipped in `toStrokeSet`). */
export const OUTLINE_FLIP = `scale(1,-1) translate(0,-${BASELINE_Y})`;
const SHARD_PAD = 3;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Where the browser build serves the stroke shards from (next to `src/`). */
export const DEFAULT_STROKE_BASE = new URL('../../data/strokes/', import.meta.url);

const isPoint = (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);

/** First CJK character of a route segment / search box, decoded or not. */
export function normalizeCharacter(value) {
  if (value === undefined || value === null) return '';
  let text = String(value).trim();
  if (!text) return '';
  try {
    text = decodeURIComponent(text);
  } catch {
    /* malformed escape: use the raw text */
  }
  const match = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u);
  return match ? match[0] : '';
}

/** Every CJK character of a route segment / search box, in order. */
export function hanziCharacters(value) {
  if (value === undefined || value === null) return [];
  return String(value).match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu) || [];
}

export function isValidStrokeEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.character !== 'string' || entry.character.trim() === '') return false;
  const { strokes, medians } = entry;
  if (!Array.isArray(strokes) || !Array.isArray(medians)) return false;
  if (strokes.length === 0 || strokes.length !== medians.length) return false;
  if (!strokes.every((path) => typeof path === 'string' && path.trim() !== '')) return false;
  return medians.every((median) => Array.isArray(median) && median.length > 0 && median.every(isPoint));
}

/** Normalises a raw shard entry; returns null when it is not usable. Medians come out in screen space (y DOWN). */
export function toStrokeSet(entry) {
  if (!isValidStrokeEntry(entry)) return null;
  return {
    character: entry.character.trim(),
    strokes: entry.strokes.slice(),
    medians: entry.medians.map((median) => median.map((point) => [point[0], BASELINE_Y - point[1]])),
  };
}

/** Characters of `lookup` matching `query` (exact hit first). Dataset keys only. */
export function searchCharacters(query, lookup, { limit = 12 } = {}) {
  const text = String(query ?? '').trim();
  if (!text || !lookup || typeof lookup !== 'object') return [];
  const keys = Object.keys(lookup);
  const exact = keys.filter((key) => key === text);
  const rest = keys.filter((key) => key !== text && key.includes(text));
  return exact.concat(rest).slice(0, limit);
}

/** Loader for `public/data/strokes/` (index + one shard per character). */
export function createStrokeLoader({ base = DEFAULT_STROKE_BASE, fetchImpl } = {}) {
  const root = toBaseUrl(base);
  const cache = new Map();

  const fetchJson = async (url) => {
    if (cache.has(url)) return cache.get(url);
    const pending = (async () => {
      if (fetchImpl) return fetchImpl(url);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`strokes: HTTP ${response.status} for ${url}`);
      return response.json();
    })();
    cache.set(url, pending);
    try {
      return await pending;
    } catch (error) {
      cache.delete(url);
      throw error;
    }
  };

  const loadIndex = () => fetchJson(new URL('index.json', root).href);

  const load = async (character) => {
    const char = normalizeCharacter(character);
    if (!char) return null;
    const index = await loadIndex();
    const shardId = index?.lookup?.[char];
    if (shardId === undefined || shardId === null) return null;
    const file = index.shardFiles?.[shardId] ?? `shards/${String(shardId).padStart(SHARD_PAD, '0')}.json`;
    const shard = await fetchJson(new URL(file, root).href);
    const raw = Array.isArray(shard) ? shard.find((entry) => entry?.character === char) : shard?.[char];
    return toStrokeSet(raw);
  };

  const search = async (query, options) => {
    const index = await loadIndex();
    return searchCharacters(query, index?.lookup ?? {}, options);
  };

  return { loadIndex, load, search };
}

const defaultLoader = createStrokeLoader();

/** Index of the whole stroke dataset (`{lookup, shardFiles, ...}`). */
export const loadStrokeIndex = () => defaultLoader.loadIndex();
/** Stroke set of one character, or null when the dataset has none. */
export const loadStrokes = (character) => defaultLoader.load(character);

function toBaseUrl(base) {
  if (base instanceof URL) return base;
  const text = String(base ?? DEFAULT_STROKE_BASE.href);
  try {
    return new URL(text);
  } catch {
    return new URL(text.endsWith('/') ? text : `${text}/`, DEFAULT_STROKE_BASE);
  }
}

export { SVG_NS };
