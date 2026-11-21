/**
 * sync-convergence.test.mjs — two real sync clients against one in-memory fake
 * Supabase server. Covers the REVIEW #17 failures: a stale device overwriting a
 * newer one, deletions not propagating, reconnect and idempotency.
 *
 * Run: node --test tests/sync-convergence.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDriver, createStorage } from '../src/storage.js';
import { createSync } from '../src/sync/client.js';

const CONFIG = { url: 'https://demo.supabase.co', anonKey: 'public-anon-key' };
const SEP = '\u0000';
const idOf = (store, key) => `${store}${SEP}${key}`;

/** In-memory stand-in for Supabase: auth, upsert, list and scoped delete. */
function createServer({ now = () => Date.now() } = {}) {
  const rows = new Map();
  const requests = [];
  const respond = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });
  const server = { rows, requests, onGet: null, onPost: null, fetchFor: null, now };
  // BEFORE UPDATE trigger cap (deploy/supabase-schema.sql, REVIEW-2 I17).
  const FUTURE_CAP_MS = 5 * 60 * 1000;

  const fetchFor = (label) => async (url, options = {}) => {
    const u = new URL(url);
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ label, method, path: u.pathname, search: u.search, headers: options.headers ?? {}, body });
    if (u.pathname === '/auth/v1/verify') {
      return respond({ access_token: `T-${label}`, refresh_token: `R-${label}`, user: { id: 'u1' } });
    }
    if (u.pathname === '/auth/v1/token') {
      return respond({ access_token: `T-${label}-new`, refresh_token: `R-${label}-new` });
    }
    if (u.pathname === '/auth/v1/otp' || u.pathname === '/auth/v1/logout') return respond({});
    if (u.pathname !== '/rest/v1/sync_blobs') return respond({}, 404);

    if (method === 'POST') {
      // An upsert that conflicts becomes an UPDATE, and the BEFORE UPDATE
      // trigger on sync_blobs keeps the row with the NEWER updated_at — a stale
      // device cannot overwrite a newer server row (deploy/supabase-schema.sql).
      // A clock more than 5 minutes ahead is capped, so a skewed clock cannot
      // block a row for long (REVIEW-2 I17).
      for (const row of body) {
        const key = idOf(row.store, row.key);
        const prev = rows.get(key);
        let stamp = Date.parse(row.updated_at);
        if (stamp > now() + FUTURE_CAP_MS) stamp = now() + FUTURE_CAP_MS;
        if (prev && stamp < Date.parse(prev.updated_at)) continue;
        rows.set(key, { ...row, updated_at: new Date(stamp).toISOString(), user_id: 'u1' });
      }
      if (server.onPost) await server.onPost(label);
      return respond({}, 201);
    }
    if (method === 'DELETE') {
      rows.clear();
      return respond({});
    }
    // GET: snapshot the rows first, then let a test interleave a concurrent
    // write (the race window between this client's pull and its push).
    const snapshot = [...rows.values()].map((row) => ({ ...row }));
    const res = respond(snapshot);
    if (server.onGet) await server.onGet(label);
    return res;
  };

  server.fetchFor = fetchFor;
  return server;
}

function makeClient(server, label, startAt = 1000, gate = { offline: false }) {
  const clock = { t: startAt };
  const store = createStorage(memoryDriver());
  const fetchImpl = async (url, options = {}) => {
    if (gate.offline) throw new TypeError('Failed to fetch');
    return server.fetchFor(label)(url, options);
  };
  const sync = createSync({
    fetch: fetchImpl,
    storage: store,
    now: () => clock.t,
    config: CONFIG,
  });
  return { label, clock, store, sync, gate, attach: () => sync.attach() };
}

async function ready(server, label, startAt, gate) {
  const client = makeClient(server, label, startAt, gate);
  await client.sync.verifyOtp('me@example.com', '123456');
  client.attach();
  return client;
}

// --------------------------------------------------------------------------
// REVIEW #17 (a)+(b): every write must be queued and a stale device must not
// overwrite a newer remote value (pull -> merge -> push, not push -> pull).
// --------------------------------------------------------------------------

