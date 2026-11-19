/**
 * webllm-provider.js — "On-device (browser)" chat provider, powered by WebLLM.
 *
 * WebLLM (Apache-2.0, WebGPU) runs a small quantized model inside the browser
 * tab: no API key, no server, nothing leaves the device. The first use downloads
 * the weights (~1 GB) into the Cache API; after that it works offline.
 *
 * The library itself is NOT an npm dependency and is NOT loaded with the app:
 * `import()` of a pinned CDN build happens only when the user asks for the
 * model. Nothing here runs until `init()` / `download()` is called.
 *
 * Provider contract (src/chat/providers.js):
 *   { id, name, available() -> boolean, send(messages, {signal}) -> AsyncIterable<string> }
 * plus extras used by the conversation screen:
 *   status()            'checking'|'unsupported'|'empty'|'downloading'|'cancelling'|'ready'|'error'
 *   progress()          { progress: 0..1, text }  (progress = download/load, 0..1)
 *   init()              detect WebGPU + look for the cached model (idempotent)
 *   download()          load the library + engine (progress callback), Promise<engine|null>
 *   cancel()            stop waiting for a download in flight
 *   clearModel()        unload the engine and delete the weights from the cache
 *   subscribe(fn)       -> unsubscribe; fn() runs on every state change
 *   renderConfig()      -> <div> with notice / progress bar / buttons
 *
 * Pure bits (detectSupport, pickModel) and the engine wiring take injected
 * dependencies, so tests run in Node with a fake engine and no network.
 */

import { h } from '../dom.js';
import { t } from '../i18n.js';
import storage from '../storage.js';

/** Pinned CDN build. Bump deliberately: a new version can change model ids. */
export const WEBLLM_VERSION = '0.2.89';
export const WEBLLM_CDN_URL = `https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@${WEBLLM_VERSION}/+esm`;

/** WebLLM keeps weights + wasm/config in Cache API entries named like this. */
export const CACHE_PREFIX = 'webllm';

