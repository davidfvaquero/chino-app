/**
 * notice.js — the shell's #app-status toast, for screens that need to report
 * something the user asked for and could not happen (e.g. no audio available).
 * Same element and CSS the shell's own `flash()` uses in src/main.js.
 */
import { t } from './i18n.js';

/** Show `t(key, params)` in the toast for 4s; no-op outside the browser shell. */
export function notice(key, params) {
  const el = globalThis.document?.getElementById?.('app-status');
  if (!el) return;
  el.textContent = t(key, params);
  el.hidden = false;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}
