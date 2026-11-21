/**
 * review3-critical.test.mjs — behavior tests for the REVIEW-3 fixes that used
 * to be protected only by regexes over the source (REVIEW-3 I10): the lesson /
 * Tones finish path (I4) and the conversation model switch (I3).
 *
 * The screens are driven through their real `render()` on the hand-rolled DOM of
 * tests/helpers/fake-dom.mjs. A revert of the fix makes one of these fail.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { registerLocale } from '../src/i18n.js';
import storage from '../src/storage.js';
import { installFakeDom, withClass, byText } from './helpers/fake-dom.mjs';

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const LESSON = readJson('../public/data/lessons/hsk1/lesson-01.json');
const TONES = readJson('../public/data/lessons/tones.json');

registerLocale('en', {
  ...readJson('../src/locales/en.json'),
  ...readJson('../src/locales/en.d/learn.json'),
  ...readJson('../src/locales/en.d/tones.json'),
  ...readJson('../src/locales/en.d/conversation.json'),
  settings: { pinyin: { on: 'Pinyin on', off: 'Pinyin off', quickState: 'Pinyin: {state}' } },
});

const EN = readJson('../src/locales/en.d/learn.json').learn;
const CONV = readJson('../src/locales/en.d/conversation.json').conversation;
const COMMON = readJson('../src/locales/en.json').common;

/** Lets every pending microtask/timer of the screens settle. */
async function settle(dom, n = 5) {
  for (let i = 0; i < n; i += 1) await dom.tick();
}

// The conversation tests share one storage store: clear the keys they write so
// a later test never starts with a key or a history it did not set (M6).
afterEach(async () => {
  await storage.remove('meta', 'openrouterKey');
  await storage.remove('settings', 'openrouterModel');
  await storage.remove('meta', 'conversationHistory');
  await storage.remove('gamification', 'conversationRewardDay');
});

const FREE_MODELS = [
  { id: 'a/free:free', pricing: { prompt: '0', completion: '0' } },
  { id: 'b/free:free', pricing: { prompt: '0', completion: '0' } },
];

/** One OpenRouter SSE chunk carrying `text` as the model's content delta. */
const sseChunk = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

/**
 * Renders #/extras/conversation with a fake OpenRouter: the model list plus a
 * chat/completions response built by `onChat(options)`. Returns the container,
 * the screen's cleanup (the abort path) and every request body sent.
 */
async function mountConversation(dom, onChat) {
  await storage.set('meta', 'openrouterKey', 'sk-test');
  await storage.set('settings', 'openrouterModel', 'a/free:free');
  const bodies = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes('/models')) return { ok: true, status: 200, json: async () => ({ data: FREE_MODELS }) };
    if (u.includes('/chat/completions')) {
      bodies.push(JSON.parse(options.body));
      return onChat(options);
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { render } = await import('../src/extras/conversation.js');
  const container = new dom.FakeNode('div');
  const cleanup = render(container, { navigate() {} });
  await settle(dom);
  return { container, cleanup, bodies };
}

async function configureData() {
  const { configure } = await import('../src/data-url.js');
  configure({
    base: new URL('../public/data/', import.meta.url).href,
    fetch: async (url) => ({
      ok: true,
      status: 200,
      json: async () => JSON.parse(readFileSync(fileURLToPath(url), 'utf8')),
    }),
  });
}

/** Clicks the Continue button the feedback box offers after an answer. */
async function clickContinue(container, tick) {
  const box = withClass(container, 'feedback-box')[0];
  withClass(box, 'btn', 'primary')[0].click();
  await tick();
}

/** Plays hsk1-01 through every exercise up to the result screen. */
async function playLessonToResult(container, navigate, tick) {
  await configureData();
  const { render } = await import('../src/learn/lessons.js');
  await render(container, {
    route: { name: 'learn', segments: ['lessons', 'hsk1-01'] },
    navigate: (to) => navigate.push(to),
  });
  withClass(container, 'btn', 'primary')[0].click(); // intro -> vocabulary
  withClass(container, 'btn', 'primary')[0].click(); // vocabulary -> exercises
  for (const exercise of LESSON.exercises) {
    if (exercise.type === 'choose' || exercise.type === 'listen') {
      withClass(container, 'btn', 'option')[0].click();
    } else if (exercise.type === 'match') {
      for (const pair of exercise.pairs) {
        container.descendants().find((n) => n.dataset.hanzi === pair.hanzi).click();
        container.descendants().find((n) => n.dataset.english === pair.english).click();
      }
      byText(container, EN.lessons.check).click();
    } else if (exercise.type === 'order') {
      byText(container, EN.lessons.check).click();
    }
    await tick();
    await clickContinue(container, tick);
  }
}

