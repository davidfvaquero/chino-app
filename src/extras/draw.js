/**
 * Draw a character (stub). The owner task replaces this file (canvas +
 * src/extras/strokematch.js); the hub only needs `titleKey` +
 * `render(container, ctx)`.
 */
import { placeholder } from '../screens/placeholder.js';

export const titleKey = 'hubs.extras.draw';

export function render(container) {
  placeholder(container, titleKey, 'screens.extras.hint');
}
