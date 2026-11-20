/**
 * src/sync/merge.js — pure merge logic for cross-device sync. No I/O, no DOM.
 *
 * A "record" (a blob) is one value of one store key:
 *   { store, key, value, updated_at, deleted? }
 * `updated_at` is epoch ms (0 = "never stamped locally": loses to any stamped
 * record). `deleted` is a tombstone: the key was removed on that device.
 *
 * Rule per key, last-writer-wins with two refinements:
 *  - srs cards (spaced repetition) keep the copy with the HIGHER `reviews`
 *    count, so a device with a skewed/future clock cannot wipe out real study
 *    work. Ties fall back to `updated_at`.
 *  - a deletion is just a write: the newest side wins, and on an exact tie the
 *    tombstone wins (never resurrect a key for free).
 *
 * Ties on `updated_at` are broken by the serialised value (tombstones first),
 * NOT by argument order: merge(a, b) and merge(b, a) return the same winner, so
 * two devices that edit at the same millisecond still converge.
 */

/** Stores that are synced. `meta` is device-local on purpose and never leaves. */
export const SYNC_STORES = ['srs', 'progress', 'gamification', 'settings'];

const SEP = '\u0000';
/** Stable identity of a blob across devices. */
export const recordKey = (record) => `${record.store}${SEP}${record.key}`;

const ts = (record) => record?.updated_at ?? 0;
const isDeleted = (record) => Boolean(record?.deleted);
const reviewsOf = (record) => {
  const value = record?.value;
  return value && typeof value === 'object' ? Number(value.reviews ?? 0) || 0 : 0;
};
/** Stable, argument-order-independent tie-break for equal timestamps. */
const stableValue = (record) => {
  try {
    return JSON.stringify(record?.value ?? null);
  } catch {
    return String(record?.value);
  }
};

/**
 * Winner of two versions of the SAME blob. Either side may be null/undefined
 * (record only exists on one device) — then the other one wins.
 */
export function mergeRecord(local, remote) {
  if (!local) return remote;
  if (!remote) return local;

  const localDeleted = isDeleted(local);
  const remoteDeleted = isDeleted(remote);

  if (localDeleted !== remoteDeleted) {
    const a = ts(local);
    const b = ts(remote);
    if (a !== b) return a > b ? local : remote;
    return localDeleted ? local : remote; // tie: the tombstone wins
  }

  // Both live srs cards: more reviews is the truth, clock skew or not.
  if (!localDeleted && local.store === 'srs' && remote.store === 'srs') {
    const lr = reviewsOf(local);
    const rr = reviewsOf(remote);
    if (lr !== rr) return lr > rr ? local : remote;
  }

  const a = ts(local);
  const b = ts(remote);
  if (a !== b) return a > b ? local : remote;
  // Exact tie (same millisecond): same answer on every device, both orders.
  if (localDeleted) return local; // identical tombstones
  return stableValue(local) >= stableValue(remote) ? local : remote;
}

/**
 * Merges two record lists (same or different keys) into the winning set.
 * Records present on only one side are kept as-is; the local side wins ties.
 */
export function mergeAll(local = [], remote = []) {
  const merged = new Map();
  for (const record of local) merged.set(recordKey(record), record);
  for (const record of remote) {
    const key = recordKey(record);
    merged.set(key, merged.has(key) ? mergeRecord(merged.get(key), record) : record);
  }
  return [...merged.values()];
}