/** Plays the Tones lesson up to its result screen. */
async function playTonesToResult(container, navigate, tick) {
  await configureData();
  const { render } = await import('../src/learn/tones.js');
  await render(container, { navigate: (to) => navigate.push(to) });
  withClass(container, 'btn', 'primary')[0].click(); // intro -> pinyin
  withClass(container, 'btn', 'primary')[0].click(); // pinyin -> vocabulary
  withClass(container, 'btn', 'primary')[0].click(); // vocabulary -> exercises
  for (let i = 0; i < TONES.exercises.length; i += 1) {
    withClass(container, 'btn', 'option')[0].click();
    await tick();
    await clickContinue(container, tick);
  }
}

// ---------------------------------------------------------------- I4
test('I4: a second click on Finish does not announce the lesson twice', async () => {
  const dom = installFakeDom();
  try {
    const navigate = [];
    const container = new dom.FakeNode('div');
    await playLessonToResult(container, navigate, dom.tick);

    byText(container, EN.lessons.finish).click();
    await dom.tick();
    await dom.tick();
    // The result screen is still mounted (navigate() only records the target):
    // a second click must not fire a second chino:lesson_done.
    const again = byText(container, EN.lessons.finish);
    assert.ok(again, 'the result screen stays mounted after Finish');
    again.click();
    await dom.tick();
    await dom.tick();

    assert.equal(dom.events.filter((e) => e.type === 'chino:lesson_done').length, 1);
  } finally {
    dom.restore();
  }
});

test('I4: a failed save at the lesson result still navigates and announces once', async () => {
  const dom = installFakeDom();
  const realSet = storage.set;
  try {
    const navigate = [];
    const container = new dom.FakeNode('div');
    await playLessonToResult(container, navigate, dom.tick);
    assert.ok(byText(container, EN.lessons.finish), 'the result offers Finish');

    storage.set = async () => { throw new Error('quota exceeded'); };
    byText(container, EN.lessons.finish).click();
    await dom.tick();
    await dom.tick();

    assert.ok(navigate.includes('learn/lessons'), `it navigated away: ${JSON.stringify(navigate)}`);
    assert.equal(dom.events.filter((e) => e.type === 'chino:lesson_done').length, 1);
  } finally {
    storage.set = realSet;
    dom.restore();
  }
});

test('I4: a failed save at the Tones result still navigates and announces once', async () => {
  const dom = installFakeDom();
  const realSet = storage.set;
  try {
    const navigate = [];
    const container = new dom.FakeNode('div');
    await playTonesToResult(container, navigate, dom.tick);

    storage.set = async () => { throw new Error('quota exceeded'); };
    byText(container, EN.lessons.finish).click();
    await dom.tick();
    await dom.tick();

    assert.ok(navigate.includes('learn/lessons'), `it navigated to the lesson list: ${JSON.stringify(navigate)}`);
    assert.equal(dom.events.filter((e) => e.type === 'chino:lesson_done').length, 1);
  } finally {
    storage.set = realSet;
    dom.restore();
  }
});

test('I4: a failed write to the review deck still leaves the lesson result', async () => {
  const dom = installFakeDom();
  const realSet = storage.set;
  try {
    const navigate = [];
    const container = new dom.FakeNode('div');
    await playLessonToResult(container, navigate, dom.tick);
    const review = byText(container, EN.lessons.reviewMissed);
    assert.ok(review, 'the result offers Review what I missed');

    // The deck write fails (quota, closed IndexedDB); the screen must still move on.
    storage.set = async () => { throw new Error('quota exceeded'); };
    review.click();
    await dom.tick();
    await dom.tick();

    assert.ok(navigate.includes('review'), `it navigated away: ${JSON.stringify(navigate)}`);
    assert.equal(dom.events.filter((e) => e.type === 'chino:lesson_done').length, 1);
  } finally {
    storage.set = realSet;
    dom.restore();
  }
});

