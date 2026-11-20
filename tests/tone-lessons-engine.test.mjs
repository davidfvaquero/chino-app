// Characterization tests for the exercise engine shared by the lessons screen
// and the Tones lesson (docs/REVIEW.md, finding #20: `src/learn/tones.js`
// duplicated `exerciseView` / `choiceBody` / `finish` / `resultStep` of
// `src/learn/lessons.js`).
//
// They pin the OBSERVABLE behaviour of both screens (result screen, feedback
// with the correct answer, role=status live region, "review what I missed") so
// the shared-engine extraction can be verified as a pure refactor: every one of
// these passes on the pre-refactor code and must keep passing after it.
//
// Run with `node --test tests/tone-lessons-engine.test.mjs` or `npm test`.
// The flow is driven through the real `render()` on a tiny hand-rolled DOM (no
// browser, no dependency), the same trick as tests/games-timed.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { registerLocale } from '../src/i18n.js';

/* ------------------------------------------------------------------ data -- */

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const LESSON = readJson('../public/data/lessons/hsk1/lesson-01.json');
const TONES = readJson('../public/data/lessons/tones.json');

const EN = {
  learn: readJson('../src/locales/en.d/learn.json').learn,
  tones: readJson('../src/locales/en.d/tones.json'),
  settings: { pinyin: { on: 'Pinyin on', off: 'Pinyin off', quickState: 'Pinyin: {state}' } },
};
registerLocale('en', EN);

/* ---------------------------------------------------------------- fake DOM -- */

/** Just enough DOM for the two screens: elements, classes, clicks, events. */
function installFakeDom(events) {
  class FakeNode {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.attrs = {};
      this.className = '';
      this.id = '';
      this._text = '';
      this.style = { setProperty() {}, removeProperty() {} };
      this._listeners = new Map();
      const classes = () => String(this.className).split(' ').filter(Boolean);
      this.classList = {
        add: (...names) => {
          this.className = [...new Set([...classes(), ...names])].join(' ');
        },
        remove: (...names) => {
          this.className = classes().filter((c) => !names.includes(c)).join(' ');
        },
        toggle: (name, force) => (force ? this.classList.add(name) : this.classList.remove(name)),
        contains: (name) => classes().includes(name),
      };
    }
    get textContent() {
      return this._text + this.children.map((child) => child.textContent ?? '').join('');
    }
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    }
    set innerHTML(_value) {
      this._text = '';
      this.children = [];
    }
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name === 'id') this.id = String(value);
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[key] = String(value);
      }
    }
    getAttribute(name) {
      return this.attrs[name];
    }
    append(...nodes) {
      for (const node of nodes) this.children.push(node);
    }
    replaceChildren(...nodes) {
      this.children = [];
      this._text = '';
      this.append(...nodes);
    }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    }
    removeEventListener() {}
    click() {
      for (const fn of this._listeners.get('click') ?? []) fn({ currentTarget: this });
    }
    focus() {}
    querySelectorAll() {
      return [];
    }
    get isConnected() {
      return true;
    }
  }

  const head = new FakeNode('head');
  const html = new FakeNode('html');
  html.dataset = {};
  globalThis.Node = FakeNode;
  globalThis.document = {
    head,
    documentElement: html,
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => {
      const node = new FakeNode('#text');
      node.textContent = text;
      return node;
    },
    getElementById: (id) => head.children.find((child) => child.id === id) ?? null,
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: (event) => {
      events.push(event);
      return true;
    },
  };
  return {
    FakeNode,
    restore: () => {
      delete globalThis.Node;
      delete globalThis.document;
      delete globalThis.window;
    },
  };
}

/* ------------------------------------------------------------- tree walks -- */

