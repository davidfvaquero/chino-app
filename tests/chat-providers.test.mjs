// chat providers + prompts (browser-free). Mocked fetch only — NO real network.
// Run: node --test tests/chat-providers.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createOpenRouterProvider,
  createOllamaProvider,
  configuredProviders,
  ProviderError,
  isFreeModel,
  freeModels,
  paidModels,
  recommendFreeModel,
  cheapPaidModels,
  pricePerMillion,
  estimateCostPer1000,
  trimHistory,
  HISTORY_LIMIT,
} from '../src/chat/providers.js';
import {
  HSK_LEVELS,
  SCENARIOS,
  buildSystemPrompt,
  buildMessages,
  parseReply,
  openerFor,
} from '../src/chat/prompts.js';

// ---------------------------------------------------------------- helpers

/** A streaming Response built from raw text chunks. */
function streamResponse(chunks, { status = 200 } = {}) {
  if (status !== 200) return new Response('nope', { status });
  const body = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status });
}

async function collect(iterable) {
  let out = '';
  for await (const delta of iterable) out += delta;
  return out;
}

const orChunk = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

// ---------------------------------------------------------------- streaming

test('OpenRouter: streams SSE deltas, sends the key, model and stream flag', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return streamResponse([orChunk('你'), orChunk('好'), 'data: [DONE]\n\n']);
  };
  const provider = createOpenRouterProvider({ apiKey: 'sk-test', model: 'foo:free', fetchImpl });
  assert.equal(provider.available(), true);

  const text = await collect(provider.send([{ role: 'user', content: 'hi' }]));
  assert.equal(text, '你好');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.model, 'foo:free');
  assert.equal(body.stream, true);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }]);
});

test('OpenRouter: unavailable without a key', () => {
  assert.equal(createOpenRouterProvider({ model: 'x' }).available(), false);
});

test('Ollama: parses newline-delimited JSON and stops on done', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return streamResponse([
      `${JSON.stringify({ message: { content: '你' }, done: false })}\n`,
      `${JSON.stringify({ message: { content: '好' }, done: false })}\n`,
      `${JSON.stringify({ message: { content: '' }, done: true })}\n`,
    ]);
  };
  const provider = createOllamaProvider({ baseUrl: 'https://host.ts.net/', model: 'qwen', fetchImpl });
  const text = await collect(provider.send([{ role: 'user', content: 'hi' }]));
  assert.equal(text, '你好');
  assert.equal(calls[0].url, 'https://host.ts.net/api/chat');
});

test('errors: 401 -> auth, 429 -> rate-limit, network -> network', async () => {
  const provider401 = createOpenRouterProvider({ apiKey: 'k', model: 'm', fetchImpl: async () => streamResponse([], { status: 401 }) });
  await assert.rejects(collect(provider401.send([])), (err) => err instanceof ProviderError && err.kind === 'auth');

  const provider429 = createOpenRouterProvider({ apiKey: 'k', model: 'm', fetchImpl: async () => streamResponse([], { status: 429 }) });
  await assert.rejects(collect(provider429.send([])), (err) => err instanceof ProviderError && err.kind === 'rate-limit' && err.status === 429);

  const providerNet = createOpenRouterProvider({ apiKey: 'k', model: 'm', fetchImpl: async () => { throw new TypeError('failed'); } });
  await assert.rejects(collect(providerNet.send([])), (err) => err instanceof ProviderError && err.kind === 'network');
});

// ---------------------------------------------------------------- models

const MODELS = [
  { id: 'baidu/ernie-5.5-flash-preview:free', pricing: { prompt: '0', completion: '0' } },
  { id: 'some/other:free', pricing: { prompt: '0', completion: '0' } },
  { id: 'qwen/qwen3.7-flash', pricing: { prompt: '0.0000002', completion: '0.0000008' } },
  { id: 'deepseek/deepseek-v4-flash', pricing: { prompt: '0.0000001', completion: '0.0000003' } },
  { id: 'big/flagship', pricing: { prompt: '0.00001', completion: '0.00003' } },
];

test('free/paid split and recommendation', () => {
  assert.equal(freeModels(MODELS).length, 2);
  assert.equal(paidModels(MODELS).length, 3);
  assert.equal(isFreeModel(MODELS[0]), true);
  assert.equal(isFreeModel(MODELS[2]), false);
  // Recommended id present -> wins
  assert.equal(recommendFreeModel(MODELS).id, 'baidu/ernie-5.5-flash-preview:free');
  // Recommended absent -> a Chinese-friendly free model
  const without = MODELS.filter((m) => !m.id.startsWith('baidu'));
  assert.equal(recommendFreeModel(without).id, 'some/other:free');
});