// ---------------------------------------------------------------- I3
test('I3: switching the model after a 429 changes the model actually sent', async () => {
  const dom = installFakeDom();
  const realFetch = globalThis.fetch;
  const { resetProviders } = await import('../src/extras/conversation.js');
  try {
    await storage.set('meta', 'openrouterKey', 'sk-test');
    await storage.set('settings', 'openrouterModel', 'a/free:free');
    const models = [
      { id: 'a/free:free', pricing: { prompt: '0', completion: '0' } },
      { id: 'b/free:free', pricing: { prompt: '0', completion: '0' } },
    ];
    const bodies = [];
    let chat = 0;
    globalThis.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.includes('/models')) return { ok: true, status: 200, json: async () => ({ data: models }) };
      if (u.includes('/chat/completions')) {
        chat += 1;
        bodies.push(JSON.parse(options.body));
        if (chat === 1) return { ok: false, status: 429, json: async () => ({}) };
        const stream = new ReadableStream({
          start(controller) {
            const payload = JSON.stringify({ choices: [{ delta: { content: '{"zh":"你好","pinyin":"nǐ hǎo","en":"hi"}' } }] });
            controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
            controller.close();
          },
        });
        return { ok: true, status: 200, body: stream };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const { render } = await import('../src/extras/conversation.js');
    const container = new dom.FakeNode('div');
    render(container, { navigate() {} });
    await dom.tick();
    await dom.tick();
    await dom.tick();

    const form = container.querySelector('.conv-compose');
    assert.ok(form, 'the compose form is rendered with only the API key');
    form.querySelector('textarea').value = '你好';
    form.dispatch('submit');
    await dom.tick();
    await dom.tick();

    const switchBtn = container.querySelector('.conv-switch');
    assert.ok(switchBtn, 'a rate limit offers the model switch');
    switchBtn.click();
    await dom.tick();
    await dom.tick();

    const form2 = container.querySelector('.conv-compose');
    form2.querySelector('textarea').value = '你好';
    form2.dispatch('submit');
    await dom.tick();
    await dom.tick();

    assert.equal(bodies.length, 2, 'two requests were sent');
    assert.equal(bodies[0].model, 'a/free:free');
    assert.equal(bodies[1].model, 'b/free:free', 'the switch reached the request body');
    assert.equal(await storage.get('settings', 'openrouterModel'), 'b/free:free');
  } finally {
    resetProviders();
    globalThis.fetch = realFetch;
    dom.restore();
  }
});

test('I3: the model select changes the model actually sent', async () => {
  const dom = installFakeDom();
  const realFetch = globalThis.fetch;
  try {
    const { container, bodies } = await mountConversation(dom, () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(sseChunk('{"zh":"你好","pinyin":"nǐ hǎo","en":"hi"}')));
          c.close();
        },
      }),
    }));
    const select = container
      .querySelectorAll('select')
      .find((node) => node.getAttribute('aria-label') === CONV.model);
    assert.ok(select, 'the model select is rendered');
    select.value = 'b/free:free';
    select.dispatch('change');
    await settle(dom);
    assert.equal(await storage.get('settings', 'openrouterModel'), 'b/free:free');

    // The provider captures `model` when it is built: without reloadProviders()
    // the change never reaches the request body (the mutation this guards).
    const form = container.querySelector('.conv-compose');
    form.querySelector('textarea').value = '你好';
    form.dispatch('submit');
    await settle(dom);
    assert.equal(bodies.length, 1, 'one request was sent');
    assert.equal(bodies[0].model, 'b/free:free', 'the select change reached the request body');
  } finally {
    globalThis.fetch = realFetch;
    dom.restore();
  }
});

test('I3: a streaming reply never shows raw JSON in the bubble', async () => {
  const dom = installFakeDom();
  const realFetch = globalThis.fetch;
  try {
    let ctrl = null;
    const { container } = await mountConversation(dom, () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({ start(c) { ctrl = c; } }),
    }));
    const form = container.querySelector('.conv-compose');
    form.querySelector('textarea').value = '你好';
    form.dispatch('submit');
    await settle(dom);

    ctrl.enqueue(new TextEncoder().encode(sseChunk('{"zh":"你')));
    await settle(dom);
    const bubbles = container.querySelectorAll('.conv-bubble');
    assert.ok(bubbles.length > 0, 'a live bubble is shown');
    for (const bubble of bubbles) {
      assert.ok(!bubble.textContent.includes('{'), `raw JSON leaked into the bubble: ${bubble.textContent}`);
    }

    ctrl.enqueue(new TextEncoder().encode(sseChunk('好"}')));
    ctrl.close();
    await settle(dom, 8);
    const history = await storage.get('meta', 'conversationHistory');
    assert.ok(history.some((m) => m.role === 'assistant' && m.zh === '你好'), `reply stored: ${JSON.stringify(history)}`);
  } finally {
    globalThis.fetch = realFetch;
    dom.restore();
  }
});

test('I3: aborting mid-stream does not persist a partial reply', async () => {
  const dom = installFakeDom();
  const realFetch = globalThis.fetch;
  try {
    let ctrl = null;
    await storage.set('meta', 'conversationHistory', [{ role: 'assistant', zh: '你好！你叫什么名字？' }]);
    const { container, cleanup } = await mountConversation(dom, (options) => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(c) {
          ctrl = c;
          options.signal?.addEventListener('abort', () => { try { c.close(); } catch { /* already closed */ } });
        },
      }),
    }));
    const form = container.querySelector('.conv-compose');
    form.querySelector('textarea').value = '你好';
    form.dispatch('submit');
    await settle(dom);
    ctrl.enqueue(new TextEncoder().encode(sseChunk('{"zh":"你')));
    await settle(dom);

    cleanup(); // leaving the screen aborts the stream
    await settle(dom, 8);

    const history = await storage.get('meta', 'conversationHistory');
    assert.ok(Array.isArray(history));
    // The user message and the partial reply are both discarded: nothing is
    // persisted on abort (not even an empty or partial `zh`).
    assert.equal(history.length, 1, `nothing new persisted: ${JSON.stringify(history)}`);
    assert.ok(
      !history.some((m) => m.role === 'assistant' && String(m.zh || '').includes('{')),
      `a partial reply was persisted: ${JSON.stringify(history)}`,
    );
  } finally {
    globalThis.fetch = realFetch;
    dom.restore();
  }
});

