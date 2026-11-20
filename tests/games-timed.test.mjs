// Timed quiz game logic tests — round generation and answer checking.
// Run with `npm test` (node --test tests/) or `node --test tests/games-timed.test.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { generateTimedRound, checkTimedAnswer } from '../src/learn/games/timed.js';

const SAMPLE_WORDS = [
  { hanzi: '你', pinyin: 'nǐ', english: 'you' },
  { hanzi: '好', pinyin: 'hǎo', english: 'good' },
  { hanzi: '谢', pinyin: 'xiè', english: 'thank' },
  { hanzi: '再', pinyin: 'zài', english: 'again' },
  { hanzi: '见', pinyin: 'jiàn', english: 'see' },
  { hanzi: '大', pinyin: 'dà', english: 'big' },
  { hanzi: '小', pinyin: 'xiǎo', english: 'small' },
  { hanzi: '吃', pinyin: 'chī', english: 'eat' },
  { hanzi: '喝', pinyin: 'hē', english: 'drink' },
  { hanzi: '去', pinyin: 'qù', english: 'go' },
  { hanzi: '来', pinyin: 'lái', english: 'come' },
];

/* -------------------------------------------------------- Timed round tests -- */

test('generateTimedRound returns correct number of questions', () => {
  const round = generateTimedRound(SAMPLE_WORDS, { count: 5, mode: 'english' });
  assert.equal(round.questions.length, 5);
});

test('generateTimedRound respects count limit', () => {
  const round = generateTimedRound(SAMPLE_WORDS, { count: 3, mode: 'english' });
  assert.equal(round.questions.length, 3);
});

test('generateTimedRound handles empty word list', () => {
  const round = generateTimedRound([], { count: 5 });
  assert.deepEqual(round.questions, []);
});

test('generateTimedRound english mode: questions have hanzi, pinyin, english, options, correctIndex', () => {
  const round = generateTimedRound(SAMPLE_WORDS, { count: 4, mode: 'english' });
  for (const q of round.questions) {
    assert.ok(q.hanzi);
    assert.ok(q.pinyin);
    assert.ok(q.english);
    assert.ok(Array.isArray(q.options));
    assert.equal(q.options.length, 4);
    assert.ok(typeof q.correctIndex === 'number');
    assert.ok(q.correctIndex >= 0 && q.correctIndex < 4);
    assert.equal(q.mode, 'english');
    // Correct answer should be in options
    assert.equal(q.options[q.correctIndex], q.english);
  }
});

test('generateTimedRound audio mode: questions have hanzi options', () => {
  const round = generateTimedRound(SAMPLE_WORDS, { count: 4, mode: 'audio' });
  for (const q of round.questions) {
    assert.ok(q.hanzi);
    assert.ok(q.pinyin);
    assert.ok(q.english);
    assert.ok(Array.isArray(q.options));
    assert.equal(q.options.length, 4);
    assert.ok(typeof q.correctIndex === 'number');
    assert.ok(q.correctIndex >= 0 && q.correctIndex < 4);
    assert.equal(q.mode, 'audio');
    // Correct answer should be hanzi
    assert.equal(q.options[q.correctIndex], q.hanzi);
  }
});

test('generateTimedRound all options are unique per question', () => {
  const round = generateTimedRound(SAMPLE_WORDS, { count: 5, mode: 'english' });
  for (const q of round.questions) {
    const unique = new Set(q.options);
    assert.equal(unique.size, 4, 'Options should be unique');
  }
});

/* -------------------------------------------------------- checkTimedAnswer tests -- */

test('checkTimedAnswer: correct answer returns correct=true, streak=1, score=1', () => {
  const question = { correctIndex: 2 };
  const result = checkTimedAnswer(question, 2);
  assert.equal(result.correct, true);
  assert.equal(result.streak, 1);
  assert.equal(result.score, 1);
});

test('checkTimedAnswer: wrong answer returns correct=false, streak=0, score=0', () => {
  const question = { correctIndex: 2 };
  const result = checkTimedAnswer(question, 0);
  assert.equal(result.correct, false);
  assert.equal(result.streak, 0);
  assert.equal(result.score, 0);
});

