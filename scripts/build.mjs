/**
 * Build: copies the static site into dist/ (relative paths only, so it can be
 * served from any folder), generates manifest.webmanifest from en.json and
 * stamps sw.js with a content hash. No bundler: the browser loads the ES
 * modules as-is.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { manifestFromLocale } from './manifest.mjs';

const root = new URL('../', import.meta.url);
const dist = new URL('../dist/', import.meta.url);

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

// 4. manifest generated from the locale file (single source of truth for copy)
const locale = JSON.parse(await readFile(new URL('src/locales/en.json', root), 'utf8'));
await writeFile(
  new URL('manifest.webmanifest', dist),
  `${JSON.stringify(manifestFromLocale(locale, 'en'), null, 2)}\n`,
);

// 5. stamp sw.js with a content hash: every build rotates the caches, otherwise
// a changed asset would sit behind the already-installed service worker forever.
const hash = createHash('sha256');
for (const file of (await list(dist)).sort()) {
  hash.update(file);
  hash.update(await readFile(new URL(file, dist)));
}
const version = hash.digest('hex').slice(0, 12);
const swSource = await readFile(new URL('sw.js', root), 'utf8');
const swDist = swSource.replace("const VERSION = 'dev';", `const VERSION = '${version}';`);
if (swDist === swSource) throw new Error('build: could not stamp sw.js (VERSION marker missing)');
await writeFile(new URL('sw.js', dist), swDist);

// 6. sanity check: every file the service worker precaches must exist
const precached = [...swDist.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
const missing = [];
for (const rel of precached) {
  if (rel.endsWith('/')) continue;
  if (!(await exists(new URL(rel, dist)))) missing.push(rel);
}
if (missing.length > 0) {
  throw new Error(`build: service worker precaches missing files: ${missing.join(', ')}`);
}

const files = await list(dist);
console.log(`build: dist/ ready — ${files.length} files (sw version ${version})`);
for (const file of files.sort()) console.log(`  ${file}`);
