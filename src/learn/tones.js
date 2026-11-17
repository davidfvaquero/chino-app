/**
 * Tones & pinyin (stub). The owner task replaces this file; the hub only needs
 * `titleKey` + `render(container, ctx)`.
 */
import { placeholder } from '../screens/placeholder.js';

export const titleKey = 'hubs.learn.tones';

export function render(container) {
  placeholder(container, titleKey, 'screens.learn.hint');
}