test('I3: a failed request does not leave the user message orphaned', async () => {
  const dom = installFakeDom();
  const realFetch = globalThis.fetch;
  try {
    const { container } = await mountConversation(dom, () => ({ ok: false, status: 500, json: async () => ({}) }));
    const form = container.querySelector('.conv-compose');
    form.querySelector('textarea').value = '你好';
    form.dispatch('submit');
    await settle(dom, 8);

    const history = await storage.get('meta', 'conversationHistory');
    assert.ok(Array.isArray(history) && history.length > 0);
    assert.notEqual(history[history.length - 1].role, 'user', `orphan user message: ${JSON.stringify(history)}`);
  } finally {
    globalThis.fetch = realFetch;
    dom.restore();
  }
});

test('I3/C1: with only the API key the model list unlocks the chat', async () => {
  const dom = installFakeDom();
  const realFetch = globalThis.fetch;
  try {
    await storage.set('meta', 'openrouterKey', 'sk-test');
    await storage.remove('settings', 'openrouterModel');
    const bodies = [];
    globalThis.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.includes('/models')) return { ok: true, status: 200, json: async () => ({ data: FREE_MODELS }) };
      if (u.includes('/chat/completions')) {
        bodies.push(JSON.parse(options.body));
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode(sseChunk('{"zh":"你好"}')));
              c.close();
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const { render } = await import('../src/extras/conversation.js');
    const container = new dom.FakeNode('div');
    render(container, { navigate() {} });
    await settle(dom, 8);

    // loadModelsOnce must run even with no provider yet, and adopt a free model:
    // otherwise pasting only the API key never unlocks the chat.
    const form = container.querySelector('.conv-compose');
    assert.ok(form, 'the chat opens with just the API key');
    assert.equal(await storage.get('settings', 'openrouterModel'), 'a/free:free');
    form.querySelector('textarea').value = '你好';
    form.dispatch('submit');
    await settle(dom);
    assert.equal(bodies[0].model, 'a/free:free');
  } finally {
    globalThis.fetch = realFetch;
    dom.restore();
  }
});

test('I3: Frases shows the offline message instead of rejecting', async () => {
  const dom = installFakeDom();
  const { configure } = await import('../src/data-url.js');
  const realFetch = globalThis.fetch;
  try {
    configure({ base: 'http://localhost/data/', fetch: async () => { throw new TypeError('Failed to fetch'); } });
    const { render } = await import('../src/learn/sentences.js');
    const container = new dom.FakeNode('div');
    await render(container, { route: { name: 'learn', segments: ['sentences'] } });
    assert.ok(container.textContent.includes(COMMON.offline), `got: ${container.textContent}`);
  } finally {
    configure({ base: null, fetch: realFetch });
    dom.restore();
  }
});

test('I3: the daily conversation reward fires once, even after a new conversation', async () => {
  const dom = installFakeDom();
  const realFetch = globalThis.fetch;
  try {
    const { container } = await mountConversation(dom, () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(sseChunk('{"zh":"你好","pinyin":"nǐ hǎo","en":"hi"}')));
          c.close();
        },
      }),
    }));
    const sendFive = async () => {
      for (let i = 0; i < 5; i += 1) {
        const form = container.querySelector('.conv-compose');
        form.querySelector('textarea').value = `你好${i}`;
        form.dispatch('submit');
        await settle(dom, 8);
      }
    };
    const rewards = () => dom.events.filter((e) => e.type === 'chino:lesson_done').length;

    await sendFive();
    assert.equal(rewards(), 1, 'the fifth message awards the day once');

    // "New conversation" resets the message count; five more the same day must
    // not farm a second reward. Click the real button: byText would return the
    // .conv-row wrapper (same text, no handler) and the click would do nothing.
    container.querySelectorAll('button').find((b) => b.textContent === CONV.newChat).click();
    await settle(dom);
    assert.equal((await storage.get('meta', 'conversationHistory')).length, 1, 'new conversation resets the history');
    await sendFive();
    assert.equal(rewards(), 1, 'a second round the same day does not reward again');
  } finally {
    globalThis.fetch = realFetch;
    dom.restore();
  }
});
