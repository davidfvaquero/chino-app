/**
 * Build: copies the static site into OUT_DIR (default dist/), merges the
 * per-module locale shards into one locales/<code>.json per language, generates
 * manifest.webmanifest from the merged en locale and stamps sw.js with a
 * content hash. No bundler: the browser loads the ES modules as-is.
 *
 * Parallel builds: `OUT_DIR=/tmp/x npm run build` writes only under that path,
 * so two builds with different OUT_DIRs never touch each other's files.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { manifestFromLocale } from './manifest.mjs';
import { listLocaleCodes, loadMergedLocale } from './build-locales.mjs';
import { buildIndex } from './build-dict-es-index.mjs';

const root = new URL('../', import.meta.url);
const outDir = resolve(process.env.OUT_DIR ?? fileURLToPath(new URL('../dist/', import.meta.url)));
const dist = pathToFileURL(`${outDir}/`);

const exists = async (url) => {
  try {
    await stat(url);
    return true;
  } catch {
    return false;
  }
};

const list = async (dir, prefix = '') => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...(await list(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)));
    } else {
      out.push(`${prefix}${entry.name}`);
    }
  }
  return out;
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// 1. shell entry points
await cp(new URL('index.html', root), new URL('index.html', dist));

// 2. app source (modules, styles, locales)
await cp(new URL('src/', root), new URL('src/', dist), { recursive: true });

// 3. static data & icons (public/ contents land at the dist root)
if (await exists(new URL('public/', root))) {
  await cp(new URL('public/', root), dist, { recursive: true });
}

// 3b. Spanish dictionary index: generated from the translated shards that were
//     just copied, and only when some exist. With none it is a no-op and the
//     Spanish search stays off. (Never precached — the shards load on demand.)
const esDictDir = resolve(outDir, 'data/es/dict');
if (await exists(`${esDictDir}/shards/`)) {
  const { shards, words, letters } = buildIndex(esDictDir);
  console.log(`build: dict-es index — ${shards} shards, ${words} words in ${letters} letters`);
}

// 4. merge every locale: <code>.json + <code>.d/*.json -> one <code>.json.
//    A key defined in two files throws here (build fails) instead of letting
//    one module silently overwrite another's text. The shards themselves are
//    dropped from the output: only the merged file is served.
const srcLocales = new URL('src/locales/', root);
const distLocales = new URL('src/locales/', dist);
const locales = new Map();
for (const code of await listLocaleCodes(srcLocales)) {
  const dict = await loadMergedLocale(srcLocales, code);
  locales.set(code, dict);
  await writeFile(new URL(`${code}.json`, distLocales), `${JSON.stringify(dict, null, 2)}\n`);
  await rm(new URL(`${code}.d/`, distLocales), { recursive: true, force: true });
}
console.log(`build: merged locales: ${[...locales.keys()].join(', ')}`);

// 5. manifest generated from the merged locale (single source of truth for copy)
const locale = locales.get('en') ?? {};
await writeFile(
  new URL('manifest.webmanifest', dist),
  `${JSON.stringify(manifestFromLocale(locale, 'en'), null, 2)}\n`,
);

// 6. stamp sw.js with a content hash: every build rotates the caches, otherwise
// a changed asset would sit behind the already-installed service worker forever.
const hash = createHash('sha256');
for (const file of (await list(dist)).sort()) {
  hash.update(file);
  hash.update(await readFile(new URL(file, dist)));
}
const version = hash.digest('hex').slice(0, 12);
// Precache the shell AND the lesson/content index: entry points + every
// module/style/icon/font under src/ (and icons/, fonts/) plus the lesson JSON
// and files.json the hubs load on a cold visit. Without them, #/learn/tones and
// #/learn/lessons/* showed "Failed to fetch" offline. (~0.5 MB; other data
// stays in the runtime stale-while-revalidate cache.)
const shellAssets = [
  './',
  'index.html',
  'manifest.webmanifest',
  ...(await list(dist)).filter((f) => /^(src|icons|fonts)\/|^data\/(es\/)?lessons\/|^data\/(es\/)?files\.json$|^data\/manifest\.json$/.test(f)),
];
const swSource = await readFile(new URL('sw.js', root), 'utf8');
const swStamped = swSource.replace("const VERSION = 'dev';", `const VERSION = '${version}';`);
if (swStamped === swSource) throw new Error('build: could not stamp sw.js (VERSION marker missing)');
const swDist = swStamped.replace(
  /const SHELL_ASSETS = \[[\s\S]*?\];/,
  `const SHELL_ASSETS = [\n${shellAssets.map((a) => `  '${a}',`).join('\n')}\n];`,
);
if (swDist === swStamped) throw new Error('build: could not inject SHELL_ASSETS into sw.js');
await writeFile(new URL('sw.js', dist), swDist);

const files = await list(dist);
console.log(`build: ${outDir} ready — ${files.length} files (sw version ${version})`);
