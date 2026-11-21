/**
 * Secrets that must never leave the device: no backup, no sync upload, and
 * never accepted from a sync pull. `meta` is device-local as a whole; the
 * legacy `settings/openrouterKey` and `settings/conversationHistory` are
 * filtered too because an old device may still hold them there.
 */
export const SECRET_KEYS = {
  meta: new Set(['openrouterKey', 'syncSession', 'syncState', 'conversationHistory']),
  settings: new Set(['openrouterKey', 'conversationHistory']),
};

export const isSecret = (store, key) => SECRET_KEYS[store]?.has(key) ?? false;

/**
 * Move the device-local values out of the synced `settings` store (the legacy
 * `openrouterKey` and the conversation history) into `meta`. Runs at boot,
 * before sync attaches, so no device keeps them in a synced store. Returns the
 * keys it removed from `settings`, so the caller can tombstone their server
 * rows once sync is attached.
 */
export async function migrateSecrets(storage) {
  const moved = [];
  for (const key of ['openrouterKey', 'conversationHistory']) {
    const legacy = await storage.get('settings', key);
    if (legacy === undefined) continue;
    const current = await storage.get('meta', key);
    if (current === undefined) await storage.set('meta', key, legacy);
    await storage.remove('settings', key);
    moved.push(key);
  }
  return moved;
}

/**
 * Move the legacy secrets out of `settings` and tombstone the server rows they
 * left behind, so a later pull cannot bring them back into a synced store.
 * Called once at boot (src/main.js), before sync attaches; kept as one seam so
 * the sync regression test drives the same wiring the shell does.
 */
export async function retireLegacySecrets(storage, sync) {
  const moved = await migrateSecrets(storage);
  for (const key of moved) await sync.enqueueDelete('settings', key);
  return moved;
}