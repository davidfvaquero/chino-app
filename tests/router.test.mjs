import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, href, parseRoute } from '../src/router.js';

// Several tests below assign globalThis.location; restore it so a later test
// ever inherits another's hash.
const realLocation = globalThis.location;
afterEach(() => {
  if (realLocation === undefined) delete globalThis.location;
  else globalThis.location = realLocation;
});

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

test('I2: the route slot is programmatically focusable (tabindex=-1)', async () => {
  // Every screen calls container.focus() after painting; without tabindex the
  // focus silently lands on <body> (WCAG 2.4.3 — REVIEW-3 I2).
  const makeNode = () => {
    const node = {
      children: [],
      className: '',
      attributes: {},
      append(child) { node.children.push(child); },
      remove() {},
      setAttribute(key, value) { node.attributes[key] = String(value); },
      getAttribute(key) { return key in node.attributes ? node.attributes[key] : null; },
    };
    Object.defineProperty(node, 'tabIndex', {
      get: () => Number(node.attributes.tabindex ?? -1),
      set: (value) => { node.attributes.tabindex = String(value); },
    });
    return node;
  };
  const container = makeNode();
  container.replaceChildren = () => { container.children = []; };
  const realDocument = globalThis.document;
  globalThis.document = { createElement: () => makeNode() };
  try {
    const screens = { home: { render: () => {} } };
    const router = createRouter({ container, screens, fallback: 'home' });
    globalThis.location = { hash: '#/home' };
    await router.render();
    const slot = container.children[0];
    assert.equal(slot.getAttribute('tabindex'), '-1', 'the slot must accept focus');
  } finally {
    globalThis.document = realDocument;
  }
});

test('M3: the router focuses the slot when the screen does not', async () => {
  // strokes-sheet, themes, hardwords… never call container.focus(), so without
  // the router fallback the focus lands on <body>.
  const makeNode = () => ({
    children: [],
    className: '',
    tabIndex: 0,
    append(child) { this.children.push(child); },
    remove() {},
    focus() { this.focused = true; },
    contains(node) { return node === this || this.children.includes(node); },
  });
  const doc = { createElement: () => makeNode(), activeElement: null };
  const container = makeNode();
  container.ownerDocument = doc;
  container.replaceChildren = () => { container.children = []; };

  const screens = { home: { render: () => {} } }; // deliberately never focuses
  const router = createRouter({ container, screens, fallback: 'home' });
  globalThis.location = { hash: '#/home' };
  await router.render();
  assert.equal(container.children[0].focused, true, 'the slot took the focus');
});