test('two devices: an edit on A reaches B (pull before push)', async () => {
  const server = createServer();
  const A = await ready(server, 'A', 1000);
  const B = await ready(server, 'B', 2000);

  await A.store.set('settings', 'theme', 'dark');
  assert.equal(await A.sync.pending(), 1, 'the write hook queued the change');

  assert.equal((await A.sync.syncNow()).ok, true);
  assert.equal((await B.sync.syncNow()).ok, true);
  assert.equal(await B.store.get('settings', 'theme'), 'dark');
});

test('concurrent edits of the same key converge to the newer timestamp', async () => {
  const server = createServer();
  const A = await ready(server, 'A', 1000);
  const B = await ready(server, 'B', 2000);

  await A.store.set('settings', 'theme', 'light'); // A stamp 1000
  await B.store.set('settings', 'theme', 'dark'); // B stamp 2000

  assert.equal((await A.sync.syncNow()).ok, true);
  assert.equal((await B.sync.syncNow()).ok, true);
  // A had already pushed its older row; a second sync on A must pull B's newer
  // row instead of pushing its stale copy again.
  assert.equal((await A.sync.syncNow()).ok, true);

  assert.equal(await A.store.get('settings', 'theme'), 'dark');
  assert.equal(await B.store.get('settings', 'theme'), 'dark');
  assert.equal(server.rows.get(idOf('settings', 'theme')).value, 'dark');
});

test('a write landing between A pull and A push is not lost (trigger keeps newer row)', async () => {
  const server = createServer();
  const A = await ready(server, 'A', 1000);
  const B = await ready(server, 'B', 2000);

  await A.store.set('settings', 'theme', 'light'); // A stamp 1000
  assert.equal((await A.sync.syncNow()).ok, true);
  assert.equal(server.rows.get(idOf('settings', 'theme')).value, 'light');

  // B edits (stamp 2000) but has not pushed yet.
  await B.store.set('settings', 'theme', 'dark');
  // Race: B pushes right after A's pull GET is snapshotted, before A's POST.
  server.onGet = async (label) => {
    if (label !== 'A') return;
    server.onGet = null;
    assert.equal((await B.sync.syncNow()).ok, true); // server dark@2000
  };

  A.clock.t = 3000;
  assert.equal((await A.sync.syncNow()).ok, true);

  // A pulled the stale snapshot (light@1000) and tried to push it back, but the
  // trigger kept B's newer row: the server is still dark.
  assert.equal(server.rows.get(idOf('settings', 'theme')).value, 'dark');
  // A learns dark on its next pull.
  assert.equal((await A.sync.syncNow()).ok, true);
  assert.equal(await A.store.get('settings', 'theme'), 'dark');
});

test('same-millisecond edits pick the same winner on both devices', async () => {
  const server = createServer();
  const A = await ready(server, 'A', 5000);
  const B = await ready(server, 'B', 5000);

  await A.store.set('progress', 'lesson-1', { done: 'alpha' });
  await B.store.set('progress', 'lesson-1', { done: 'beta' });

  for (const client of [A, B, A, B]) assert.equal((await client.sync.syncNow()).ok, true);

  const a = await A.store.get('progress', 'lesson-1');
  const b = await B.store.get('progress', 'lesson-1');
  assert.deepEqual(a, b, 'no divergence on a timestamp tie');
});

// --------------------------------------------------------------------------
// REVIEW #17 (c): removals must become tombstones instead of reappearing.
// --------------------------------------------------------------------------

test('a deletion propagates to the other device and stays deleted', async () => {
  const server = createServer();
  const A = await ready(server, 'A', 1000);
  const B = await ready(server, 'B', 2000);

  await A.store.set('progress', 'lesson-1', { completed: true });
  await A.sync.syncNow();
  await B.sync.syncNow();
  assert.deepEqual(await B.store.get('progress', 'lesson-1'), { completed: true });

  A.clock.t = 3000;
  await A.store.remove('progress', 'lesson-1'); // storage hook -> enqueueDelete
  assert.equal((await A.sync.syncNow()).ok, true);
  assert.equal((await B.sync.syncNow()).ok, true);

  assert.equal(await A.store.get('progress', 'lesson-1'), undefined);
  assert.equal(await B.store.get('progress', 'lesson-1'), undefined, 'not resurrected on B');
  assert.equal(server.rows.get(idOf('progress', 'lesson-1')).deleted, true);

  // A later sync from A must not resurrect it either.
  await A.sync.syncNow();
  await B.sync.syncNow();
  assert.equal(await B.store.get('progress', 'lesson-1'), undefined);
});