test('cheap paid models come first by blended price, with a cost estimate', () => {
  const cheap = cheapPaidModels(MODELS, 3);
  assert.deepEqual(cheap.map((c) => c.model.id), [
    'deepseek/deepseek-v4-flash',
    'qwen/qwen3.7-flash',
    'big/flagship',
  ]);
  const perM = pricePerMillion(MODELS[3]);
  assert.ok(Math.abs(perM.prompt - 0.1) < 1e-9);
  assert.ok(Math.abs(perM.completion - 0.3) < 1e-9);
  assert.ok(estimateCostPer1000(MODELS[3]) > 0);
  assert.equal(estimateCostPer1000({ pricing: { prompt: '0', completion: '0' } }), 0);
});

test('configuredProviders returns only the providers the user set up', () => {
  const none = configuredProviders({});
  assert.equal(none.length, 0);
  const both = configuredProviders({ openrouterKey: 'k', openrouterModel: 'm', ollamaUrl: 'http://x' });
  assert.deepEqual(both.map((p) => p.id), ['openrouter', 'ollama']);
});

// ---------------------------------------------------------------- history

test('trimHistory keeps the system prompt and the last N turns', () => {
  const messages = [{ role: 'system', content: 'S' }];
  for (let i = 0; i < 30; i += 1) messages.push({ role: 'user', content: `u${i}` });
  const trimmed = trimHistory(messages, 5);
  assert.equal(trimmed[0].role, 'system');
  assert.equal(trimmed.length, 6);
  assert.equal(trimmed[trimmed.length - 1].content, 'u29');
  assert.equal(trimHistory(messages, HISTORY_LIMIT).length, HISTORY_LIMIT + 1);
});

// ---------------------------------------------------------------- prompts

test('system prompt mentions the level and the situation', () => {
  const prompt = buildSystemPrompt({ level: 2, scenario: 'food' });
  assert.match(prompt, /HSK 2/);
  assert.match(prompt, /restaurant/);
  assert.match(prompt, /SIMPLIFIED/);
  assert.match(prompt, /"zh"/);
});

test('buildMessages puts the system prompt first and trims the history', () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ role: 'user', content: `m${i}` }));
  const built = buildMessages({ level: 1, scenario: 'introductions', history });
  assert.equal(built[0].role, 'system');
  assert.equal(built.length, HISTORY_LIMIT + 1);
});

test('parseReply accepts JSON, fenced JSON and bare prose', () => {
  const json = parseReply('{"zh":"你好","pinyin":"nǐ hǎo","en":"Hello","correction":"watch the tone"}');
  assert.deepEqual(json, { zh: '你好', pinyin: 'nǐ hǎo', en: 'Hello', correction: 'watch the tone' });

  const fenced = parseReply('Sure!\n```json\n{"zh":"谢谢","pinyin":"xiè xie","en":"Thanks","correction":""}\n```');
  assert.equal(fenced.zh, '谢谢');
  assert.equal(fenced.en, 'Thanks');

  const prose = parseReply('你好！');
  assert.equal(prose.zh, '你好！');
  assert.equal(prose.en, '');
  assert.equal(parseReply('').zh, '');
});

test('scenarios and openers cover HSK 1-3', () => {
  assert.deepEqual(HSK_LEVELS, [1, 2, 3]);
  assert.equal(SCENARIOS.length, 4);
  for (const sc of SCENARIOS) {
    const opener = openerFor(sc.id);
    assert.ok(opener.zh && opener.pinyin && opener.en);
    assert.ok(!/[\u3400-\u9fff]/.test(opener.en), 'opener English must not contain hanzi');
  }
});

// ---------------------------------------------------------------- i18n shards

test('conversation locale shards exist in en and es with the same keys', () => {
  const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
  const flatten = (obj, parents = []) => Object.entries(obj).flatMap(([k, v]) =>
    (v && typeof v === 'object' && !Array.isArray(v)) ? flatten(v, [...parents, k]) : [[...parents, k].join('.')]);
  const en = flatten(read('../src/locales/en.d/conversation.json')).sort();
  const es = flatten(read('../src/locales/es.d/conversation.json')).sort();
  assert.deepEqual(es, en);
  for (const key of en) assert.ok(key.startsWith('conversation.'), `key outside conversation.*: ${key}`);
});
