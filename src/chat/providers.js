/**
 * providers.js — pluggable chat providers for #/extras/conversation.
 *
 * One interface, so the screen never knows which backend it talks to:
 *   { id, name, available() -> boolean, send(messages, {signal}) -> AsyncIterable<string> }
 *
 * `send` returns an async generator that yields the reply as text deltas
 * (streaming). Errors are thrown as ProviderError with a `kind`:
 *   'auth' (401/403) | 'rate-limit' (429) | 'network' | 'http'.
 *
 * Built-in providers (both free for the developer — no server of ours):
 *   - OpenRouter  : the user's OWN key, kept only in their browser storage.
 *   - Ollama      : the user's own server URL (e.g. at home over Tailscale).
 *   - On-device   : optional, provided by another task (src/chat/on-device.js);
 *                   if that module is absent the provider simply does not show.
 *
 * No API key ever lives in the repo. Pure helpers (model filtering, price
 * estimate, history trimming, stream parsing) are exported for tests.
 */

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Free models we suggest first, best for Chinese; only used if present in the live list. */
export const RECOMMENDED_FREE_IDS = [
  'baidu/ernie-5.5-flash-preview:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
];

/** Non-system messages kept when sending to the model (local history is capped too). */
export const HISTORY_LIMIT = 12;

/** Rough per-message budget used for the on-screen cost estimate. */
export const TOKENS_PER_MESSAGE = { in: 300, out: 200 };

export class ProviderError extends Error {
  constructor(message, { kind = 'http', status = 0, cause } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

function kindForStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  return 'http';
}

/** Yield the lines of a streaming Response body (handles CRLF and a trailing partial line). */
async function* streamLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) yield buf.replace(/\r$/, '');
}

/**
 * Generic streaming POST. Handles both SSE (`data: {...}` lines, OpenRouter)
 * and newline-delimited JSON (bare `{...}` lines, Ollama). `extract(json)`
 * returns the text delta (or null); `isDone(json)` ends the stream early.
 */
async function* streamChat({ url, headers, body, fetchImpl, signal, extract, isDone }) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    throw new ProviderError('network error', { kind: 'network', cause: err });
  }
  if (!res.ok) {
    throw new ProviderError(`HTTP ${res.status}`, { kind: kindForStatus(res.status), status: res.status });
  }
  if (!res.body) throw new ProviderError('no response body', { kind: 'network' });

  for await (const line of streamLines(res)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (!payload || payload === '[DONE]') continue;
    let json;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    if (isDone && isDone(json)) return;
    const delta = extract(json);
    if (delta) yield delta;
  }
}

// ------------------------------------------------------------ providers

export function createOpenRouterProvider({ apiKey, model, fetchImpl = globalThis.fetch, referer, title } = {}) {
  return {
    id: 'openrouter',
    name: 'OpenRouter',
    available: () => Boolean(apiKey && model && fetchImpl),
    send(messages, { signal } = {}) {
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
      if (referer) headers['HTTP-Referer'] = referer;
      if (title) headers['X-Title'] = title;
      return streamChat({
        url: OPENROUTER_CHAT_URL,
        headers,
        body: { model, messages, stream: true },
        fetchImpl,
        signal,
        extract: (j) => j?.choices?.[0]?.delta?.content ?? null,
      });
    },
  };
}

export function createOllamaProvider({ baseUrl, model, fetchImpl = globalThis.fetch } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return {
    id: 'ollama',
    name: 'Ollama',
    available: () => Boolean(base && fetchImpl),
    send(messages, { signal } = {}) {
      return streamChat({
        url: `${base}/api/chat`,
        headers: { 'Content-Type': 'application/json' },
        body: { model: model || 'llama3', messages, stream: true },
        fetchImpl,
        signal,
        extract: (j) => j?.message?.content ?? null,
        isDone: (j) => j?.done === true,
      });
    },
  };
}

/** Providers the user has configured (both key and URL live only in their browser). */
export function configuredProviders(settings = {}, { fetchImpl } = {}) {
  const out = [];
  if (settings.openrouterKey) {
    out.push(createOpenRouterProvider({ apiKey: settings.openrouterKey, model: settings.openrouterModel, fetchImpl }));
  }
  if (settings.ollamaUrl) {
    out.push(createOllamaProvider({ baseUrl: settings.ollamaUrl, model: settings.ollamaModel, fetchImpl }));
  }
  return out;
}

/**
 * Optional on-device provider, shipped by another task. Returns null when the
 * module is not there yet, so the choice never appears until it exists.
 */
export async function loadOnDeviceProvider(config = {}) {
  try {
    const mod = await import('./on-device.js');
    const factory = mod.createProvider || mod.createOnDeviceProvider || mod.default;
    if (typeof factory !== 'function') return null;
    const provider = factory(config) || {};
    if (!provider.id) provider.id = 'on-device';
    if (typeof provider.name !== 'string') provider.name = 'On-device';
    if (typeof provider.available !== 'function') provider.available = () => true;
    return provider;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ model list

/** A model is free when both prompt and completion price are 0 (or its id says ':free'). */
export function isFreeModel(model) {
  const p = model?.pricing || {};
  const prompt = Number(p.prompt);
  const completion = Number(p.completion);
  if (Number.isFinite(prompt) && Number.isFinite(completion)) return prompt === 0 && completion === 0;
  return String(model?.id || '').endsWith(':free');
}

export function freeModels(models = []) {
  return models.filter(isFreeModel);
}

export function paidModels(models = []) {
  return models.filter((m) => !isFreeModel(m));
}

/** First recommended id that exists in the live list, else a Chinese-friendly free model, else any free one. */
export function recommendFreeModel(models = []) {
  const free = freeModels(models);
  for (const id of RECOMMENDED_FREE_IDS) {
    const hit = free.find((m) => m.id === id);
    if (hit) return hit;
  }
  const zh = free.find((m) => /qwen|deepseek|glm|ernie|yi-|minimax|gemma/i.test(String(m.id || '')));
  return zh || free[0] || null;
}

/** Prices per million tokens, `blended` = prompt + completion (for cheap-first ordering). */
export function pricePerMillion(model) {
  const p = model?.pricing || {};
  const prompt = Number(p.prompt || 0) * 1e6;
  const completion = Number(p.completion || 0) * 1e6;
  return { prompt, completion, blended: prompt + completion };
}

/** Cheapest paid models first, `limit` of them. */
export function cheapPaidModels(models = [], limit = 3) {
  return paidModels(models)
    .map((model) => ({ model, price: pricePerMillion(model) }))
    .sort((a, b) => a.price.blended - b.price.blended)
    .slice(0, limit);
}

/** USD for 1000 messages of TOKENS_PER_MESSAGE, given the model's per-token prices. */
export function estimateCostPer1000(model) {
  const p = model?.pricing || {};
  const usd = (TOKENS_PER_MESSAGE.in * Number(p.prompt || 0) + TOKENS_PER_MESSAGE.out * Number(p.completion || 0)) * 1000;
  return usd;
}

export async function fetchModels(fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(OPENROUTER_MODELS_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new ProviderError(`HTTP ${res.status}`, { kind: kindForStatus(res.status), status: res.status });
  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

// ------------------------------------------------------------ history

/** Keep the system prompt(s) plus the last `limit` non-system messages. */
export function trimHistory(messages = [], limit = HISTORY_LIMIT) {
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  return [...system, ...rest.slice(-limit)];
}