const descendants = (root) => {
  const out = [];
  const walk = (node) => {
    for (const child of node.children) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
};

const withClass = (root, ...names) =>
  descendants(root).filter((node) => names.every((name) => node.classList.contains(name)));

const byText = (root, text) => descendants(root).find((node) => node.textContent.trim() === text);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Clicks the first primary button of the current step (intro / vocabulary / pinyin "Next"). */
const clickNext = (root) => withClass(root, 'btn', 'primary')[0].click();

/** Clicks the "Continue" button the feedback box offers after an answer. */
const clickContinue = async (root) => {
  const box = withClass(root, 'feedback-box')[0];
  withClass(box, 'btn', 'primary')[0].click();
  await tick();
};

/** Drives the lessons screen (hsk1-01) through every exercise to the result. */
async function playLessonsToResult(container, navigate) {
  const events = [];
  await import('../src/data-url.js').then(({ configure }) =>
    configure({
      base: new URL('../public/data/', import.meta.url).href,
      fetch: async (url) => ({
        ok: true,
        status: 200,
        json: async () => JSON.parse(readFileSync(fileURLToPath(url), 'utf8')),
      }),
    }),
  );
  const { render } = await import('../src/learn/lessons.js');
  await render(container, { route: { name: 'learn', segments: ['lessons', 'hsk1-01'] }, navigate: (to) => navigate.push(to) });
  assert.ok(withClass(container, 'lesson-intro').length, 'lesson intro did not render');

  clickNext(container); // intro -> vocabulary
  clickNext(container); // vocabulary -> exercises

  for (const exercise of LESSON.exercises) {
    if (exercise.type === 'choose' || exercise.type === 'listen') {
      withClass(container, 'btn', 'option')[0].click();
    } else if (exercise.type === 'match') {
      for (const pair of exercise.pairs) {
        const left = descendants(container).find((n) => n.dataset.hanzi === pair.hanzi);
        left.click();
        const right = descendants(container).find((n) => n.dataset.english === pair.english);
        right.click();
      }
      byText(container, EN.learn.lessons.check).click();
    } else if (exercise.type === 'order') {
      byText(container, EN.learn.lessons.check).click();
    }
    await tick();
    await clickContinue(container);
  }
  return events;
}

/** Drives the Tones lesson through every exercise to the result. */
async function playTonesToResult(container, navigate) {
  await import('../src/data-url.js').then(({ configure }) =>
    configure({
      base: new URL('../public/data/', import.meta.url).href,
      fetch: async (url) => ({
        ok: true,
        status: 200,
        json: async () => JSON.parse(readFileSync(fileURLToPath(url), 'utf8')),
      }),
    }),
  );
  const { render } = await import('../src/learn/tones.js');
  await render(container, { navigate: (to) => navigate.push(to) });
  assert.ok(withClass(container, 'lesson-intro').length, 'tones intro did not render');

  clickNext(container); // intro -> pinyin
  clickNext(container); // pinyin -> vocabulary
  clickNext(container); // vocabulary -> exercises

  for (let i = 0; i < TONES.exercises.length; i += 1) {
    withClass(container, 'btn', 'option')[0].click();
    await tick();
    await clickContinue(container);
  }
}

/* -------------------------------------------------------- lessons screen -- */

test('lessons: a wrong answer shows the correct answer and marks the options', async () => {
  const events = [];
  const dom = installFakeDom(events);
  try {
    const navigate = [];
    const container = new dom.FakeNode('div');
    await import('../src/data-url.js').then(({ configure }) =>
      configure({
        base: new URL('../public/data/', import.meta.url).href,
        fetch: async (url) => ({
          ok: true,
          status: 200,
          json: async () => JSON.parse(readFileSync(fileURLToPath(url), 'utf8')),
        }),
      }),
    );
    const { render } = await import('../src/learn/lessons.js');
    await render(container, { route: { name: 'learn', segments: ['lessons', 'hsk1-01'] }, navigate: (to) => navigate.push(to) });
    clickNext(container); // intro -> vocabulary
    clickNext(container); // vocabulary -> exercises

    // Exercise 0: choose "What does 谢谢 mean?" (answer: thank you).
    const options = withClass(container, 'btn', 'option');
    const wrong = options.find((b) => b.textContent.trim() === 'goodbye');
    wrong.click();

    const feedback = withClass(container, 'feedback', 'bad')[0];
    assert.ok(feedback, 'a wrong answer must render feedback.bad');
    assert.equal(feedback.textContent, 'Incorrect. The answer is thank you.');

    assert.ok(withClass(container, 'is-wrong').includes(wrong), 'the wrong option is marked is-wrong');
    const missed = options.find((b) => b.dataset.value === 'thank you');
    assert.ok(missed.classList.contains('is-missed'), 'the right option is marked is-missed');
  } finally {
    dom.restore();
  }
});

test('lessons: the feedback box is a role=status live region (P1-3)', async () => {
  const events = [];
  const dom = installFakeDom(events);
  try {
    const container = new dom.FakeNode('div');
    await import('../src/data-url.js').then(({ configure }) =>
      configure({
        base: new URL('../public/data/', import.meta.url).href,
        fetch: async (url) => ({
          ok: true,
          status: 200,
          json: async () => JSON.parse(readFileSync(fileURLToPath(url), 'utf8')),
        }),
      }),
    );
    const { render } = await import('../src/learn/lessons.js');
    await render(container, { route: { name: 'learn', segments: ['lessons', 'hsk1-01'] }, navigate() {} });
    clickNext(container);
    clickNext(container);
    withClass(container, 'btn', 'option')[0].click();

    const box = withClass(container, 'feedback-box')[0];
    assert.equal(box.getAttribute('role'), 'status');
    assert.equal(box.getAttribute('aria-live'), 'polite');
  } finally {
    dom.restore();
  }
});

test('lessons: the result screen shows the score, a live region and "review what I missed"', async () => {
  const events = [];
  const dom = installFakeDom(events);
  try {
    const navigate = [];
    const container = new dom.FakeNode('div');
    await playLessonsToResult(container, navigate);

    assert.ok(withClass(container, 'lesson-result').length, 'result step did not render');
    const status = withClass(container, 'lesson-result-status')[0];
    assert.ok(status, 'the result exposes a status element');
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.equal(status.textContent, `Lesson completeYou got 4 of ${LESSON.exercises.length} right.`);

    const reviewMissed = byText(container, 'Review what I missed');
    assert.ok(reviewMissed, 'the "review what I missed" button is offered when there are misses');
    assert.ok(byText(container, 'Repeat lesson'), 'the "repeat lesson" button is offered');

    reviewMissed.click();
    await tick();
    assert.deepEqual(navigate, ['review'], 'reviewing the misses navigates to the review deck');
  } finally {
    dom.restore();
  }
});

/* ----------------------------------------------------------- tones screen -- */

test('tones: a wrong answer names the answer and is announced as a live region', async () => {
  const events = [];
  const dom = installFakeDom(events);
  try {
    const container = new dom.FakeNode('div');
    await playTonesToResultStepsToExercises(container);

    const options = withClass(container, 'btn', 'option');
    const wrong = options.find((b) => b.textContent.trim() === '2nd tone (má)'); // answer is "1st tone (mā)"
    wrong.click();

    const feedback = withClass(container, 'feedback', 'bad')[0];
    assert.ok(feedback, 'a wrong answer must render feedback.bad');
    assert.equal(
      feedback.textContent,
      'Incorrect. The answer is 1st tone (mā).',
      'tones now names the right answer, like lessons',
    );

    const box = withClass(container, 'feedback-box')[0];
    assert.equal(box.getAttribute('role'), 'status');
    assert.equal(box.getAttribute('aria-live'), 'polite');
    assert.equal(withClass(container, 'progress').length, 0, 'tones keeps no progress bar');
  } finally {
    dom.restore();
  }
});

test('tones: the result screen shows the score and a single Finish button', async () => {
  const events = [];
  const dom = installFakeDom(events);
  try {
    const navigate = [];
    const container = new dom.FakeNode('div');
    await playTonesToResult(container, navigate);

    assert.ok(withClass(container, 'lesson-result').length, 'tones result step did not render');
    assert.equal(
      withClass(container, 'lesson-result')[0].textContent.startsWith('Lesson complete'),
      true,
      'the result title is unchanged',
    );
    assert.equal(byText(container, 'Review what I missed'), undefined, 'tones offers no review-missed button');
    assert.ok(byText(container, 'Finish'), 'tones keeps its Finish button');
  } finally {
    dom.restore();
  }
});

/** Walks the tones lesson up to the first exercise (intro -> pinyin -> vocabulary -> exercises). */
async function playTonesToResultStepsToExercises(container) {
  await import('../src/data-url.js').then(({ configure }) =>
    configure({
      base: new URL('../public/data/', import.meta.url).href,
      fetch: async (url) => ({
        ok: true,
        status: 200,
        json: async () => JSON.parse(readFileSync(fileURLToPath(url), 'utf8')),
      }),
    }),
  );
  const { render } = await import('../src/learn/tones.js');
  await render(container, { navigate() {} });
  clickNext(container);
  clickNext(container);
  clickNext(container);
}
