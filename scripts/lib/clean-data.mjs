// Remove only the outputs that scripts/build-data.mjs itself generates.
// public/data also holds hand-made and LLM-translated content (es/dict,
// lessons, readings, themes, grammar, radicals, etymology, achievements…)
// that this script cannot regenerate, so a full rmSync of public/data would
// destroy it.
import fs from 'node:fs';
import path from 'node:path';

/** Directories written by build-data.mjs. */
export const GENERATED_DIRS = ['dict', 'strokes', 'sentences', 'hsk'];
/** Files written by build-data.mjs. */
export const GENERATED_FILES = ['manifest.json', 'files.json'];

/** Delete the generated outputs under `out`, leaving everything else intact. */
export function cleanGenerated(out) {
  for (const dir of GENERATED_DIRS) {
    fs.rmSync(path.join(out, dir), { recursive: true, force: true });
  }
  for (const file of GENERATED_FILES) {
    fs.rmSync(path.join(out, file), { force: true });
  }
}