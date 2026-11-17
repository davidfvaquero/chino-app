/**
 * Locale loading shared by the build (scripts/build.mjs) and the server
 * (scripts/serve.mjs).
 *
 * A locale is not one file: the shared `src/locales/<code>.json` holds the
 * shell's keys and every module owns a shard `src/locales/<code>.d/<area>.json`
 * with its own prefixed keys. The two are deep-merged into the single
 * `locales/<code>.json` that the app fetches. A leaf key written by two files
 * is a hard error (see mergeDictionaries in src/i18n.js), so two tasks can
 * never silently clobber each other's text.
 *
 * Adding a language stays "drop `es.json` + `es.d/`": nothing here is
 * en-specific, it globs whatever `<code>.json` files exist.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { mergeDictionaries } from '../src/i18n.js';

const exists = async (url) => {
  try {
    await stat(url);
    return true;
  } catch {
    return false;
  }
};

/** Locale codes with a `<code>.json` in `dir` (index.json is not a locale). */
export async function listLocaleCodes(dir) {
  const codes = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json') {
      codes.push(entry.name.slice(0, -'.json'.length));
    }
  }
  return codes.sort();
}

/** The files that make up one locale, base first then shards (merge order). */
export async function localeSources(dir, code) {
  const sources = [];
  const base = new URL(`${code}.json`, dir);
  if (await exists(base)) sources.push({ name: `${code}.json`, url: base });

  const shards = new URL(`${code}.d/`, dir);
  if (await exists(shards)) {
    const entries = (await readdir(shards, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        sources.push({ name: `${code}.d/${entry.name}`, url: new URL(entry.name, shards) });
      }
    }
  }
  return sources;
}

/** True when `<code>.d/` exists next to the locale files in `dir`. */
export function hasShards(dir, code) {
  return exists(new URL(`${code}.d/`, dir));
}

/** Merged dictionary for one locale. Throws when a key is defined twice. */
export async function loadMergedLocale(dir, code) {
  const entries = [];
  for (const source of await localeSources(dir, code)) {
    entries.push({ name: source.name, dict: JSON.parse(await readFile(source.url, 'utf8')) });
  }
  return mergeDictionaries(entries);
}
