/**
 * conversation.js — #/extras/conversation
 *
 * Written Chinese practice with an AI partner. Free for the developer, no
 * server of ours: the user plugs in THEIR OWN provider —
 *   - OpenRouter, with their own key (kept only in this browser), or
 *   - Ollama, on their own machine (e.g. at home over Tailscale) —
 * and, later, an on-device model if another task ships src/chat/on-device.js.
 *
 * Contract: titleKey + render(container, ctx), same as any src/extras/*.js.
 * All text via t() from src/locales/en.d/conversation.json (and es.d/…).
 * Pinyin is always rendered with pinyinHtml() from src/tone.js.
 *
 * Test hook: `configure({ providers })` injects provider objects (so headless
 * runs need no network); `reset()` restores the real ones.
 */

import { t } from '../i18n.js';
import { h, reset } from '../dom.js';
import storage from '../storage.js';
import { speak, isTtsAvailable } from '../audio.js';
import { pinyinHtml } from '../tone.js';
import { lookup, segment } from '../dictionary.js';
import { addToReview } from '../srs.js';
import {
  configuredProviders,
  loadOnDeviceProvider,
  fetchModels,
  recommendFreeModel,
  cheapPaidModels,
  estimateCostPer1000,
} from '../chat/providers.js';
import { HSK_LEVELS, SCENARIOS, buildMessages, parseReply, openerFor } from '../chat/prompts.js';

export const titleKey = 'hubs.extras.conversation';

/** Local history kept in storage (messages, both sides). */
const LOCAL_LIMIT = 20;

const STYLE_ID = 'conv-style';
const CSS = `
.conv { display: flex; flex-direction: column; gap: 0.75rem; }
.conv h2 { margin: 0; font-size: 1.2rem; }
.conv-config { border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg-soft); }
.conv-config > summary { padding: 0.6rem 0.75rem; cursor: pointer; font-weight: 600; }
.conv-config > .conv-body { display: flex; flex-direction: column; gap: 0.6rem; padding: 0 0.75rem 0.75rem; }
.conv label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; color: var(--fg-soft); }
.conv input, .conv select, .conv textarea { width: 100%; }
.conv-hint { margin: 0; font-size: 0.8rem; color: var(--fg-soft); }
.conv-help { border: 1px solid var(--line); border-radius: var(--radius); padding: 0.75rem; }
.conv-help ol { margin: 0.4rem 0; padding-left: 1.2rem; }
.conv-help li { margin: 0.25rem 0; }
.conv-chip-row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.conv-chip { border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: inherit;
  font: inherit; font-size: 0.85rem; padding: 0.25rem 0.7rem; }
.conv-chip[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); font-weight: 600; }
.conv-messages { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
.conv-msg { display: flex; }
.conv-user { justify-content: flex-end; }
.conv-bubble { max-width: 90%; padding: 0.5rem 0.7rem; border-radius: var(--radius);
  border: 1px solid var(--line); background: var(--bg-soft); }
.conv-user .conv-bubble { background: var(--bg); border-color: var(--accent); }
.conv-zh { font-size: 1.4rem; line-height: 1.7; }
.conv-word { border: 0; background: none; color: inherit; font: inherit; padding: 0 0.05rem; cursor: pointer; }
.conv-word:active { color: var(--accent); }
.conv-pinyin { font-size: 0.95rem; margin-top: 0.15rem; }
.conv-en { margin-top: 0.2rem; color: var(--fg-soft); font-size: 0.9rem; }
.conv-toggle { margin-top: 0.3rem; border: 0; background: none; color: var(--accent); font: inherit;
  font-size: 0.8rem; padding: 0; cursor: pointer; }
.conv-correction { margin-top: 0.3rem; font-size: 0.85rem; color: var(--accent); }
.conv-actions { display: flex; gap: 0.5rem; margin-top: 0.4rem; }
.conv-act { border: 0; background: none; color: var(--accent); font: inherit; font-size: 0.85rem;
  padding: 0; cursor: pointer; }
.conv-compose { display: flex; gap: 0.5rem; align-items: flex-end; }
.conv-compose textarea { flex: 1; resize: vertical; min-height: 2.6rem; }
.conv-status { margin: 0; min-height: 1.1rem; font-size: 0.85rem; color: var(--fg-soft); }
.conv-error { color: var(--accent); }
.conv-row { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
`;

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}

