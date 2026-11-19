/**
 * sync-client.test.mjs — src/sync/client.js with a fake fetch + in-memory
 * storage, plus a headless render of the Account screen (no browser).
 * Run: node --test tests/sync-client.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDriver, createStorage } from '../src/storage.js';
import { createSync } from '../src/sync/client.js';

const CONFIG = { url: 'https://demo.supabase.co', anonKey: 'public-anon-key' };

/** Fake fetch: matches routes in order, records every call, can simulate offline. */
function makeFetch(routes = []) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined });
    const route = routes.find((r) => url.includes(r.match));
    if (route?.offline) throw new TypeError('Failed to fetch');
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: route.ok !== false, status: route.status ?? 200, json: async () => route.json ?? {} };
  };
  impl.calls = calls;
  return impl;
}

const newStore = () => createStorage(memoryDriver());

/** A signed-in instance: verifyOtp against the fake auth route. */
async function signedIn(extraRoutes = []) {
  const fetchImpl = makeFetch([
    { match: '/auth/v1/verify', json: { access_token: 'TOKEN', refresh_token: 'R', user: { id: 'u1' } } },
    ...extraRoutes,
  ]);
  const store = newStore();
  const sync = createSync({ fetch: fetchImpl, storage: store, now: () => 1000, config: CONFIG });
  await sync.verifyOtp('me@example.com', '123456');
  return { sync, store, fetchImpl };
}

// --------------------------------------------------------------------------
// Unconfigured: the app must stay 100% local, zero sync requests.
// --------------------------------------------------------------------------

test('with empty config every entry point short-circuits and never calls fetch', async () => {
  const fetchImpl = makeFetch();
  const sync = createSync({ fetch: fetchImpl, storage: newStore(), now: () => 1000, config: { url: '', anonKey: '' } });

  assert.equal(sync.isConfigured(), false);
  for (const result of [
    await sync.push(),
    await sync.pull(),
    await sync.syncNow(),
    await sync.signInWithOtp('me@example.com'),
    await sync.verifyOtp('me@example.com', '123456'),
    await sync.deleteRemoteData(),
    await sync.enqueue({ store: 'srs', key: 'd1', value: {} }),
    await sync.enqueueDelete('srs', 'd1'),
  ]) {
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not-configured');
  }
  assert.equal(fetchImpl.calls.length, 0, 'no network request was made');
});

test('a write hook attached while unconfigured queues nothing and stays silent', async () => {
  const fetchImpl = makeFetch();
  const store = newStore();
  const sync = createSync({ fetch: fetchImpl, storage: store, now: () => 1000, config: { url: '', anonKey: '' } });
  sync.attach();
  await store.set('srs', 'd1', { id: 'd1' });
  assert.equal(await sync.pending(), 0);
  assert.equal(fetchImpl.calls.length, 0);
});

// --------------------------------------------------------------------------
// Auth
// --------------------------------------------------------------------------

test('signInWithOtp posts the email to /auth/v1/otp with the anon key', async () => {
  const fetchImpl = makeFetch([{ match: '/auth/v1/otp', json: {} }]);
  const sync = createSync({ fetch: fetchImpl, storage: newStore(), now: () => 1000, config: CONFIG });

  assert.deepEqual(await sync.signInWithOtp('me@example.com'), { ok: true });
  assert.equal(fetchImpl.calls.length, 1);
  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://demo.supabase.co/auth/v1/otp');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers.apikey, 'public-anon-key');
  assert.deepEqual(call.body, { email: 'me@example.com', create_user: true });
});

test('verifyOtp stores the session and getSession returns it; signOut clears it', async () => {
  const { sync } = await signedIn();
  const session = await sync.getSession();
  assert.equal(session.access_token, 'TOKEN');
  assert.equal(session.email, 'me@example.com');

  await sync.signOut();
  assert.equal(await sync.getSession(), null);
});

test('a network failure during auth is reported, not thrown', async () => {
  const fetchImpl = makeFetch([{ match: '/auth/v1/otp', offline: true }]);
  const sync = createSync({ fetch: fetchImpl, storage: newStore(), now: () => 1000, config: CONFIG });
  const result = await sync.signInWithOtp('me@example.com');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'offline');
});

// --------------------------------------------------------------------------
// Push / pull / merge / offline
// --------------------------------------------------------------------------

