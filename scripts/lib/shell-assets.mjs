/**
 * shell-assets.mjs — which built files go into the service-worker precache.
 *
 * The shell (index + code + styles + icons + fonts) and the small content index
 * (lesson JSON + files.json + manifest.json) are precached so a cold visit works
 * offline; the big data (dictionary, strokes, sentences per locale) is NOT (it
 * loads on demand into the runtime cache). Extracted from scripts/build.mjs so a
 * test can pin it (docs/REVIEW-2.md I19, REVIEW #7: #/learn/lessons/* showed
 * "Failed to fetch" offline when the lessons were missing from the precache).
 */
export const SHELL_ASSET_RE = /^(src|icons|fonts)\/|^data\/(es\/)?lessons\/|^data\/(es\/)?(readings|themes|grammar|plan)\/|^data\/(achievements|pinyin-chart)\.json$|^data\/(es\/)?files\.json$|^data\/manifest\.json$/;

/** True for a file (dist-relative path) that belongs in the SW precache. */
export function isShellAsset(file) {
  return SHELL_ASSET_RE.test(String(file));
}