const CONFIG_KEYS = {
  provider: 'conversationProvider',
  openrouterKey: 'openrouterKey',
  openrouterModel: 'openrouterModel',
  ollamaUrl: 'ollamaUrl',
  ollamaModel: 'ollamaModel',
  level: 'chatLevel',
  scenario: 'chatScenario',
  history: 'conversationHistory',
};

let injected = null;
/** Tests: inject fake providers (skips the real ones and the model fetch). */
export function configure({ providers } = {}) {
  injected = Array.isArray(providers) ? providers : null;
}
export function resetProviders() {
  injected = null;
}

async function loadConfig() {
  const get = (key, fallback) => storage.get('settings', key).then((v) => (v === undefined ? fallback : v));
  const [provider, openrouterKey, openrouterModel, ollamaUrl, ollamaModel, level, scenario, history] = await Promise.all([
    get(CONFIG_KEYS.provider, 'openrouter'),
    get(CONFIG_KEYS.openrouterKey, ''),
    get(CONFIG_KEYS.openrouterModel, ''),
    get(CONFIG_KEYS.ollamaUrl, ''),
    get(CONFIG_KEYS.ollamaModel, ''),
    get(CONFIG_KEYS.level, 1),
    get(CONFIG_KEYS.scenario, 'introductions'),
    get(CONFIG_KEYS.history, []),
  ]);
  return { provider, openrouterKey, openrouterModel, ollamaUrl, ollamaModel, level, scenario, history };
}

