# Chat with an AI — `#/extras/conversation`

Practice written Chinese with an AI partner. **Free for the developer, no server
of ours**: the user plugs in their own provider, and any key stays in their
browser. No key ever lives in this repo or in a build.

## Providers

A provider is one object with a common interface:

```js
{ id, name, available() -> boolean, send(messages, { signal }) -> AsyncIterable<string> }
```

`send` returns an async generator yielding the reply as text deltas
(streaming). Failures throw a `ProviderError` whose `kind` is one of
`'auth'` (401/403), `'rate-limit'` (429), `'network'`, `'http'`.

| id | What it is | Free? |
| --- | --- | --- |
| `openrouter` | The user's own OpenRouter key, stored only in `storage('settings','openrouterKey')` | yes, on the free model list |
| `ollama` | The user's own Ollama server URL (e.g. at home over Tailscale) | yes |
| `on-device` | WebLLM in the browser (`src/chat/webllm-provider.js`), model cached in the Cache API | yes, after a one-time ~1 GB download |

### OpenRouter

- The model list is fetched live from `https://openrouter.ai/api/v1/models`.
  Free models are those with `pricing.prompt === 0` and `pricing.completion === 0`.
- Recommended free models (only if present in the live list):
  `baidu/ernie-5.5-flash-preview:free`, `google/gemma-4-31b-it:free`,
  `nvidia/nemotron-3-ultra-550b-a55b:free`; otherwise the first free model with a
  Chinese-friendly id.
- A **Cheap paid models** section lists the cheapest paid models (ascending
  blended price per million tokens) with an on-screen cost estimate per 1000
  messages.
- Chat calls `POST https://openrouter.ai/api/v1/chat/completions` with
  `stream: true` (SSE). On `429`, the screen offers to switch model without
  losing the conversation.

### Ollama

- Configurable base URL, called at `<url>/api/chat` (newline-delimited JSON
  stream).
- From GitHub Pages (https) a plain `http://` URL will not work: an `https://`
  URL is needed (for example a Tailscale Serve/MagicDNS name).

## Help screen (no key yet)

With no provider configured, the screen shows the steps to get a free key:
create an account, make a **dedicated** key with a **spending limit** (e.g. 1
USD), paste it (saved in this browser only), pick a free model. It states the
honest limits: free models have a daily cap (50/day, or 1000/day after ever
topping up $10) and may use messages for training; paid models do not.

## Conversation

- HSK level 1–3, predefined situations (introductions, ordering food,
  directions, shopping).
- Replies come as `{zh, pinyin, en, correction}`: hanzi with tappable words,
  pinyin coloured by `pinyinHtml()` (src/tone.js), a tappable translation, and
  a short correction note.
- Buttons: **Listen** (`speak()` from src/audio.js), tap a word to add it to
  review (`dictionary.lookup` + `srs.addToReview`, source `conversation`),
  **New conversation**.
- Local history is capped (`conversationHistory` in the settings store, last
  20 messages); what is sent to the model is trimmed further
  (`HISTORY_LIMIT` = 12 non-system messages).

## On-device model (WebLLM)

`src/chat/webllm-provider.js` adds a provider with id `on-device`, selected in
the same Settings panel. It runs a small quantized model **inside the tab**
(WebLLM, Apache-2.0, WebGPU): no key, no server, and nothing leaves the device.

- **Lazy load.** WebLLM is not an npm dependency: `import()` of a *pinned* CDN
  build (`https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.89/+esm`) happens
  only when the user presses **Download model**. Opening the app or the screen
  makes no request to that CDN.
- **Support check.** Needs `navigator.gpu` **and** a real adapter. Without it the
  panel says *not supported* and offers no download button (the other providers
  keep working). Chrome/Edge on desktop, or Chrome on a recent Android phone.
- **Model choice.** `navigator.deviceMemory >= 8` → `Qwen2.5-1.5B-Instruct-q4f16_1-MLC`
  (better Chinese), otherwise `Qwen2.5-0.5B-Instruct-q4f16_1-MLC`
  (`pickModel()`). The chosen id is saved in `settings.onDeviceModel` so a
  reload never downloads the other one by mistake.
- **Download.** About 0.95 GB (0.5B) / 1.0 GB (1.5B) of weights, cached by
  WebLLM in the Cache API (`webllm*`). The panel warns about the size and
  recommends Wi-Fi, shows a progress bar with the engine's own progress text,
  and a **Cancel** button. WebLLM cannot abort a fetch in flight, so Cancel
  stops waiting and the engine is dropped as soon as (if) it finishes loading.
- **After the first download** the model loads from cache and the chat works
  offline. **Delete the model from the cache** unloads the engine and deletes
  the `webllm*` caches (and the saved model id).
- Streaming is the same contract as any provider: `send()` yields text deltas;
  an aborted `signal` calls `engine.interruptGenerate()`.
- Quality is limited: it is good for short HSK 1–2 sentences and JSON-shaped
  replies; expect weaker grammar and the occasional simplified-Chinese slip than
  with a bigger cloud model.

Measured on this machine (headless Chromium via Playwright, no real model
downloaded — WebGPU is unavailable there, see below): **speed and HSK 1 dialogue
quality could not be measured.** The headless browser exposes no usable WebGPU
adapter, so WebLLM cannot start, and running the real weights was out of scope
for the test suite (tests use a fake engine, no network). No numbers are
invented here; to get real ones, open the app in Chrome on a machine with
WebGPU, choose **On-device (browser)**, download the model, and read the reply
speed in the panel/devtools (tokens/s ≈ characters ÷ seconds for Chinese).

## Modules

- `src/chat/providers.js` — providers, model helpers, streaming, history trim.
- `src/chat/prompts.js` — system prompt, scenarios, `parseReply`.
- `src/chat/webllm-provider.js` — the on-device provider (WebGPU, lazy CDN).
- `src/extras/conversation.js` — the screen (`titleKey` + `render`).
- `src/locales/en.d/conversation.json`, `src/locales/es.d/conversation.json`.

Tests: `node --test tests/chat-providers.test.mjs` (mocked `fetch`, no network).
