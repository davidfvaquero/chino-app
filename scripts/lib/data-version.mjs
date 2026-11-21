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

/** What decides the version: a dict manifest (changes when the dict is rebuilt),
 *  the Spanish shards and the Spanish search index. */
const DATA_SOURCES = [
  ['dict/manifest.json', 'file'],
  ['es/dict/shards', 'dir'],
  ['search-es', 'dir'],
];

/** 12-hex-char version of the cache-first data under `dataDir`. */
export async function dataCacheVersion(dataDir) {
  const hash = createHash('sha256');
  for (const [rel, kind] of DATA_SOURCES) {
    const target = join(dataDir, rel);
    if (kind === 'file') {
      try {
        hash.update(rel);
        hash.update(await readFile(target));
      } catch {
        // absent: contributes nothing
      }
      continue;
    }
    let names;
    try {
      names = (await readdir(target)).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      hash.update(`${rel}/${name}`);
      hash.update(await readFile(join(target, name)));
    }
  }
  return hash.digest('hex').slice(0, 12);
}
