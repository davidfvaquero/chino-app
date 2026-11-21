/**
 * review3-critical.test.mjs — behavior tests for the REVIEW-3 fixes that used
 * to be protected only by regexes over the source (REVIEW-3 I10): the lesson /
 * Tones finish path (I4) and the conversation model switch (I3).
 *
 * The screens are driven through their real `render()` on the hand-rolled DOM of
 * tests/helpers/fake-dom.mjs. A revert of the fix makes one of these fail.
 */
import { test } from 'node:test';
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

    assert.ok(navigate.includes('learn/tones'), `it navigated away: ${JSON.stringify(navigate)}`);
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

test('I3: the model select saves the chosen model', async () => {
  const dom = installFakeDom();
  const realFetch = globalThis.fetch;
  try {
    await storage.set('meta', 'openrouterKey', 'sk-test');
    await storage.set('settings', 'openrouterModel', 'a/free:free');
    globalThis.fetch = async (url) => {
      if (String(url).includes('/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [
            { id: 'a/free:free', pricing: { prompt: '0', completion: '0' } },
            { id: 'b/free:free', pricing: { prompt: '0', completion: '0' } },
          ] }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const { render } = await import('../src/extras/conversation.js');
    const container = new dom.FakeNode('div');
    render(container, { navigate() {} });
    await dom.tick();
    await dom.tick();
    await dom.tick();

    const select = container
      .querySelectorAll('select')
      .find((node) => node.getAttribute('aria-label') === CONV.model);
    assert.ok(select, 'the model select is rendered');
    select.value = 'b/free:free';
    select.dispatch('change');
    await dom.tick();
    await dom.tick();
    assert.equal(await storage.get('settings', 'openrouterModel'), 'b/free:free');
  } finally {
    globalThis.fetch = realFetch;
    dom.restore();
  }
});

// keep the imported constant referenced (used by the report's wording)
void CONV;