test('a delete newer than a concurrent edit wins on both devices', async () => {
  const server = createServer();
  const A = await ready(server, 'A', 1000);
  const B = await ready(server, 'B', 2000);

  await A.store.set('srs', 'd1', { id: 'd1', reviews: 1 });
  await A.sync.syncNow();
  await B.sync.syncNow();

  A.clock.t = 4000;
  B.clock.t = 3000;
  await A.store.remove('srs', 'd1');
  await B.store.set('srs', 'd1', { id: 'd1', reviews: 2 }); // older edit

  await A.sync.syncNow();
  await B.sync.syncNow();
  await A.sync.syncNow();

  assert.equal(await A.store.get('srs', 'd1'), undefined);
  assert.equal(await B.store.get('srs', 'd1'), undefined);
});

test('an edit newer than a concurrent delete resurrects on both devices', async () => {
  const server = createServer();
  const A = await ready(server, 'A', 1000);
  const B = await ready(server, 'B', 2000);

  await A.store.set('srs', 'd1', { id: 'd1', reviews: 1 });
  await A.sync.syncNow();
  await B.sync.syncNow();

  A.clock.t = 3000;
  B.clock.t = 4000;
  await A.store.remove('srs', 'd1');
  await B.store.set('srs', 'd1', { id: 'd1', reviews: 9 }); // newer deliberate edit

  await A.sync.syncNow();
  await B.sync.syncNow();
  await A.sync.syncNow();

  assert.equal((await A.store.get('srs', 'd1')).reviews, 9);
  assert.equal((await B.store.get('srs', 'd1')).reviews, 9);
});

// --------------------------------------------------------------------------
// Reconnection, idempotency, secrets, expiry.
// --------------------------------------------------------------------------

test('offline edits stay queued and reach the server after reconnecting', async () => {
  const server = createServer();
  const gate = { offline: false };
  const A = await ready(server, 'A', 1000, gate);
  const B = await ready(server, 'B', 2000);

  gate.offline = true;
  await A.store.set('settings', 'fontScale', 1.3);
  const failed = await A.sync.syncNow();
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'offline');
  assert.equal(await A.sync.pending(), 1);

  gate.offline = false;
  assert.equal((await A.sync.syncNow()).ok, true);
  assert.equal(await A.sync.pending(), 0);
  assert.equal((await B.sync.syncNow()).ok, true);
  assert.equal(await B.store.get('settings', 'fontScale'), 1.3);
});

test('repeated syncs are idempotent: no duplicate rows, no drift', async () => {
  const server = createServer();
  const A = await ready(server, 'A', 1000);

  await A.store.set('settings', 'theme', 'dark');
  await A.store.set('progress', 'lesson-1', { completed: true });
  await A.sync.syncNow();
  const before = [...server.rows.keys()].sort();

  await A.sync.syncNow();
  await A.sync.syncNow();

  assert.deepEqual([...server.rows.keys()].sort(), before);
  assert.equal(server.rows.size, 2);
  assert.equal(await A.sync.pending(), 0);
  assert.equal(await A.store.get('settings', 'theme'), 'dark');
});

test('sync never uploads the OpenRouter key or the sync session', async () => {
  const server = createServer();
  const A = await ready(server, 'A', 1000);

  await A.store.set('meta', 'openrouterKey', 'sk-secret');
  await A.store.set('meta', 'syncSession', { access_token: 'secret' });
  await A.store.set('settings', 'theme', 'dark');
  await A.sync.syncNow();

  const pushed = server.requests.filter((r) => r.method === 'POST' && r.path === '/rest/v1/sync_blobs');
  const body = pushed.flatMap((r) => r.body);
  assert.ok(body.length > 0, 'a push happened');
  assert.equal(body.some((row) => row.store === 'meta' || JSON.stringify(row).includes('sk-secret')), false);
});

