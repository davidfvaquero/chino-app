/**
 * data-version.mjs — content hash of the data the service worker caches
 * cache-first (dictionary shards, Spanish shards, Spanish search index).
 *
 * The data cache used to have a fixed name, so a corrected shard never reached
 * a user who already had the old copy (REVIEW-3 I7). Stamping the cache name
 * with this hash rotates it exactly when the data changes, and leaves it alone
 * when only the code changed (which keeps REVIEW-2 I4: an app update must not
 * drop the downloaded dictionary).
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** What decides the version: every piece of data the service worker serves
 *  cache-first (see isImmutableData in sw.js) — the whole dictionary including
 *  its derived indices (`index-pinyin`, `index-hanzi*`), the Spanish shard set,
 *  the Spanish search index and the stroke data. */ 
const DATA_SOURCES = [
  ['dict', 'dir'],
  ['es/dict/shards', 'dir'],
  ['search-es', 'dir'],
  ['strokes', 'dir'],
];

/** 12-hex-char version of the cache-first data under `dataDir`. Throws when no
 *  cache-first data is found: a silent empty hash would pin every client to a
 *  build with no dictionary. */
export async function dataCacheVersion(dataDir) {
  const hash = createHash('sha256');
  let files = 0;
  for (const [rel, kind] of DATA_SOURCES) {
    if (kind === 'file') {
      try {
        hash.update(rel);
        hash.update(await readFile(join(dataDir, rel)));
        files += 1;
      } catch {
        // absent: contributes nothing
      }
      continue;
    }
    files += await hashTree(hash, dataDir, rel);
  }
  if (files === 0) throw new Error(`dataCacheVersion: no cache-first data under ${dataDir}`);
  return hash.digest('hex').slice(0, 12);
}

/** Every file under `dataDir/rel`, recursively, in a stable order. Returns how
 *  many files were hashed (0 when the directory is absent). */
async function hashTree(hash, dataDir, rel) {
  let entries;
  try {
    entries = await readdir(join(dataDir, rel), { withFileTypes: true });
  } catch {
    return 0; // absent: contributes nothing
  }
  let count = 0;
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      count += await hashTree(hash, dataDir, child);
      continue;
    }
    hash.update(child);
    hash.update(await readFile(join(dataDir, child)));
    count += 1;
  }
  return count;
}
