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