test('an expired token is refreshed once and the request retried', async () => {
  const server = createServer();
  const store = createStorage(memoryDriver());
  let restCalls = 0;
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url);
    if (u.pathname === '/rest/v1/sync_blobs' && (options.method ?? 'GET') === 'POST') {
      restCalls += 1;
      if (restCalls === 1) return { ok: false, status: 401, json: async () => ({}) };
    }
    return server.fetchFor('A')(url, options);
  };
  const sync = createSync({ fetch: fetchImpl, storage: store, now: () => 1000, config: CONFIG });
  await sync.verifyOtp('me@example.com', '123456');
  sync.attach();

  await store.set('settings', 'theme', 'dark');
  const result = await sync.syncNow();
  assert.equal(result.ok, true);

  const tokenCalls = server.requests.filter((r) => r.path === '/auth/v1/token');
  assert.equal(tokenCalls.length, 1, 'refreshed exactly once');
  const finalPost = server.requests.filter((r) => r.method === 'POST' && r.path === '/rest/v1/sync_blobs').at(-1);
  assert.equal(finalPost.headers.Authorization, 'Bearer T-A-new');
  assert.equal((await sync.getSession()).refresh_token, 'R-A-new');
});
// --------------------------------------------------------------------------
// REVIEW-2 I17: races in syncState, srs convergence, skewed clocks.
// --------------------------------------------------------------------------

test('I17: an srs card with more reviews wins and both devices converge (6/6/6)', async () => {
  const server = createServer();
  const A = await ready(server, 'A', 1000);
  const B = await ready(server, 'B', 900);

  // A has the newer clock but fewer reviews; B studied more with an older clock.
  A.clock.t = 1000;
  await A.store.set('srs', 'd1', { id: 'd1', reviews: 5 });
  assert.equal((await A.sync.syncNow()).ok, true);
  assert.equal((await B.sync.syncNow()).ok, true);

  B.clock.t = 900;
  await B.store.set('srs', 'd1', { id: 'd1', reviews: 6 });
  assert.equal((await B.sync.syncNow()).ok, true);
  A.clock.t = 1100;
  assert.equal((await A.sync.syncNow()).ok, true);
  assert.equal((await B.sync.syncNow()).ok, true);

  assert.equal((await A.store.get('srs', 'd1')).reviews, 6);
  assert.equal((await B.store.get('srs', 'd1')).reviews, 6);
  assert.equal(server.rows.get(idOf('srs', 'd1')).value.reviews, 6);
});

test('I17: a write during a push is not lost (serialized state)', async () => {
  const server = createServer();
  const A = await ready(server, 'A', 1000);

  await A.store.set('settings', 'theme', 'dark');
  let writeDuringPush = null;
  server.onPost = () => {
    if (writeDuringPush) return;
    // Fires while the push POST is in flight; must not be overwritten by push.
    writeDuringPush = A.store.set('settings', 'fontScale', 1.2);
  };
  assert.equal((await A.sync.syncNow()).ok, true);
  await writeDuringPush;

  assert.equal(await A.store.get('settings', 'fontScale'), 1.2);
  assert.equal((await A.sync.pending()) >= 1, true, 'the mid-push write is still queued');
  assert.equal((await A.sync.syncNow()).ok, true);
  assert.equal(server.rows.get(idOf('settings', 'fontScale')).value, 1.2);
});

test('I17: a clock a year ahead is capped by the server and does not block', async () => {
  const base = 1_000_000;
  const server = createServer({ now: () => base });
  const A = await ready(server, 'A', base + 365 * 24 * 3600 * 1000);

  await A.store.set('settings', 'theme', 'dark');
  assert.equal((await A.sync.syncNow()).ok, true);
  const stamp = Date.parse(server.rows.get(idOf('settings', 'theme')).updated_at);
  assert.ok(stamp <= base + 5 * 60 * 1000, `capped to +5 min (got +${(stamp - base) / 1000}s)`);

  // A sane device editing after the cap still wins.
  const B = await ready(server, 'B', base);
  B.clock.t = base + 6 * 60 * 1000;
  await B.store.set('settings', 'theme', 'light');
  assert.equal((await B.sync.syncNow()).ok, true);
  assert.equal(server.rows.get(idOf('settings', 'theme')).value, 'light');
});