test('push uploads every local record of the synced stores and clears the queue', async () => {
  const { sync, store, fetchImpl } = await signedIn([{ match: '/rest/v1/sync_blobs', json: {} }]);
  await store.set('srs', 'd1', { id: 'd1', reviews: 3 });
  await store.set('settings', 'theme', 'dark');
  await sync.enqueue({ store: 'srs', key: 'd1', value: { id: 'd1', reviews: 3 } });
  assert.equal(await sync.pending(), 1);

  const result = await sync.push();
  assert.deepEqual(result, { ok: true, pushed: 2 });

  const call = fetchImpl.calls.find((c) => c.url.includes('/rest/v1/sync_blobs'));
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers.Authorization, 'Bearer TOKEN');
  assert.equal(call.options.headers.Prefer, 'resolution=merge-duplicates');
  assert.equal(call.body.length, 2);
  assert.deepEqual(call.body.map((r) => [r.store, r.key]).sort(), [['settings', 'theme'], ['srs', 'd1']]);
  assert.equal(call.body[0].updated_at, new Date(1000).toISOString());

  assert.equal(await sync.pending(), 0);
  assert.equal(await sync.lastSync(), 1000);
});

test('push refuses when not signed in and makes no request', async () => {
  const fetchImpl = makeFetch([{ match: '/rest/v1/sync_blobs', json: {} }]);
  const sync = createSync({ fetch: fetchImpl, storage: newStore(), now: () => 1000, config: CONFIG });
  const result = await sync.push();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-signed-in');
  assert.equal(fetchImpl.calls.length, 0);
});

test('pull merges a conflict: a review card with more reviews wins and is applied locally', async () => {
  const remoteRow = {
    store: 'srs',
    key: 'd1',
    value: { id: 'd1', reviews: 7 },
    updated_at: new Date(2000).toISOString(),
    deleted: false,
  };
  const { sync, store } = await signedIn([
    { match: '/rest/v1/sync_blobs?select=', json: [remoteRow] },
  ]);
  await store.set('srs', 'd1', { id: 'd1', reviews: 3 });
  await sync.enqueue({ store: 'srs', key: 'd1', value: { id: 'd1', reviews: 3 } }); // stamps updated_at=1000

  const result = await sync.pull();
  assert.equal(result.ok, true);
  assert.equal(result.applied, 1);
  assert.equal((await store.get('srs', 'd1')).reviews, 7);
});

test('pull keeps a newer local value instead of an older remote one', async () => {
  const remoteRow = {
    store: 'settings',
    key: 'theme',
    value: 'light',
    updated_at: new Date(500).toISOString(),
    deleted: false,
  };
  const { sync, store } = await signedIn([{ match: '/rest/v1/sync_blobs?select=', json: [remoteRow] }]);
  await store.set('settings', 'theme', 'dark');
  await sync.enqueue({ store: 'settings', key: 'theme', value: 'dark' }); // updated_at = 1000 > 500

  await sync.pull();
  assert.equal(await store.get('settings', 'theme'), 'dark');
});

test('pull applies a remote deletion (tombstone) by removing the local key', async () => {
  const remoteRow = {
    store: 'progress',
    key: 'lesson-1',
    value: null,
    updated_at: new Date(5000).toISOString(),
    deleted: true,
  };
  const { sync, store } = await signedIn([{ match: '/rest/v1/sync_blobs?select=', json: [remoteRow] }]);
  await store.set('progress', 'lesson-1', { completed: true });

  const result = await sync.pull();
  assert.equal(result.applied, 1);
  assert.equal(await store.get('progress', 'lesson-1'), undefined);
});

test('pull ignores rows from stores that are not synced (e.g. a stray meta row)', async () => {
  const { sync, store } = await signedIn([
    { match: '/rest/v1/sync_blobs?select=', json: [{ store: 'meta', key: 'x', value: 1, updated_at: new Date(9).toISOString(), deleted: false }] },
  ]);
  const result = await sync.pull();
  assert.equal(result.applied, 0);
  assert.equal(await store.get('meta', 'x'), undefined);
});

test('offline: a failed push keeps the change queued and is reported, not thrown', async () => {
  const { sync, store } = await signedIn([{ match: '/rest/v1/sync_blobs', offline: true }]);
  await store.set('srs', 'd1', { id: 'd1', reviews: 1 });
  await sync.enqueue({ store: 'srs', key: 'd1', value: { id: 'd1', reviews: 1 } });

  const result = await sync.push();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'offline');
  assert.equal(await sync.pending(), 1, 'the change is still waiting to be sent');
});

