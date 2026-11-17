/**
 * Shared placeholder body for screens that are still empty (shell phase).
 * Real implementations replace the body but keep the same module contract.
 */
import { t } from '../i18n.js';
import { h, reset } from '../dom.js';

export function placeholder(container, titleKey, hintKey) {
  reset(container);
  container.append(
    h(
      'section',
      { class: 'card' },
      h('h2', { text: t(titleKey) }),
      h('span', { class: 'pill', text: t('common.comingSoon') }),
      h('p', { text: t(hintKey) }),
    ),
  );
  container.focus({ preventScroll: true });
}