test('checkTimedAnswer: out of bounds answer returns correct=false', () => {
  const question = { correctIndex: 2 };
  const result = checkTimedAnswer(question, 5);
  assert.equal(result.correct, false);
  assert.equal(result.streak, 0);
  assert.equal(result.score, 0);
});

test('checkTimedAnswer: negative answer returns correct=false', () => {
  const question = { correctIndex: 2 };
  const result = checkTimedAnswer(question, -1);
  assert.equal(result.correct, false);
});

/* ------------------------------------------------- chino:lesson_done tests -- */
// The screen flow needs a DOM and the 100 ms clock; both are faked here, no
// browser and no dependency (docs/REVIEW.md, findings #3 and #10).

/** Just enough DOM for the timed screen: elements, class selectors, clicks. */
function installFakeDom(events) {
  class FakeNode {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.attrs = {};
      this.className = '';
      this.id = '';
      this.hidden = false;
      this._text = '';
      this._listeners = new Map();
      const classes = () => this.className.split(' ').filter(Boolean);
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
    click() {
      for (const fn of this._listeners.get('click') ?? []) fn({ currentTarget: this });
    }
    focus() {}
    querySelectorAll(selector) {
      const want = selector.replace(/^\./, '');
      const out = [];
      for (const child of this.children) {
        if (child.classList?.contains(want)) out.push(child);
        out.push(...(child.querySelectorAll?.(selector) ?? []));
      }
      return out;
    }
  }

  const head = new FakeNode('head');
  globalThis.Node = FakeNode;
  globalThis.document = {
    head,
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

/** Fake clock driving the screen's setInterval/setTimeout. */
function installFakeTimers() {
  const real = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  let now = 0;
  const timers = new Set();
  const schedule = (fn, ms, interval) => {
    const timer = { fn, ms, next: now + ms, interval, cleared: false };
    timers.add(timer);
    return timer;
  };
  globalThis.setTimeout = (fn, ms = 0) => schedule(fn, ms, false);
  globalThis.clearTimeout = (timer) => {
    if (timer) timer.cleared = true;
  };
  globalThis.setInterval = (fn, ms = 0) => schedule(fn, ms, true);
  globalThis.clearInterval = (timer) => {
    if (timer) timer.cleared = true;
  };
  return {
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers]
          .filter((timer) => !timer.cleared && timer.next <= end)
          .sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        now = due.next;
        if (due.interval) due.next = now + due.ms;
        else due.cleared = true;
        due.fn();
      }
      now = end;
    },
    restore: () => Object.assign(globalThis, real),
  };
}

test('the timed game fires chino:lesson_done exactly once per finished game', async () => {
  const events = [];
  const timers = installFakeTimers();
  const dom = installFakeDom(events);
  try {
    // The screen loads its words through data-url; read them from the repo.
    const { configure } = await import('../src/data-url.js');
    configure({
      base: new URL('../public/data/', import.meta.url).href,
      fetch: async (url) => ({
        ok: true,
        status: 200,
        json: async () => JSON.parse(await readFile(fileURLToPath(url), 'utf8')),
      }),
    });

    const { render } = await import('../src/learn/games/timed.js');
    const container = new dom.FakeNode('div');
    const cleanup = await render(container, {
      route: { name: 'learn', segments: ['timed', 'hsk1', 'english'] },
      navigate() {},
    });

    for (let i = 0; i < 10; i += 1) {
      const options = container.querySelectorAll('.timed-option');
      assert.equal(options.length, 4, `question ${i + 1} renders 4 options`);
      options[0].click();
      timers.advance(600); // the answer-feedback timeout
    }

    timers.advance(2000); // the report's repro: 2 s of the 100 ms clock, result screen showing
    assert.equal(events.length, 1, 'exactly one chino:lesson_done per game');
    assert.equal(events[0].type, 'chino:lesson_done');
    assert.equal(events[0].detail.total, 10);
    cleanup();
  } finally {
    timers.restore();
    dom.restore();
  }
});