/**
 * tests/helpers/fake-dom.mjs — a tiny hand-rolled DOM, just enough to render the
 * real screens in Node (no browser, no dependency). Same trick as
 * tests/tone-lessons-engine.test.mjs, extended with querySelector/insertBefore
 * and a generic event dispatch so screens that look elements up by class work.
 */

export function installFakeDom(events = []) {
  const all = [];
  const parseSelector = (selector) => {
    const s = String(selector).trim();
    if (s.startsWith('#')) return { id: s.slice(1) };
    const classes = s.split('.').filter(Boolean);
    const tag = classes[0] && !s.startsWith('.') ? classes.shift() : null;
    return { tag, classes };
  };
  const matches = (node, sel) => {
    if (sel.id) return node.id === sel.id;
    if (sel.tag && node.tagName !== sel.tag) return false;
    return (sel.classes ?? []).every((c) => node.classList.contains(c));
  };

  class FakeNode {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.attrs = {};
      this.className = '';
      this.id = '';
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this._text = '';
      this.style = { setProperty() {}, removeProperty() {} };
      this._listeners = new Map();
      this.parent = null;
      all.push(this);
      const classes = () => String(this.className).split(' ').filter(Boolean);
      this.classList = {
        add: (...names) => { this.className = [...new Set([...classes(), ...names])].join(' '); },
        remove: (...names) => { this.className = classes().filter((c) => !names.includes(c)).join(' '); },
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
    set innerHTML(_value) { this._text = ''; this.children = []; }
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name === 'id') this.id = String(value);
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[key] = String(value);
      }
    }
    getAttribute(name) { return this.attrs[name]; }
    append(...nodes) {
      for (const node of nodes) {
        if (node && typeof node === 'object') node.parent = this;
        this.children.push(node);
      }
    }
    replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
    insertBefore(node, ref) {
      const at = this.children.indexOf(ref);
      if (node && typeof node === 'object') node.parent = this;
      if (at === -1) this.children.push(node);
      else this.children.splice(at, 0, node);
    }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    }
    removeEventListener() {}
    dispatch(type, event = {}) {
      for (const fn of this._listeners.get(type) ?? []) fn({ currentTarget: this, target: this, preventDefault() {}, ...event });
    }
    click() { this.dispatch('click'); }
    focus() {}
    get options() { return this.children.filter((c) => c.tagName === 'option'); }
    descendants() {
      const out = [];
      const walk = (node) => { for (const child of node.children) { out.push(child); walk(child); } };
      walk(this);
      return out;
    }
    querySelectorAll(selector) {
      const sel = parseSelector(selector);
      return this.descendants().filter((node) => matches(node, sel));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    get isConnected() { return true; }
  }

  const head = new FakeNode('head');
  const body = new FakeNode('body');
  const html = new FakeNode('html');
  globalThis.Node = FakeNode;
  globalThis.document = {
    head,
    body,
    documentElement: html,
    baseURI: 'http://localhost/',
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => { const node = new FakeNode('#text'); node.textContent = text; return node; },
    getElementById: (id) => all.find((node) => node.id === id) ?? null,
    addEventListener() {},
    removeEventListener() {},
    title: '',
    visibilityState: 'visible',
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: (event) => { events.push(event); return true; },
  };
  return {
    FakeNode,
    events,
    tick: () => new Promise((resolve) => setTimeout(resolve, 0)),
    restore: () => {
      delete globalThis.Node;
      delete globalThis.document;
      delete globalThis.window;
    },
  };
}

/** Clicks the first element carrying all the given classes. */
export const withClass = (root, ...names) =>
  root.querySelectorAll(`.${names.join('.')}`);

export const byText = (root, text) =>
  root.descendants().findLast((node) => node.textContent.trim() === text);
