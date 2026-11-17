/**
 * Extras / Profile screen: shell-level settings that exist today —
 * language switcher (i18n), storage engine info and PWA install button.
 * Streaks/achievements/drawing search (phase 4) plug in here later.
 * Contract: titleKey + render(container, ctx) — see src/main.js.
 */
import { t, getLocale, setLocale, availableLocales, localeLabel } from '../i18n.js';
import storage from '../storage.js';
import { h, reset } from '../dom.js';
import { canInstall, promptInstall, INSTALLABLE_EVENT } from '../pwa.js';

export const titleKey = 'screens.extras.title';

export function render(container) {
  reset(container);

  const engine = h('p', { text: t('common.loading') });
  storage.name().then((name) => {
    engine.textContent = `${t('profile.storage')}: ${t('profile.storageEngine', { driver: name })}`;
  });

  const languageSelect = h('select', {
    class: 'field',
    'aria-label': t('profile.language'),
    onchange: async (event) => {
      const code = event.target.value;
      await storage.set('settings', 'locale', code);
      setLocale(code); // triggers the app-wide re-render
    },
  });
  for (const code of availableLocales()) {
    languageSelect.append(
      h('option', { value: code, selected: code === getLocale() }, localeLabel(code)),
    );
  }

  const installButton = h('button', {
    type: 'button',
    class: 'field',
    text: t('profile.install'),
    disabled: !canInstall(),
    title: canInstall() ? '' : t('profile.installUnavailable'),
    onclick: async () => {
      const accepted = await promptInstall();
      installButton.disabled = !canInstall();
      if (!accepted) installButton.title = t('profile.installUnavailable');
    },
  });

  container.append(
    h(
      'section',
      { class: 'card' },
      h('h2', { text: t(titleKey) }),
      h('p', { text: t('screens.extras.hint') }),
    ),
    h(
      'section',
      { class: 'card' },
      h('label', { class: 'field-label', for: 'language' }, t('profile.language')),
      languageSelect,
    ),
    h('section', { class: 'card' }, engine),
    h('section', { class: 'card' }, installButton),
  );

  const onInstallable = () => {
    installButton.disabled = !canInstall();
  };
  // main.js already called watchInstallPrompt(); here we only react to it.
  globalThis.addEventListener(INSTALLABLE_EVENT, onInstallable);

  container.focus({ preventScroll: true });
  return () => globalThis.removeEventListener(INSTALLABLE_EVENT, onInstallable);
}
