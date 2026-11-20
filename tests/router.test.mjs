import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, href, parseRoute } from '../src/router.js';

test('parseRoute handles an empty hash with the fallback route', () => {
  assert.deepEqual(parseRoute('', 'dictionary'), {
    name: 'dictionary',
    segments: [],
    params: {},
    path: '',
  });
});

test('parseRoute reads the screen name', () => {
  assert.equal(parseRoute('#/review').name, 'review');
  assert.equal(parseRoute('#review').name, 'review');
});

test('parseRoute keeps sub-segments and query params', () => {
  const route = parseRoute('#/learn/hsk1/lesson-1?step=2&lang=zh');
  assert.equal(route.name, 'learn');
  assert.deepEqual(route.segments, ['hsk1', 'lesson-1']);
  assert.deepEqual(route.params, { step: '2', lang: 'zh' });
  assert.equal(route.path, 'learn/hsk1/lesson-1');
});

test('parseRoute decodes and ignores trailing slashes', () => {
  const route = parseRoute('#/read/%E4%B8%AD%E6%96%87/');
  assert.deepEqual(route.segments, ['中文']);
});

test('href() builds a hash path', () => {
  assert.equal(href('learn'), '#/learn');
  assert.equal(href('/learn/hsk1'), '#/learn/hsk1');
});

test('router renders the matching screen and cleanups the previous one', async () => {
  const container = { replaceChildren: () => {}, children: [] };
  const rendered = [];
  let cleaned = 0;
  const screens = {
    learn: {
      render: () => {
        rendered.push('learn');
        return () => {
          cleaned += 1;
        };
      },
    },
    read: { render: () => void rendered.push('read') },
  };

  const router = createRouter({ container, screens, fallback: 'learn' });
  globalThis.location = { hash: '#/read' };
  await router.render();
  assert.deepEqual(rendered, ['read']);
  globalThis.location = { hash: '#/learn' };
  await router.render();
  assert.deepEqual(rendered, ['read', 'learn']);
  globalThis.location = { hash: '#/learn' };
  await router.render();
  assert.equal(cleaned, 1); // previous learn screen was cleaned up

  globalThis.location = { hash: '#/nope' };
  const route = await router.render();
  assert.equal(route.name, 'learn'); // unknown route falls back
  assert.equal(route.unknown, 'nope');
  assert.deepEqual(rendered, ['read', 'learn', 'learn', 'learn']);
});

test('I1: a slow screen cannot paint over the next one', async () => {
  // Minimal DOM: each render gets its own slot node under the container.
  const makeNode = () => {
    const node = {
      children: [],
      className: '',
      append(child) { this.children.push(child); },
      remove() { node.removed = true; },
    };
    return node;
  };
  const container = makeNode();
  container.replaceChildren = () => { container.children = []; };
  const realDocument = globalThis.document;
  globalThis.document = { createElement: () => makeNode() };
  try {
    const screens = {
      slow: {
        render: async (slot) => {
          await new Promise((r) => setTimeout(r, 50));
          slot.append('A');
        },
      },
      fast: { render: (slot) => { slot.append('B'); } },
    };
    const router = createRouter({ container, screens, fallback: 'fast' });
    globalThis.location = { hash: '#/slow' };
    const slow = router.render();
    globalThis.location = { hash: '#/fast' };
    await router.render();
    await slow;
    const painted = container.children.flatMap((slot) => slot.children);
    assert.deepEqual(painted, ['B'], 'only the live screen is on the container');
  } finally {
    globalThis.document = realDocument;
  }
});
