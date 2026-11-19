import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  MODELS,
  WEBLLM_VERSION,
  WEBLLM_CDN_URL,
  detectSupport,
  pickModel,
  createProvider,
} from '../src/chat/webllm-provider.js';

/** Fake Cache API: `names` are the cache names that exist. */
function fakeCaches(names = []) {
  const live = new Set(names);
  const deleted = [];
  return {
    deleted,
    async keys() { return [...live]; },
    async delete(name) { deleted.push(name); live.delete(name); return live.has(name); },
  };
}

function fakeStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(storeName, key) { return data.get(`${storeName}:${key}`); },
    async set(storeName, key, value) { data.set(`${storeName}:${key}`, value); return value; },
    async remove(storeName, key) { return data.delete(`${storeName}:${key}`); },
  };
}

const gpuNav = (opts = {}) => ({
  gpu: { requestAdapter: async () => ({ name: 'fake-adapter' }) },
  ...opts,
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A fake engine whose chat stream yields the given deltas. */
function fakeEngine({ deltas = [], onCreate } = {}) {
  const calls = { interrupts: 0, unloaded: 0, requests: [] };
  const engine = {
    calls,
    async unload() { calls.unloaded += 1; },
    interruptGenerate() { calls.interrupts += 1; },
    chat: {
      completions: {
        async create(request) {
          calls.requests.push(request);
          return (async function* stream() {
            for (const delta of deltas) {
              if (calls.interrupts > 0) return;
              yield { choices: [{ delta: { content: delta } }] };
            }
          })();
        },
      },
    },
  };
  const loadWebLLM = async () => {
    if (onCreate) await onCreate();
    return {
      CreateMLCEngine: async (modelId, options) => {
        calls.modelId = modelId;
        options?.initProgressCallback?.({ progress: 0.5, text: 'fetching weights' });
        return engine;
      },
    };
  };
  return { engine, calls, loadWebLLM };
}

describe('detectSupport', () => {
  test('no navigator.gpu -> unsupported', async () => {
    assert.deepEqual(await detectSupport({}), { supported: false, reason: 'no-webgpu' });
    assert.deepEqual(await detectSupport(undefined), { supported: false, reason: 'no-webgpu' });
  });

  test('gpu without adapter -> no-adapter', async () => {
    const nav = { gpu: { requestAdapter: async () => null } };
    assert.deepEqual(await detectSupport(nav), { supported: false, reason: 'no-adapter' });
  });

  test('requestAdapter that throws -> no-adapter, never throws', async () => {
    const nav = { gpu: { requestAdapter: async () => { throw new Error('boom'); } } };
    assert.deepEqual(await detectSupport(nav), { supported: false, reason: 'no-adapter' });
  });

  test('gpu with an adapter -> supported', async () => {
    assert.deepEqual(await detectSupport(gpuNav()), { supported: true, reason: 'ok' });
  });
});

describe('pickModel', () => {
  test('8 GB or more -> 1.5B, less -> 0.5B', () => {
    assert.equal(pickModel({ deviceMemory: 8 }), 'large');
    assert.equal(pickModel({ deviceMemory: 16 }), 'large');
    assert.equal(pickModel({ deviceMemory: 4 }), 'small');
    assert.equal(pickModel({ deviceMemory: 2 }), 'small');
  });

  test('no deviceMemory -> falls back to cpu count', () => {
    assert.equal(pickModel({ hardwareConcurrency: 8 }), 'large');
    assert.equal(pickModel({ hardwareConcurrency: 4 }), 'small');
    assert.equal(pickModel({}), 'small');
  });
});

describe('lazy loading', () => {
  test('init never touches the CDN, even when supported', async () => {
    let imported = 0;
    const provider = createProvider({
      nav: gpuNav({ deviceMemory: 4 }),
      caches: fakeCaches(),
      store: fakeStore(),
      loadWebLLM: async () => { imported += 1; throw new Error('should not load'); },
    });
    await provider.init();
    assert.equal(imported, 0);
    assert.equal(provider.status(), 'empty');
    assert.equal(provider.available(), false);
  });

  test('the pinned CDN URL is a fixed version, not "latest"', () => {
    assert.match(WEBLLM_CDN_URL, /@mlc-ai\/web-llm@\d+\.\d+\.\d+\/\+esm$/);
    assert.equal(WEBLLM_CDN_URL.includes(WEBLLM_VERSION), true);
  });
});

describe('init', () => {
  test('without WebGPU: not supported, no options, download rejects', async () => {
    const provider = createProvider({ nav: {}, caches: fakeCaches(), store: fakeStore() });
    await provider.init();
    assert.equal(provider.status(), 'unsupported');
    assert.equal(provider.available(), false);
    await assert.rejects(provider.download(), (err) => err.kind === 'unsupported');
  });

  test('picks the model from memory and remembers it', async () => {
    const store = fakeStore();
    const provider = createProvider({ nav: gpuNav({ deviceMemory: 4 }), caches: fakeCaches(), store });
    await provider.init();
    assert.equal(provider.model().id, MODELS.small.id);
  });

  test('reuses the model saved in settings after a reload', async () => {
    const store = fakeStore({ 'settings:onDeviceModel': MODELS.small.id });
    const provider = createProvider({ nav: gpuNav({ deviceMemory: 16 }), caches: fakeCaches(), store });
    await provider.init();
    assert.equal(provider.model().id, MODELS.small.id);
  });

  test('a cached model means available, no download needed', async () => {
    let imported = 0;
    const provider = createProvider({
      nav: gpuNav({ deviceMemory: 4 }),
      caches: fakeCaches(['webllm/model']),
      store: fakeStore(),
      loadWebLLM: async () => { imported += 1; return {}; },
    });
    await provider.init();
    assert.equal(provider.status(), 'ready');
    assert.equal(provider.available(), true);
    assert.equal(imported, 0);
  });
});

describe('download', () => {
  test('reports progress and ends ready', async () => {
    const { loadWebLLM, calls } = fakeEngine();
    const provider = createProvider({
      nav: gpuNav({ deviceMemory: 8 }), caches: fakeCaches(), store: fakeStore(), loadWebLLM,
    });
    await provider.init();
    const seen = [];
    provider.subscribe(() => seen.push({ status: provider.status(), progress: provider.progress().progress }));
    await provider.download();
    assert.equal(calls.modelId, MODELS.large.id);
    assert.equal(provider.status(), 'ready');
    assert.equal(provider.available(), true);
    assert.equal(provider.progress().progress, 1);
    const downloading = seen.filter((s) => s.status === 'downloading');
    assert.ok(downloading.length >= 1, 'emitted downloading');
    assert.ok(downloading.some((s) => s.progress === 0.5), 'propagated the engine progress callback');
  });

  test('a failed load surfaces as an error state with a retry hint', async () => {
    const provider = createProvider({
      nav: gpuNav({ deviceMemory: 4 }),
      caches: fakeCaches(),
      store: fakeStore(),
      loadWebLLM: async () => ({ CreateMLCEngine: async () => { throw new Error('out of memory'); } }),
    });
    await provider.init();
    await assert.rejects(provider.download());
    assert.equal(provider.status(), 'error');
    assert.equal(provider.available(), false);
  });

  test('cancel stops waiting and drops the engine when it finally arrives', async () => {
    const gate = deferred();
    const { engine, calls, loadWebLLM } = fakeEngine({ onCreate: () => gate.promise });
    const provider = createProvider({
      nav: gpuNav({ deviceMemory: 4 }), caches: fakeCaches(), store: fakeStore(), loadWebLLM,
    });
    await provider.init();
    const running = provider.download();
    assert.equal(provider.status(), 'downloading');
    assert.equal(provider.cancel(), true);
    assert.equal(provider.status(), 'cancelling');
    gate.resolve();
    assert.equal(await running, null);
    assert.equal(provider.status(), 'empty');
    assert.equal(provider.available(), false);
    assert.equal(calls.unloaded, 1, 'engine built after the cancel is unloaded');
  });

  test('cancel does nothing when no download is running', async () => {
    const provider = createProvider({ nav: gpuNav({ deviceMemory: 4 }), caches: fakeCaches(), store: fakeStore() });
    await provider.init();
    assert.equal(provider.cancel(), false);
  });
});

describe('clearModel', () => {
  test('deletes the smart-cache weights and forgets the model', async () => {
    const { engine, calls, loadWebLLM } = fakeEngine();
    const caches = fakeCaches(['webllm/model', 'workbox-precache', 'something-else']);
    const store = fakeStore();
    const provider = createProvider({ nav: gpuNav({ deviceMemory: 4 }), caches, store, loadWebLLM });
    await provider.init();
    await provider.download();
    assert.equal(provider.status(), 'ready');
    await provider.clearModel();
    assert.equal(calls.unloaded, 1);
    assert.deepEqual(caches.deleted, ['webllm/model']);
    assert.equal(provider.status(), 'empty');
    assert.equal(provider.available(), false);
    assert.equal(store.data.has('settings:onDeviceModel'), false);
    assert.equal(engine.calls.requests.length, 0);
  });
});

describe('send (streaming)', () => {
  test('yields the deltas in order, with the messages passed through', async () => {
    const { engine, calls, loadWebLLM } = fakeEngine({ deltas: ['你', '好', '！'] });
    const provider = createProvider({
      nav: gpuNav({ deviceMemory: 4 }), caches: fakeCaches(), store: fakeStore(), loadWebLLM,
    });
    const messages = [
      { role: 'system', content: 'json please' },
      { role: 'user', content: '你好' },
    ];
    let text = '';
    for await (const delta of provider.send(messages)) text += delta;
    assert.equal(text, '你好！');
    assert.equal(calls.requests.length, 1);
    assert.deepEqual(calls.requests[0].messages, messages);
    assert.equal(calls.requests[0].stream, true);
  });

  test('an abort signal interrupts the engine and stops the stream', async () => {
    const { engine, calls, loadWebLLM } = fakeEngine({ deltas: ['一', '二', '三'] });
    const provider = createProvider({
      nav: gpuNav({ deviceMemory: 4 }), caches: fakeCaches(), store: fakeStore(), loadWebLLM,
    });
    const controller = new AbortController();
    let text = '';
    for await (const delta of provider.send([{ role: 'user', content: 'x' }], { signal: controller.signal })) {
      text += delta;
      controller.abort();
    }
    assert.equal(text, '一');
    assert.ok(calls.interrupts >= 1);
    assert.ok(engine.calls.requests.length === 1);
  });

  test('an already-aborted signal sends nothing', async () => {
    const { calls, loadWebLLM } = fakeEngine({ deltas: ['nope'] });
    const provider = createProvider({
      nav: gpuNav({ deviceMemory: 4 }), caches: fakeCaches(), store: fakeStore(), loadWebLLM,
    });
    const controller = new AbortController();
    controller.abort();
    let text = '';
    for await (const delta of provider.send([{ role: 'user', content: 'x' }], { signal: controller.signal })) text += delta;
    assert.equal(text, '');
    assert.equal(calls.requests.length, 0);
  });
});