export function render(container, ctx = {}) {
  ensureStyles(document);

  const state = {
    disposed: false,
    config: null,
    providers: [],
    onDevice: null,
    messages: [],
    models: null,
    modelsError: false,
    busy: false,
    status: '',
    statusError: false,
  };

  const root = h('section', { class: 'conv' });
  reset(container).append(root);
  container.focus({ preventScroll: true });

  const status = h('p', { class: 'conv-status', role: 'status', 'aria-live': 'polite' });

  function setStatus(text, isError = false) {
    state.status = text;
    state.statusError = isError;
    status.textContent = text;
    status.className = `conv-status${isError ? ' conv-error' : ''}`;
  }

  function currentProvider() {
    const wanted = state.config?.provider;
    const preferred = state.providers.find((p) => p.id === wanted);
    if (preferred?.available()) return preferred;
    // An on-device model that is not downloaded yet: its config panel explains
    // why, so do not silently fall back to another provider.
    if (preferred?.id === 'on-device') return null;
    return state.providers.find((p) => p.available()) || null;
  }

  async function reloadProviders() {
    if (injected) {
      state.providers = [...injected];
      state.onDevice = null;
      return;
    }
    state.providers = configuredProviders(state.config || {});
    state.onDevice = await loadOnDeviceProvider();
    // On-device owns its own panel (download / progress / "not supported"), so it
    // is listed even before a model is cached — only if that hook exists.
    if (state.onDevice) {
      if (typeof state.onDevice.init === 'function') await state.onDevice.init();
      state.providers.push(state.onDevice);
    }
  }

  function persist() {
    return storage.set('settings', CONFIG_KEYS.history, state.messages.slice(-LOCAL_LIMIT));
  }

  // ------------------------------------------------------ config panel

  function renderConfig() {
    const cfg = state.config;
    const details = h('details', { class: 'conv-config' });
    details.append(h('summary', { text: t('conversation.settings') }));
    const body = h('div', { class: 'conv-body' });

    const providerSelect = h('select', { class: 'field', 'aria-label': t('conversation.provider') },
      h('option', { value: 'openrouter', text: t('conversation.providerOpenrouter') }),
      h('option', { value: 'ollama', text: t('conversation.providerOllama') }),
      state.onDevice ? h('option', { value: 'on-device', text: t('conversation.providerOnDevice') }) : null,
    );
    providerSelect.value = cfg.provider;
    providerSelect.addEventListener('change', () => {
      cfg.provider = providerSelect.value;
      storage.set('settings', CONFIG_KEYS.provider, cfg.provider);
      paint();
    });
    body.append(h('label', {}, t('conversation.provider'), providerSelect));

    if (cfg.provider === 'openrouter') {
      body.append(renderOpenRouterConfig(cfg));
    } else if (cfg.provider === 'ollama') {
      body.append(renderOllamaConfig(cfg));
    } else if (cfg.provider === 'on-device' && state.onDevice?.renderConfig) {
      body.append(state.onDevice.renderConfig());
      if (!state.onDevice.available()) details.open = true;
    }

    details.append(body);
    return details;
  }

  function field(labelKey, value, { type = 'text', placeholder = '', oninput } = {}) {
    const input = h('input', { class: 'field', type, value, placeholder, autocomplete: 'off' });
    input.addEventListener('input', () => oninput(input.value));
    return h('label', {}, t(labelKey), input);
  }

  function renderOpenRouterConfig(cfg) {
    const wrap = h('div', { class: 'conv-body' });
    wrap.append(field('conversation.apiKey', cfg.openrouterKey, {
      type: 'password',
      placeholder: t('conversation.apiKeyPlaceholder'),
      oninput: (value) => { cfg.openrouterKey = value.trim(); storage.set('settings', CONFIG_KEYS.openrouterKey, cfg.openrouterKey); },
    }));
    wrap.append(h('p', { class: 'conv-hint', text: t('conversation.freeNotice') }));

    // Model picker (populated from the live free list; lazy, never blocks render)
    const modelSelect = h('select', { class: 'field', 'aria-label': t('conversation.model') });
    if (state.models) {
      const rec = recommendFreeModel(state.models);
      for (const m of state.models.filter((x) => String(x.id).endsWith(':free') || isFree(x))) {
        modelSelect.append(h('option', { value: m.id, text: m.id === rec?.id ? `${m.id} ★` : m.id }));
      }
      if (cfg.openrouterModel && ![...modelSelect.options].some((o) => o.value === cfg.openrouterModel)) {
        modelSelect.append(h('option', { value: cfg.openrouterModel, text: cfg.openrouterModel }));
      }
      const cheap = cheapPaidModels(state.models, 3);
      if (cheap.length) {
        const group = h('optgroup', { label: t('conversation.cheapTitle') });
        for (const { model } of cheap) group.append(h('option', { value: model.id, text: model.id }));
        modelSelect.append(group);
        const est = cheap[0];
        wrap.append(h('p', { class: 'conv-hint', text: t('conversation.cheapEstimate', { usd: estimateCostPer1000(est.model).toFixed(3) }) }));
      }
      modelSelect.value = cfg.openrouterModel || rec?.id || '';
    } else if (state.modelsError) {
      wrap.append(h('p', { class: 'conv-hint conv-error', text: t('conversation.modelsError') }));
    } else {
      wrap.append(h('p', { class: 'conv-hint', text: t('conversation.loadingModels') }));
    }
    modelSelect.addEventListener('change', () => {
      cfg.openrouterModel = modelSelect.value;
      storage.set('settings', CONFIG_KEYS.openrouterModel, cfg.openrouterModel);
    });
    wrap.append(h('label', {}, t('conversation.model'), modelSelect));
    return wrap;
  }

  function renderOllamaConfig(cfg) {
    const wrap = h('div', { class: 'conv-body' });
    wrap.append(field('conversation.ollamaModel', cfg.ollamaModel, {
      placeholder: 'llama3',
      oninput: (value) => { cfg.ollamaModel = value.trim(); storage.set('settings', CONFIG_KEYS.ollamaModel, cfg.ollamaModel); },
    }));
    wrap.append(field('conversation.ollamaUrl', cfg.ollamaUrl, {
      placeholder: 'https://my-host.ts.net',
      oninput: (value) => { cfg.ollamaUrl = value.trim(); storage.set('settings', CONFIG_KEYS.ollamaUrl, cfg.ollamaUrl); },
    }));
    wrap.append(h('p', { class: 'conv-hint', text: t('conversation.ollamaUrlHint') }));
    return wrap;
  }

  function renderHelp() {
    const box = h('section', { class: 'conv-help' });
    box.append(h('h3', { text: t('conversation.helpTitle') }));
    const list = h('ol');
    for (const key of ['helpStep1', 'helpStep2', 'helpStep3', 'helpStep4']) {
      list.append(h('li', { text: t(`conversation.${key}`) }));
    }
    box.append(list);
    box.append(h('p', { class: 'conv-hint', text: t('conversation.helpWarning') }));
    return box;
  }

  // ------------------------------------------------------ chat panel

  function renderChat(provider) {
    const wrap = h('div', { class: 'conv-body' });

    // Scenario chips
    const chipRow = h('div', { class: 'conv-chip-row', 'aria-label': t('conversation.scenarioLabel') });
    for (const sc of SCENARIOS) {
      const chip = h('button', {
        type: 'button',
        class: 'conv-chip',
        text: t(sc.labelKey),
        'aria-pressed': state.config.scenario === sc.id ? 'true' : 'false',
        onclick: () => {
          state.config.scenario = sc.id;
          storage.set('settings', CONFIG_KEYS.scenario, sc.id);
          startNewConversation();
        },
      });
      chipRow.append(chip);
    }
    wrap.append(chipRow);

    // Level select
    const levelSelect = h('select', { class: 'field', 'aria-label': t('conversation.level') },
      ...HSK_LEVELS.map((lvl) => h('option', { value: String(lvl), text: `HSK ${lvl}` })),
    );
    levelSelect.value = String(state.config.level);
    levelSelect.addEventListener('change', () => {
      state.config.level = Number(levelSelect.value);
      storage.set('settings', CONFIG_KEYS.level, state.config.level);
    });
    wrap.append(h('label', {}, t('conversation.level'), levelSelect));

    // Messages
    const list = h('ul', { class: 'conv-messages' });
    for (const msg of state.messages) list.append(renderMessage(msg));
    wrap.append(list);

    wrap.append(status);

    // Compose
    const textarea = h('textarea', {
      class: 'field', name: 'msg', rows: '2',
      placeholder: t('conversation.inputPlaceholder'), 'aria-label': t('conversation.inputPlaceholder'),
    });
    const send = h('button', { type: 'submit', class: 'btn primary', text: t('conversation.send'), disabled: state.busy });
    const newBtn = h('button', { type: 'button', class: 'btn', text: t('conversation.newChat'), onclick: startNewConversation });
    const form = h('form', {
      class: 'conv-compose',
      onsubmit: (event) => { event.preventDefault(); sendMessage(provider, textarea.value, textarea, send, list); },
    }, textarea, send);
    wrap.append(form);
    wrap.append(h('div', { class: 'conv-row' }, newBtn));
    return wrap;
  }

  function renderMessage(msg) {
    if (msg.role === 'user') {
      return h('li', { class: 'conv-msg conv-user' },
        h('div', { class: 'conv-bubble' }, h('span', { text: msg.zh || msg.content || '' })));
    }
    const bubble = h('div', { class: 'conv-bubble' });
    bubble.append(renderWords(msg.zh || ''));
    if (msg.pinyin) bubble.append(h('div', { class: 'conv-pinyin', html: pinyinHtml(msg.pinyin) }));
    if (msg.en) {
      const enEl = h('div', { class: 'conv-en', hidden: true, text: msg.en });
      const toggle = h('button', {
        type: 'button', class: 'conv-toggle', text: t('conversation.showTranslation'),
        onclick: () => {
          enEl.hidden = !enEl.hidden;
          toggle.textContent = enEl.hidden ? t('conversation.showTranslation') : t('conversation.hideTranslation');
        },
      });
      bubble.append(toggle, enEl);
    }
    if (msg.correction) bubble.append(h('div', { class: 'conv-correction', text: t('conversation.correction', { note: msg.correction }) }));
    if (msg.zh && isTtsAvailable()) {
      bubble.append(h('div', { class: 'conv-actions' },
        h('button', { type: 'button', class: 'conv-act', text: t('conversation.listen'), onclick: () => speak(msg.zh, { lang: 'zh-CN' }) })));
    }
    return h('li', { class: 'conv-msg conv-ai' }, bubble);
  }

  function renderWords(text) {
    const wrap = h('div', { class: 'conv-zh' });
    (async () => {
      let parts;
      try {
        parts = await segment(text);
      } catch {
        parts = [text];
      }
      if (state.disposed) return;
      for (const part of parts) {
        if (/[\u3400-\u9fff]/.test(part)) {
          wrap.append(h('button', { type: 'button', class: 'conv-word', text: part, onclick: () => addWord(part) }));
        } else {
          wrap.append(document.createTextNode(part));
        }
      }
    })();
    return wrap;
  }

  async function addWord(word) {
    try {
      const entry = await lookup(word);
      await addToReview({
        id: `conversation:${word}`,
        hanzi: word,
        pinyin: entry?.pinyin || '',
        english: entry?.english || '',
        source: 'conversation',
      });
      setStatus(t('conversation.addedToReview', { word }));
    } catch (err) {
      console.error('conversation: cannot add word', err);
    }
  }

  function startNewConversation() {
    state.messages = [{ role: 'assistant', ...openerFor(state.config.scenario) }];
    persist();
    paint();
  }

  async function sendMessage(provider, rawText, textarea, sendBtn, list) {
    const text = String(rawText || '').trim();
    if (!text || state.busy) return;
    state.busy = true;
    sendBtn.disabled = true;
    setStatus(t('conversation.thinking'));

    state.messages.push({ role: 'user', zh: text });
    list.append(renderMessage(state.messages[state.messages.length - 1]));
    textarea.value = '';

    const live = h('li', { class: 'conv-msg conv-ai' }, h('div', { class: 'conv-bubble' }, h('span', { text: '' })));
    list.append(live);
    const liveSpan = live.querySelector('span');

    try {
      const history = state.messages.map((m) => ({
        role: m.role,
        content: m.role === 'user' ? (m.zh || m.content || '') : (m.zh || ''),
      }));
      const payload = buildMessages({ level: state.config.level, scenario: state.config.scenario, history });
      let acc = '';
      for await (const delta of provider.send(payload)) {
        if (state.disposed) return;
        acc += delta;
        liveSpan.textContent = acc;
      }
      const parsed = parseReply(acc);
      state.messages.push({ role: 'assistant', ...parsed });
      persist();
      setStatus('');
      window.dispatchEvent(new CustomEvent('chino:lesson_done', { detail: { source: 'conversation' } }));
      state.busy = false;
      paint();
    } catch (err) {
      live.remove();
      handleSendError(err, provider);
    } finally {
      state.busy = false;
      sendBtn.disabled = false;
    }
  }

  function handleSendError(err, provider) {
    const kind = err?.kind || 'http';
    const key = kind === 'auth' ? 'errorAuth' : kind === 'rate-limit' ? 'errorRateLimit' : kind === 'network' ? 'errorNetwork' : 'errorGeneric';
    setStatus(t(`conversation.${key}`), true);
    if (kind === 'rate-limit') offerModelSwitch(provider);
  }

  function offerModelSwitch() {
    const box = root.querySelector('.conv-compose')?.parentElement || root;
    box.insertBefore(h('div', { class: 'conv-row' },
      h('button', {
        type: 'button', class: 'btn', text: t('conversation.switchModel'),
        onclick: () => {
          state.config.openrouterModel = '';
          storage.set('settings', CONFIG_KEYS.openrouterModel, '');
          state.models = null;
          paint();
        },
      }),
    ), status);
  }

  // ------------------------------------------------------ paint

  function paint() {
    if (state.disposed) return;
    root.replaceChildren();
    root.append(h('h2', { text: t(titleKey) }));
    root.append(renderConfig());

    const provider = currentProvider();
    if (provider) {
      if (!state.messages.length) state.messages = [{ role: 'assistant', ...openerFor(state.config.scenario) }];
      root.append(renderChat(provider));
      loadModelsOnce();
    } else if (state.config?.provider !== 'on-device' || !state.onDevice) {
      root.append(h('p', { class: 'conv-hint', text: t('conversation.notConfigured') }));
      root.append(renderHelp());
    }
  }

  async function loadModelsOnce() {
    if (injected || state.models || state.modelsError) return;
    if (state.config.provider !== 'openrouter' || !state.config.openrouterKey) return;
    try {
      state.models = await fetchModels();
      if (!state.disposed) paint();
    } catch {
      state.modelsError = true;
      if (!state.disposed) paint();
    }
  }

  (async () => {
    state.config = await loadConfig();
    await reloadProviders();
    if (state.disposed) return;
    state.messages = Array.isArray(state.config.history) ? state.config.history.filter(Boolean) : [];
    paint();
  })();

  return () => { state.disposed = true; };
}

/** Local copy of the free-model rule, to avoid importing it just for the picker. */
function isFree(model) {
  const p = model?.pricing || {};
  return Number(p.prompt) === 0 && Number(p.completion) === 0;
}
