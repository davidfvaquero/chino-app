#!/usr/bin/env node
/**
 * scripts/check-i18n.mjs — information only, never fails.
 *
 * Lists every English UI key that has no Spanish translation yet: one written
 * into src/locales/en.d/*.json (or en.json) by a later task but not mirrored in
 * es.d/ (or es.json). Those keys simply fall back to English at runtime, so this
 * is a nudge for translators, not a build gate.
 *
 * Usage: `node scripts/check-i18n.mjs`
 */
import { loadMergedLocale } from './build-locales.mjs';

const LOCALES = new URL('../src/locales/', import.meta.url);

/** Flat map of dotted key -> string (leaf strings only). */
function leafKeys(obj, parents = []) {
  const out = new Map();
  for (const [part, value] of Object.entries(obj)) {
    const path = [...parents, part];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of leafKeys(value, path)) out.set(k, v);
    } else {
      out.set(path.join('.'), value);
    }
  }
  return out;
}

const en = leafKeys(await loadMergedLocale(LOCALES, 'en'));
const es = leafKeys(await loadMergedLocale(LOCALES, 'es'));

const pending = [...en.keys()].filter((key) => !es.has(key)).sort();

if (pending.length === 0) {
  console.log(`i18n: es is up to date (${en.size} English keys, all translated).`);
} else {
  console.log(`i18n: ${pending.length} of ${en.size} English keys have no Spanish yet`);
  console.log('(missing keys fall back to English at runtime):');
  for (const key of pending) console.log(`  - ${key}`);
}

process.exit(0);
