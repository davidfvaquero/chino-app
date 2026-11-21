/**
 * src/sync/client.js — optional cross-device sync over Supabase's REST + Auth
 * API using plain `fetch` (no SDK, no npm dependency).
 *
 * Everything is opt-in: with src/sync/config.js empty, every entry point
 * returns { ok:false, reason:'not-configured' } BEFORE calling `fetch`, so the
 * app stays 100% local and makes zero sync requests.
 *
 * Model
 *  - Stores synced: srs, progress, gamification, settings (never `meta`).
 *  - Server table `sync_blobs(user_id, store, key, value jsonb, updated_at,
 *    deleted)` with Row Level Security (deploy/supabase-schema.sql). `user_id`
 *    defaults to auth.uid() server-side, so a client can only ever touch its
 *    own rows.
 *  - Push = upsert the whole local state of those stores (ponytail: full-state
 *    push — a few hundred small rows; switch to dirty-only if it ever hurts).
 *  - Pull = fetch every remote row, merge per key (src/sync/merge.js) and apply
 *    the winners locally. Called on open.
 *  - Offline: a failed request never throws; the change stays in the local
 *    queue (state.queue) and is re-sent on the next syncNow().
 *  - Login = email OTP (one-time code). The session token is kept in the local
 *    `meta` store, never synced.
 *
 * createSync({ fetch, storage, now, config }) binds every dependency so the
 * whole client is testable with a fake fetch and an in-memory storage.
 */
import storage, { onWrite } from '../storage.js';
import { SYNC_CONFIG, isConfigured } from './config.js';
import { SYNC_STORES, mergeAll } from './merge.js';
import { isSecret } from '../secrets.js';

export { SYNC_STORES };

export const SESSION_KEY = 'syncSession';
export const STATE_KEY = 'syncState';
export const TABLE = 'sync_blobs';
/** Separator for the internal "store<SEP>key" index. Cannot appear in a key. */
export const SEP = '\u0000';

const idOf = (store, key) => `${store}${SEP}${key}`;
const emptyState = () => ({ updatedAt: {}, deleted: {}, lastSync: null, queue: [] });
const NOT_CONFIGURED = { ok: false, reason: 'not-configured' };