test('offline: a failed pull is reported, not thrown', async () => {
  const { sync } = await signedIn([{ match: '/rest/v1/sync_blobs?select=', offline: true }]);
  const result = await sync.pull();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'offline');
});

test('syncNow pushes then pulls', async () => {
  const { sync, store, fetchImpl } = await signedIn([
    { match: '/rest/v1/sync_blobs?select=', json: [] },
    { match: '/rest/v1/sync_blobs', json: {} },
  ]);
  await store.set('settings', 'theme', 'dark');
  await sync.enqueue({ store: 'settings', key: 'theme', value: 'dark' });

  const result = await sync.syncNow();
  assert.equal(result.ok, true);
  const methods = fetchImpl.calls
    .filter((c) => c.url.includes('/rest/v1/sync_blobs'))
    .map((c) => `${c.options.method ?? 'GET'} ${c.url.split('?')[0]}`);
  assert.deepEqual(methods, ['POST https://demo.supabase.co/rest/v1/sync_blobs', 'GET https://demo.supabase.co/rest/v1/sync_blobs']);
});

test('deleteRemoteData sends a scoped DELETE and leaves the local copy alone', async () => {
  const { sync, store, fetchImpl } = await signedIn([{ match: '/rest/v1/sync_blobs', json: {} }]);
  await store.set('srs', 'd1', { id: 'd1' });

  assert.deepEqual(await sync.deleteRemoteData(), { ok: true });
  const call = fetchImpl.calls.at(-1);
  assert.equal(call.options.method, 'DELETE');
  assert.ok(call.url.startsWith('https://demo.supabase.co/rest/v1/sync_blobs?'));
  assert.equal(call.options.headers.Authorization, 'Bearer TOKEN');
  assert.deepEqual(await store.get('srs', 'd1'), { id: 'd1' });
});

// --------------------------------------------------------------------------
// Account screen, headless (no browser)
// --------------------------------------------------------------------------

/** Minimal DOM stand-in, just enough for src/dom.js h()/reset(). */
class FakeNode {
  constructor(tag = '#text') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this._text = '';
    this.dataset = {};
    this.attrs = {};
    this.className = '';
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join('');
  }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  set innerHTML(_value) {
    this._text = '';
    this.children = [];
  }
  setAttribute(name, value) {
    this.attrs[name] = value;
  }
  getAttribute(name) {
    return this.attrs[name];
  }
  append(...nodes) {
    for (const node of nodes) this.children.push(node);
  }
  replaceChildren(...nodes) {
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }
  addEventListener() {}
  focus() {}
  querySelector() {
    return null;
  }
}

function installFakeDom() {
  const head = new FakeNode('head');
  globalThis.Node = FakeNode;
  globalThis.document = {
    head,
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => {
      const node = new FakeNode('#text');
      node.textContent = text;
      return node;
    },
    getElementById: (id) => head.children.find((child) => child.id === id) ?? null,
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
    confirm: () => true,
  };
}

test('headless: the Account screen shows "not configured" and makes no request', async () => {
  installFakeDom();
  const fetchCalls = [];
  globalThis.fetch = (...args) => {
    fetchCalls.push(args);
    return Promise.reject(new Error('the unconfigured app must not call fetch'));
  };

  const { registerLocale } = await import('../src/i18n.js');
  const { readFile } = await import('node:fs/promises');
  registerLocale('en', JSON.parse(await readFile(new URL('../src/locales/en.d/account.json', import.meta.url), 'utf8')));

  const account = await import('../src/extras/account.js');
  assert.equal(account.titleKey, 'account.title');
  assert.equal(typeof account.render, 'function');

  const container = new FakeNode('div');
  const cleanup = account.render(container, { route: { name: 'extras', segments: ['account'] }, navigate() {} });

  assert.equal(container.dataset.state, 'not-configured');
  assert.match(container.textContent, /Sync is not configured/);
  assert.equal(fetchCalls.length, 0, 'no network request from the unconfigured screen');
  assert.equal(typeof cleanup, 'function');
  cleanup();

  delete globalThis.Node;
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.fetch;
});
