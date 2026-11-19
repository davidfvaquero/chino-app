/**
 * src/sync/config.js — the ONLY place sync settings live.
 *
 * Sync is OPTIONAL and OFF by default: both values are empty strings, so the
 * app never makes a sync request (see src/sync/client.js — every entry point
 * short-circuits with { ok:false, reason:'not-configured' } before touching
 * `fetch`). The Account screen shows "Sync is not configured" and nothing else.
 *
 * To turn sync on, fill these in with the values of YOUR Supabase project
 * (docs/SYNC.md has the exact steps):
 *
 *   export const SUPABASE_URL = 'https://<project-ref>.supabase.co';
 *   export const ANON_KEY = '<the public anon key>';
 *
 * Both are PUBLIC and safe to commit — they ship in the browser bundle no
 * matter what. NEVER put the `service_role` key (or any other secret) here or
 * anywhere else in this repo. Data is protected by Row Level Security, not by
 * hiding the anon key.
 */

/** Supabase project URL, e.g. 'https://abcdefgh.supabase.co'. Empty = sync off. */
export const SUPABASE_URL = '';
/** Supabase public `anon` key. Empty = sync off. */
export const ANON_KEY = '';

/** Bundled configuration object (pass a copy to createSync() in tests). */
export const SYNC_CONFIG = { url: SUPABASE_URL, anonKey: ANON_KEY };

/** True when a URL and an anon key are both set. */
export function isConfigured(config = SYNC_CONFIG) {
  return Boolean(config && config.url && config.anonKey);
}
