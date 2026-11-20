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
