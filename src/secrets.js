/**
 * Secrets that must never leave the device: no backup, no sync upload, and
 * never accepted from a sync pull. `meta` is device-local as a whole; the
 * legacy `settings/openrouterKey` is filtered too because an old device may
 * still hold the key there.
 */
export const SECRET_KEYS = {
  meta: new Set(['openrouterKey', 'syncSession', 'syncState', 'conversationHistory']),
  settings: new Set(['openrouterKey']),
};

export const isSecret = (store, key) => SECRET_KEYS[store]?.has(key) ?? false;

/**
 * Move the device-local values out of the synced `settings` store (the legacy
 * `openrouterKey` and the conversation history) into `meta`. Runs at boot,
 * before sync attaches, so no device keeps them in a synced store.
 */
export async function migrateSecrets(storage) {
  for (const key of ['openrouterKey', 'conversationHistory']) {
    const legacy = await storage.get('settings', key);
    if (legacy === undefined) continue;
    const current = await storage.get('meta', key);
    if (current === undefined) await storage.set('meta', key, legacy);
    await storage.remove('settings', key);
  }
}