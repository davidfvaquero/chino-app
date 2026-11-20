/**
 * backup.js — pure logic for backing up / restoring ALL app data.
 * No DOM, no UI, no direct storage access: everything goes through
 * src/storage.js (list/get/set/remove), so it runs in Node.
 *
 *   exportAll(storage?)                -> { app, version, exportedAt, stores }
 *   validate(obj)                      -> { ok, error? }        (strict)
 *   importAll(obj, { mode }, storage?) -> { imported, skipped }
 *
 * `stores` holds one plain object { key: value } per store
 * (meta, settings, srs, progress, gamification).
 *
 * importAll validates the WHOLE object first and only then writes; if a write
 * fails it undoes the ones already applied, so a bad file never leaves the app
 * half-imported.
 *
 * Merge mode keeps, per key, the value with the newer timestamp
 * (lastReviewed | addedAt | unlockedAt | updatedAt); without a clock the local
 * value wins.
 */
import storage, { STORES } from './storage.js';

export const APP_NAME = 'chino-app';
/** Bump when the exported shape changes; older files are then rejected. */
export const EXPORT_VERSION = 1;
export { STORES as BACKUP_STORES };

/** Keys that must never leave the device (secrets / device session). */
const PRIVATE = { meta: new Set(['openrouterKey', 'syncSession', 'syncState']) };
const isPrivate = (store, key) => PRIVATE[store]?.has(key) ?? false;

/** Read one store into a plain { key: value } object (private keys excluded). */
async function readStore(store, db) {
  const out = {};
  for (const { key, value } of await db.list(store)) {
    if (isPrivate(store, key)) continue;
    out[key] = value;
  }
  return out;
}

/** Everything the app persists, as one JSON-serializable object. */
export async function exportAll(db = storage) {
  const stores = {};
  for (const store of STORES) stores[store] = await readStore(store, db);
  return { app: APP_NAME, version: EXPORT_VERSION, exportedAt: Date.now(), stores };
}

/** Rejects anything that is not a well-formed export (strict, no coercion). */
export function validate(obj) {
  const fail = (error) => ({ ok: false, error });
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail('export.invalidType');
  if (obj.app !== APP_NAME) return fail('export.wrongApp');
  if (obj.version !== EXPORT_VERSION) return fail('export.unknownVersion');
  if (typeof obj.exportedAt !== 'number' || !(obj.exportedAt > 0)) return fail('export.badTimestamp');
  if (!obj.stores || typeof obj.stores !== 'object' || Array.isArray(obj.stores)) {
    return fail('export.missingStores');
  }
  for (const [name, data] of Object.entries(obj.stores)) {
    if (!STORES.includes(name)) return fail('export.unknownStore');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('export.storeNotObject');
    for (const value of Object.values(data)) {
      try {
        if (JSON.stringify(value) === undefined) return fail('export.nonSerializableValue');
      } catch {
        return fail('export.nonSerializableValue');
      }
    }
  }
  return { ok: true };
}

/** The clock a stored value carries; null when it has none. */
function stamp(value) {
  if (!value || typeof value !== 'object') return null;
  for (const field of ['lastReviewed', 'addedAt', 'unlockedAt', 'updatedAt']) {
    if (typeof value[field] === 'number') return value[field];
  }
  return null;
}

/** Which of two values for the same key survives a merge. */
function newer(existing, incoming) {
  const a = stamp(existing);
  const b = stamp(incoming);
  if (a === null || b === null) return existing; // no clock: keep local data
  return b > a ? incoming : existing;
}

/**
 * Import a validated export.
 * @param {object} obj export object
 * @param {{mode?: 'replace'|'merge'}} [options] replace wipes the matching stores
 * @param {object} [db] storage instance (tests pass an in-memory one)
 */
export async function importAll(obj, { mode = 'replace' } = {}, db = storage) {
  if (mode !== 'replace' && mode !== 'merge') throw new Error('import.badMode');
  const check = validate(obj);
  if (!check.ok) throw new Error(check.error);

  // Plan every write BEFORE touching storage.
  const writes = []; // { store, key, value? , remove? }
  let imported = 0;
  let skipped = 0;

  for (const store of STORES) {
    const incoming = obj.stores[store] ?? {};
    if (mode === 'replace') {
      const keep = new Set(Object.keys(incoming));
      for (const { key } of await db.list(store)) {
        if (!keep.has(key) && !isPrivate(store, key)) writes.push({ store, key, remove: true });
      }
      for (const [key, value] of Object.entries(incoming)) {
        if (isPrivate(store, key)) continue;
        writes.push({ store, key, value });
        imported += 1;
      }
    } else {
      for (const [key, value] of Object.entries(incoming)) {
        if (isPrivate(store, key)) continue;
        const existing = await db.get(store, key);
        if (existing === undefined || newer(existing, value) === value) {
          writes.push({ store, key, value });
          imported += 1;
        } else {
          skipped += 1;
        }
      }
    }
  }

  // Apply, remembering the previous value so a failure can be undone.
  const applied = [];
  try {
    for (const write of writes) {
      applied.push({ store: write.store, key: write.key, previous: await db.get(write.store, write.key) });
      if (write.remove) await db.remove(write.store, write.key);
      else await db.set(write.store, write.key, write.value);
    }
  } catch (err) {
    for (let i = applied.length - 1; i >= 0; i -= 1) {
      const { store, key, previous } = applied[i];
      try {
        if (previous === undefined) await db.remove(store, key);
        else await db.set(store, key, previous);
      } catch {
        /* best effort: keep unwinding */
      }
    }
    throw err;
  }

  return { imported, skipped };
}
