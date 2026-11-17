/**
 * Profile & progress (stub). The owner task replaces this file (streak, points,
 * achievements, language switcher); the hub only needs `titleKey` +
 * `render(container, ctx)`.
 */
import { placeholder } from '../screens/placeholder.js';

export const titleKey = 'hubs.extras.profile';

export function render(container) {
  placeholder(container, titleKey, 'screens.extras.hint');
}
