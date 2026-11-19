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
| `on-device` | Optional, shipped by another task as `src/chat/on-device.js`; hidden until it exists | yes |

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

## Modules

- `src/chat/providers.js` — providers, model helpers, streaming, history trim.
- `src/chat/prompts.js` — system prompt, scenarios, `parseReply`.
- `src/extras/conversation.js` — the screen (`titleKey` + `render`).
- `src/locales/en.d/conversation.json`, `src/locales/es.d/conversation.json`.

Tests: `node --test tests/chat-providers.test.mjs` (mocked `fetch`, no network).
