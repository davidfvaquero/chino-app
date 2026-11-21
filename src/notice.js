/**
 * notice.js — the shell's #app-status toast, for screens that need to report
 * something the user asked for and could not happen (e.g. no audio available).
 * Same element (#app-status) and CSS the shell uses; the shell imports this too.
 */
import { t } from './i18n.js';

/** Show `t(key, params)` in the toast for 4s; no-op outside the browser shell. */
export function notice(key, params) {
  const el = globalThis.document?.getElementById?.('app-status');
  if (!el) return;
  // Make the region visible first, then set the text in the next frame: a
  // screen reader only announces an aria-live region whose content changes
  // after it is already in the accessibility tree.
  el.hidden = false;
  el.textContent = '';
  const raf = globalThis.requestAnimationFrame ?? ((fn) => setTimeout(fn, 0));
  raf(() => {
    el.textContent = t(key, params);
  });
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}