/** q4f16_1 quantized, MLC format. Sizes are the published download sizes. */
export const MODELS = {
  small: { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', sizeGB: 0.95 },
  large: { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', sizeGB: 1.0 },
};

/** Settings key remembering which model was downloaded (must stay stable). */
export const MODEL_SETTING = 'onDeviceModel';

export class OnDeviceError extends Error {
  constructor(message, kind = 'on-device') {
    super(message);
    this.name = 'OnDeviceError';
    this.kind = kind;
  }
}

/**
 * WebGPU present? Needs `navigator.gpu` AND a real adapter: Chrome exposes the
 * property on some machines where the adapter is refused (blocklisted GPU,
 * software rendering). Never throws.
 */
export async function detectSupport(nav = globalThis.navigator) {
  const gpu = nav?.gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return { supported: false, reason: 'no-webgpu' };
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { supported: false, reason: 'no-adapter' };
    return { supported: true, reason: 'ok' };
  } catch {
    return { supported: false, reason: 'no-adapter' };
  }
}

/**
 * Pick 0.5B or 1.5B from `navigator.deviceMemory` (coarse GB buckets: 0.5, 1,
 * 2, 4, 8+). 8 GB or more gets the better Chinese of the two (1.5B); otherwise
 * the small one, to leave room for the rest of the tab.
 */
export function pickModel({ deviceMemory = 0, hardwareConcurrency = 0 } = {}) {
  const mem = Number(deviceMemory) || 0;
  if (mem >= 8) return 'large';
  if (mem > 0) return 'small';
  return (Number(hardwareConcurrency) || 0) >= 8 ? 'large' : 'small';
}

const STYLE_ID = 'webllm-style';
const CSS = `
.wl-panel { gap: 0.5rem; }
.wl-panel h4 { margin: 0; font-size: 0.95rem; }
.wl-notice { margin: 0; font-size: 0.8rem; color: var(--fg-soft); }
.wl-meter { width: 100%; height: 0.6rem; accent-color: var(--accent); }
.wl-row { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
.wl-percent { font-size: 0.8rem; color: var(--fg-soft); }
.wl-detail { margin: 0; font-size: 0.75rem; color: var(--fg-soft); word-break: break-word; }
`;

function ensureStyles(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

/**
 * The provider object. Everything is injectable so the tests can drive it with
 * a fake engine: `loadWebLLM`, `nav`, `caches`, `store`, `pick`.
 */
export function createProvider({
  loadWebLLM = () => import(/* @vite-ignore */ WEBLLM_CDN_URL),
  nav = globalThis.navigator,
  caches: cacheApi = globalThis.caches,
  store = storage,
  pick = pickModel,
  modelKey = null,
} = {}) {
  let status = 'idle';
  let reason = '';
  let lib = null;
  let engine = null;
  let loading = null;
  let aborted = false;
  let error = null;
  let progress = { progress: 0, text: '' };
  let key = modelKey && MODELS[modelKey] ? modelKey : null;
  const listeners = new Set();
  let initPromise = null;

  const emit = () => {
    for (const fn of [...listeners]) {
      try { fn(provider); } catch { /* a broken listener must not break the provider */ }
    }
  };

  const model = () => MODELS[key || 'small'];

  async function hasCache() {
    if (!cacheApi || typeof cacheApi.keys !== 'function') return false;
    try {
      const names = await cacheApi.keys();
      return names.some((name) => String(name).startsWith(CACHE_PREFIX));
    } catch {
      return false;
    }
  }

  async function rememberModel(id) {
    try { await store?.set?.('settings', MODEL_SETTING, id); } catch { /* optional */ }
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      status = 'checking';
      emit();
      const det = await detectSupport(nav);
      if (!det.supported) {
        status = 'unsupported';
        reason = det.reason;
        emit();
        return;
      }
      if (!key) {
        let saved = null;
        try { saved = await store?.get?.('settings', MODEL_SETTING); } catch { /* optional */ }
        const savedKey = Object.keys(MODELS).find((k) => MODELS[k].id === saved);
        key = savedKey || pick({
          deviceMemory: nav?.deviceMemory,
          hardwareConcurrency: nav?.hardwareConcurrency,
        });
        if (!MODELS[key]) key = 'small';
      }
      status = (await hasCache()) ? 'ready' : 'empty';
      emit();
    })();
    return initPromise;
  }

  function onProgress(report) {
    if (aborted) return;
    const value = Number(report?.progress);
    progress = {
      progress: Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : progress.progress,
      text: String(report?.text || ''),
    };
    emit();
  }

  async function unload(inst) {
    try { await inst?.unload?.(); } catch { /* already gone */ }
  }

  function download() {
    if (status === 'unsupported') return Promise.reject(new OnDeviceError('no WebGPU', 'unsupported'));
    if (engine) return Promise.resolve(engine);
    if (loading) return loading;
    aborted = false;
    error = null;
    progress = { progress: 0, text: '' };
    status = 'downloading';
    emit();
    loading = (async () => {
      try {
        lib = lib || await loadWebLLM();
        const create = lib?.CreateMLCEngine || lib?.default?.CreateMLCEngine;
        if (typeof create !== 'function') throw new OnDeviceError('CreateMLCEngine missing', 'library');
        const created = await create(model().id, { initProgressCallback: onProgress });
        if (aborted) {
          await unload(created);
          status = 'empty';
          progress = { progress: 0, text: '' };
          emit();
          return null;
        }
        engine = created;
        await rememberModel(model().id);
        status = 'ready';
        progress = { progress: 1, text: '' };
        emit();
        return engine;
      } catch (err) {
        error = err;
        status = 'error';
        emit();
        throw err;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  /**
   * Stop waiting for a download. WebLLM cannot abort an in-flight download, so
   * the fetch finishes in the background; the engine is dropped as soon as (if)
   * it is built, and nothing of it reaches the chat.
   */
  function cancel() {
    if (status !== 'downloading') return false;
    aborted = true;
    status = 'cancelling';
    emit();
    return true;
  }

  async function clearModel() {
    if (initPromise && status === 'checking') await initPromise;
    await unload(engine);
    engine = null;
    try {
      if (typeof lib?.deleteModelAllInfoInCache === 'function') {
        await lib.deleteModelAllInfoInCache(model().id);
      } else if (cacheApi && typeof cacheApi.keys === 'function' && typeof cacheApi.delete === 'function') {
        const names = await cacheApi.keys();
        await Promise.all(names
          .filter((name) => String(name).startsWith(CACHE_PREFIX))
          .map((name) => cacheApi.delete(name)));
      }
      try { await store?.remove?.('settings', MODEL_SETTING); } catch { /* optional */ }
      status = 'empty';
      error = null;
    } catch (err) {
      error = err;
      status = 'error';
    }
    progress = { progress: 0, text: '' };
    emit();
  }

  async function* send(messages, { signal } = {}) {
    await init();
    if (status === 'unsupported') throw new OnDeviceError('no WebGPU', 'unsupported');
    if (signal?.aborted) return;
    if (!engine) await download();
    if (!engine || signal?.aborted) return;
    const payload = (Array.isArray(messages) ? messages : []).map(({ role, content }) => ({
      role,
      content: String(content ?? ''),
    }));
    const stream = await engine.chat.completions.create({
      messages: payload,
      stream: true,
      temperature: 0.7,
      max_tokens: 200,
    });
    const interrupt = () => { try { engine.interruptGenerate(); } catch { /* already stopped */ } };
    if (signal?.addEventListener) signal.addEventListener('abort', interrupt, { once: true });
    try {
      for await (const chunk of stream) {
        if (signal?.aborted) return;
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    } finally {
      if (signal?.removeEventListener) signal.removeEventListener('abort', interrupt);
    }
  }

  // ---------------------------------------------------------------- UI card

  function renderConfig() {
    const doc = globalThis.document;
    ensureStyles(doc);
    const panel = h('div', { class: 'conv-body wl-panel' });

    const paint = () => {
      panel.replaceChildren();
      panel.append(h('h4', { text: t('conversationLocal.title') }));
      const p = progress;

      if (status === 'idle' || status === 'checking') {
        panel.append(h('p', { class: 'wl-notice', text: t('conversationLocal.checking') }));
        return;
      }
      if (status === 'unsupported') {
        panel.append(h('p', { class: 'wl-notice', text: t('conversationLocal.unsupported') }));
        return;
      }
      if (status === 'downloading' || status === 'cancelling') {
        const meter = h('progress', { class: 'wl-meter', max: '1', value: String(p.progress) });
        const percent = h('span', { class: 'wl-percent', text: `${Math.round(p.progress * 100)}%` });
        const stop = h('button', {
          type: 'button', class: 'btn', text: t('conversationLocal.cancel'),
          disabled: status === 'cancelling', onclick: () => cancel(),
        });
        panel.append(h('p', { class: 'wl-notice', text: t('conversationLocal.downloading') }));
        panel.append(h('div', { class: 'wl-row' }, meter, percent, stop));
        if (p.text) panel.append(h('p', { class: 'wl-detail', text: p.text }));
        if (status === 'cancelling') panel.append(h('p', { class: 'wl-notice', text: t('conversationLocal.cancelNote') }));
        return;
      }
      if (status === 'ready') {
        panel.append(h('p', { class: 'wl-notice', text: t('conversationLocal.ready', { model: model().id }) }));
        panel.append(h('div', { class: 'wl-row' },
          h('button', {
            type: 'button', class: 'btn', text: t('conversationLocal.remove'),
            onclick: () => { clearModel(); },
          })));
        return;
      }
      if (status === 'error') {
        panel.append(h('p', { class: 'wl-notice conv-error', text: t('conversationLocal.error', { message: String(error?.message || error || '') }) }));
        panel.append(h('div', { class: 'wl-row' },
          h('button', { type: 'button', class: 'btn', text: t('conversationLocal.retry'), onclick: () => { download().catch(() => {}); } })));
        return;
      }
      // empty: nothing cached yet
      panel.append(h('p', { class: 'wl-notice', text: t('conversationLocal.downloadNotice', { size: model().sizeGB }) }));
      panel.append(h('p', { class: 'wl-detail', text: t('conversationLocal.modelChosen', { model: model().id }) }));
      panel.append(h('div', { class: 'wl-row' },
        h('button', {
          type: 'button', class: 'btn primary', text: t('conversationLocal.download'),
          onclick: (event) => {
            event.currentTarget.disabled = true;
            download().catch(() => { /* shown in the panel */ });
          },
        })));
    };

    const unsubscribe = subscribe(() => {
      if (panel.isConnected) paint();
      else unsubscribe();
    });
    paint();
    return panel;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  const provider = {
    id: 'on-device',
    get name() { return t('conversationLocal.name'); },
    init,
    status: () => status,
    reason: () => reason,
    model,
    progress: () => ({ ...progress }),
    available: () => status === 'ready',
    download,
    cancel,
    clearModel,
    send,
    subscribe,
    renderConfig,
  };
  return provider;
}

/** Factory name both providers.js and tests look for. */
export const createOnDeviceProvider = createProvider;
export default createProvider;