export function createSync({
  fetch: fetchImpl = globalThis.fetch,
  storage: store = storage,
  now = () => Date.now(),
  config = SYNC_CONFIG,
} = {}) {
  /** Suppresses the write hook while we are applying pulled data. */
  let applying = false;
  /**
   * Every read-modify-write of `syncState` runs through this one promise chain,
   * so two concurrent enqueue/push/pull calls can never load the same state and
   * save over each other's change (docs/REVIEW-2.md I17).
   */
  let stateChain = Promise.resolve();
  const mutate = (fn) => {
    const run = stateChain.then(async () => {
      const state = await loadState();
      const out = await fn(state);
      await saveState(state);
      return out;
    });
    // Keep the chain alive even if this step rejects.
    stateChain = run.then(() => undefined, () => undefined);
    return run;
  };
  /** Debounced push after a local write (I17): one sync a few seconds later. */
  let pushTimer = null;
  const PUSH_DEBOUNCE_MS = 5000;
  function schedulePush() {
    if (!configured() || typeof setTimeout !== 'function') return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      syncNow().catch(() => {});
    }, PUSH_DEBOUNCE_MS);
    // Do not let the debounce timer keep a Node process (tests) alive.
    pushTimer?.unref?.();
  }

  const configured = () => isConfigured(config);
  const base = () => String(config.url ?? '').replace(/\/+$/, '');
  const authHeaders = (token) => ({
    apikey: config.anonKey,
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  const loadState = async () => (await store.get('meta', STATE_KEY)) ?? emptyState();
  const saveState = (state) => store.set('meta', STATE_KEY, state);
  const getSession = async () => (await store.get('meta', SESSION_KEY)) ?? null;
  const setSession = (session) => store.set('meta', SESSION_KEY, session);

  /** Refreshes an expired access token once. Returns the new session or null. */
  async function refreshSession(session) {
    if (!session?.refresh_token) return null;
    try {
      const res = await fetchImpl(`${base()}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.access_token) return null;
      const next = {
        ...session,
        access_token: data.access_token,
        refresh_token: data.refresh_token ?? session.refresh_token,
      };
      await setSession(next);
      return next;
    } catch {
      return null;
    }
  }

  /**
   * fetch with the current token, retrying once after a 401 with the stored
   * refresh_token (Supabase access tokens expire after an hour). Never throws
   * on 401/expiry; network errors still propagate to the caller's try/catch.
   */
  async function authedFetch(url, options = {}) {
    const session = await getSession();
    if (!session?.access_token) return { ok: false, reason: 'not-signed-in' };
    const send = (token) =>
      fetchImpl(url, {
        ...options,
        headers: { ...authHeaders(token), ...(options.headers ?? {}) },
      });
    let res = await send(session.access_token);
    if (res.status === 401) {
      const refreshed = await refreshSession(session);
      if (!refreshed) return { ok: false, reason: 'unauthorized', response: res };
      res = await send(refreshed.access_token);
    }
    return { ok: true, response: res };
  }

  /** Local records of the synced stores (+ tombstones). `stamp` fills in
   * updated_at for keys never written since sync was enabled. */
  async function collectLocal(state, stamp = false) {
    const out = [];
    for (const name of SYNC_STORES) {
      for (const { key, value } of await store.list(name)) {
        // Secrets (e.g. the legacy OpenRouter key in `settings`) never sync.
        if (isSecret(name, key)) continue;
        const id = idOf(name, key);
        let updated = state.updatedAt[id] ?? 0;
        if (stamp && updated === 0) {
          updated = now();
          state.updatedAt[id] = updated;
        }
        delete state.deleted[id];
        out.push({ store: name, key, value, updated_at: updated, deleted: false });
      }
    }
    for (const [id, updated] of Object.entries(state.deleted)) {
      const [name, key] = id.split(SEP);
      if (!SYNC_STORES.includes(name) || state.updatedAt[id] !== undefined) continue;
      out.push({ store: name, key, value: null, updated_at: updated, deleted: true });
    }
    return out;
  }

  // ---- auth (email OTP) -------------------------------------------------

  async function signInWithOtp(email) {
    if (!configured()) return NOT_CONFIGURED;
    try {
      const res = await fetchImpl(`${base()}/auth/v1/otp`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ email, create_user: true }),
      });
      if (!res.ok) return { ok: false, reason: 'http', status: res.status };
    } catch (error) {
      return { ok: false, reason: 'offline', error };
    }
    return { ok: true };
  }

  async function verifyOtp(email, token) {
    if (!configured()) return NOT_CONFIGURED;
    let data;
    try {
      const res = await fetchImpl(`${base()}/auth/v1/verify`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ type: 'email', email, token }),
      });
      if (!res.ok) return { ok: false, reason: 'http', status: res.status };
      data = await res.json();
    } catch (error) {
      return { ok: false, reason: 'offline', error };
    }
    await setSession({
      access_token: data.access_token ?? null,
      refresh_token: data.refresh_token ?? null,
      user: data.user ?? null,
      email,
    });
    return { ok: true, user: data.user ?? null };
  }

  async function signOut() {
    const session = await getSession();
    if (session?.access_token && configured()) {
      try {
        await fetchImpl(`${base()}/auth/v1/logout`, {
          method: 'POST',
          headers: authHeaders(session.access_token),
        });
      } catch {
        /* best effort: clearing the local session is what matters */
      }
    }
    await store.remove('meta', SESSION_KEY);
    return { ok: true };
  }

  // ---- sync -------------------------------------------------------------

  /** Uploads the local state of the synced stores. Never throws. */
  async function push() {
    if (!configured()) return NOT_CONFIGURED;
    const session = await getSession();
    if (!session?.access_token) return { ok: false, reason: 'not-signed-in' };

    // 1. Prepare the batch inside the state chain (fast, no network). The stamp
    //    sent per id is remembered so a write that lands while the request is in
    //    flight is not dequeued (REVIEW-2 I17).
    const prepared = await mutate(async (state) => {
      const collected = await collectLocal(state, true);
      const rows = collected.map((record) => ({
        store: record.store,
        key: record.key,
        value: record.value,
        deleted: record.deleted,
        updated_at: new Date(record.updated_at).toISOString(),
      }));
      const sentStamps = new Map(collected.map((record) => [idOf(record.store, record.key), record.updated_at]));
      return { rows, sentStamps };
    });

    if (!prepared.rows.length) {
      await mutate(async (state) => { state.lastSync = now(); });
      return { ok: true, pushed: 0 };
    }

    // 2. The request goes OUTSIDE the state chain: a local write (enqueue) must
    //    never wait for the network (REVIEW-3 I12). `return=representation` makes
    //    the server send back the stored rows, whose updated_at is already capped.
    let saved = null;
    try {
      const sent = await authedFetch(`${base()}/rest/v1/${TABLE}`, {
        method: 'POST',
        headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify(prepared.rows),
      });
      if (!sent.ok) return sent;
      if (!sent.response.ok) return { ok: false, reason: 'http', status: sent.response.status };
      saved = await sent.response.json().catch(() => null);
    } catch (error) {
      return { ok: false, reason: 'offline', error };
    }

    // 3. Dequeue only the ids whose stamp is still the one we sent, and adopt the
    //    server's stamp so a skewed local clock cannot keep pushing a future
    //    timestamp (REVIEW-3 I11).
    return mutate(async (state) => {
      const returned = new Map();
      if (Array.isArray(saved)) {
        for (const row of saved) {
          if (!row || row.store == null || row.key == null) continue;
          const at = row.updated_at ? Date.parse(row.updated_at) : 0;
          if (at) returned.set(idOf(row.store, row.key), at);
        }
      }
      state.queue = state.queue.filter((item) => {
        const id = idOf(item.store, item.key);
        if (!prepared.sentStamps.has(id)) return true;
        return prepared.sentStamps.get(id) !== state.updatedAt[id];
      });
      for (const [id, at] of returned) {
        // Adopt the server stamp only when it PULLED OURS BACK (the clock cap):
        // then a skewed local clock must not keep pushing a future timestamp
        // (REVIEW-3 I11). A plain stale push returns a newer stamp, and adopting
        // it without its value would fake a fresh local edit.
        if (state.updatedAt[id] === prepared.sentStamps.get(id) && at < prepared.sentStamps.get(id)) {
          state.updatedAt[id] = at;
        }
      }
      state.lastSync = now();
      return { ok: true, pushed: prepared.rows.length };
    });
  }

  /** Fetches the remote rows, merges and applies the winners locally. */
  async function pull() {
    if (!configured()) return NOT_CONFIGURED;

    let remote;
    try {
      const sent = await authedFetch(
        `${base()}/rest/v1/${TABLE}?select=store,key,value,updated_at,deleted`,
      );
      if (!sent.ok) return sent;
      if (!sent.response.ok) return { ok: false, reason: 'http', status: sent.response.status };
      remote = await sent.response.json();
    } catch (error) {
      return { ok: false, reason: 'offline', error };
    }

    const localById = new Map();
    const remoteById = new Map();

    const rows = (Array.isArray(remote) ? remote : [])
      .filter((row) => SYNC_STORES.includes(row?.store))
      .filter((row) => !isSecret(row.store, row.key))
      .map((row) => ({
        store: row.store,
        key: row.key,
        value: row.value,
        updated_at: row.updated_at ? Date.parse(row.updated_at) : 0,
        deleted: Boolean(row.deleted),
      }));
    for (const row of rows) remoteById.set(idOf(row.store, row.key), row);

    return mutate(async (state) => {
      const local = await collectLocal(state);
      for (const record of local) localById.set(idOf(record.store, record.key), record);
      const merged = mergeAll(local, rows);

      applying = true;
      let applied = 0;
      try {
        for (const record of merged) {
          const id = idOf(record.store, record.key);
          const previous = localById.get(id);
          const remoteRow = remoteById.get(id);
          if (record.deleted) {
            if (previous) {
              await store.remove(record.store, record.key);
              applied += 1;
            }
            delete state.updatedAt[id];
            state.deleted[id] = record.updated_at;
          } else {
            if (!previous || JSON.stringify(previous.value) !== JSON.stringify(record.value)) {
              await store.set(record.store, record.key, record.value);
              applied += 1;
            }
            // A record only we have gets a fresh stamp so the next push carries it.
            let stamp = record.updated_at === 0 ? now() : record.updated_at;
            // If our copy won but the server row is NEWER (e.g. an srs card with
            // more reviews and an older clock), restamp past it so the next push
            // is not dropped by the keep-newer trigger (docs/REVIEW-2.md I17).
            if (previous && remoteRow && record.updated_at < remoteRow.updated_at) {
              stamp = Math.max(now(), remoteRow.updated_at + 1);
            }
            state.updatedAt[id] = stamp;
            delete state.deleted[id];
          }
        }
      } finally {
        applying = false;
      }

      state.lastSync = now();
      return { ok: true, applied, total: merged.length };
    });
  }

  /** Pull remote changes and merge them locally, THEN push the merged state.
   * Pull-first is what stops a device with an old local copy from overwriting a
   * newer remote row on every sync. */
  async function syncNow() {
    const pulled = await pull();
    if (!pulled.ok) return pulled;
    const pushed = await push();
    if (!pushed.ok) return pushed;
    return { ok: true, pulled: pulled.applied, pushed: pushed.pushed };
  }

  /** Records a local write in the offline queue (called by the write hook). */
  async function enqueue(change) {
    if (!configured() || applying) return NOT_CONFIGURED;
    if (!SYNC_STORES.includes(change?.store)) return { ok: false, reason: 'store-not-synced' };
    const pending = await mutate((state) => {
      const id = idOf(change.store, change.key);
      state.updatedAt[id] = now();
      delete state.deleted[id];
      state.queue = state.queue.filter((item) => idOf(item.store, item.key) !== id);
      state.queue.push({ store: change.store, key: change.key, value: change.value });
      return state.queue.length;
    });
    schedulePush();
    return { ok: true, pending };
  }

  /** Records a local deletion (tombstone) so it propagates to other devices. */
  async function enqueueDelete(name, key) {
    if (!configured() || applying) return NOT_CONFIGURED;
    if (!SYNC_STORES.includes(name)) return { ok: false, reason: 'store-not-synced' };
    const pending = await mutate((state) => {
      const id = idOf(name, key);
      delete state.updatedAt[id];
      state.deleted[id] = now();
      state.queue = state.queue.filter((item) => idOf(item.store, item.key) !== id);
      state.queue.push({ store: name, key, deleted: true });
      return state.queue.length;
    });
    schedulePush();
    return { ok: true, pending };
  }

  /** Deletes every synced row this user owns on the server (RLS scopes it). */
  async function deleteRemoteData() {
    if (!configured()) return NOT_CONFIGURED;
    try {
      const sent = await authedFetch(`${base()}/rest/v1/${TABLE}?store=not.is.null`, {
        method: 'DELETE',
      });
      if (!sent.ok) return sent;
      if (!sent.response.ok) return { ok: false, reason: 'http', status: sent.response.status };
    } catch (error) {
      return { ok: false, reason: 'offline', error };
    }
    return { ok: true };
  }

  const pending = async () => (await loadState()).queue.length;
  const lastSync = async () => (await loadState()).lastSync;

  /** Mirrors every local write/deletion of a synced store into the queue. */
  function attach() {
    const subscribe = store.onWrite ?? onWrite;
    return subscribe((change) => {
      if (applying || !SYNC_STORES.includes(change.store)) return undefined;
      return change.deleted
        ? enqueueDelete(change.store, change.key)
        : enqueue(change);
    });
  }

  return {
    isConfigured: configured,
    signInWithOtp,
    verifyOtp,
    signOut,
    getSession,
    push,
    pull,
    syncNow,
    enqueue,
    enqueueDelete,
    deleteRemoteData,
    pending,
    lastSync,
    attach,
  };
}

/** App-wide instance (global storage + global fetch + the bundled config). */
export const sync = createSync();
