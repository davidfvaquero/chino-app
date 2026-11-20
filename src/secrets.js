/**
 * Secrets that must never leave the device: no backup, no sync upload, and
 * never accepted from a sync pull. `meta` is device-local as a whole; the
 * legacy `settings/openrouterKey` is filtered too because an old device may
 * still hold the key there.
 */
export const SECRET_STORES = new Set(['meta']);
export const SECRET_KEYS = { settings: new Set(['openrouterKey']) };

export const isSecret = (store, key) =>
  SECRET_STORES.has(store) || (SECRET_KEYS[store]?.has(key) ?? false);

/**
 * Move the legacy `settings.openrouterKey` to `meta.openrouterKey` (device
 * local). Runs at boot, before sync attaches, so no device keeps the key in a
 * synced store.
 */
export async function migrateSecrets(storage) {
  const legacy = await storage.get('settings', 'openrouterKey');
  if (legacy === undefined) return;
  const current = await storage.get('meta', 'openrouterKey');
  if (current === undefined) await storage.set('meta', 'openrouterKey', legacy);
  await storage.remove('settings', 'openrouterKey');
}