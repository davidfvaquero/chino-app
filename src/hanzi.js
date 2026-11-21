/**
 * hanziCell — hanzi on the calligraphy practice grid (see docs/DESIGN.md).
 * size: 'sm' | 'md' | 'lg'. `--n` (character count) sizes one grid tile per character.
 */
import { h } from './dom.js';

export function hanziCell(text, size = 'md', extra = '') {
  const value = String(text ?? '');
  return h('span', {
    class: `hz-cell ${size}${extra ? ` ${extra}` : ''}`,
    style: `--n:${Math.max(1, [...value].length)}`,
    lang: 'zh-Hans',
    text: value,
  });
}

/**
 * Inline Chinese text tagged with `lang="zh-Hans"`, so a screen reader uses a
 * Chinese voice even when the document language is es/en (WCAG 3.1.2, I13).
 * `tag` is the element name; `attrs` are extra attributes (class, data-…).
 */
export function zhText(text, tag = 'span', attrs = {}) {
  return h(tag, { ...attrs, lang: 'zh-Hans', text: String(text ?? '') });
}

const HAN_RUN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;

/**
 * Split `text` into nodes, wrapping every run of Han characters in a
 * `lang="zh-Hans"` span (WCAG 3.1.2). For mixed strings a screen reader would
 * otherwise read the Chinese with the document language (es/en). Returns an
 * array of strings and elements, ready for `h(tag, attrs, ...zhRuns(text))`.
 */
export function zhRuns(text) {
  const s = String(text ?? '');
  const out = [];
  let last = 0;
  for (const m of s.matchAll(HAN_RUN_RE)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(h('span', { lang: 'zh-Hans', text: m[0] }));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
