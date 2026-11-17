/**
 * App shell bootstrap: loads locales, picks the saved language, wires the
 * bottom tab bar and hands control to the hash router.
 *
 * Screen contract for other tasks: create src/screens/<name>.js exporting
 *   export const titleKey = 'screens.<name>.title';
 *   export function render(container, ctx) { ... }
 * and register it in SCREENS below + in NAV if it belongs in the tab bar.
 */
import {
  t,
  DEFAULT_LOCALE,
  setLocale,
  getLocale,
  hasLocale,
  availableLocales,
  loadAvailableLocales,
  subscribe,
} from './i18n.js';
import storage from './storage.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { createRouter, navigate } from './router.js';
import { registerServiceWorker, watchInstallPrompt } from './pwa.js';
import * as dictionary from './screens/dictionary.js';
import * as review from './screens/review.js';
import * as learn from './screens/learn.js';
import * as read from './screens/read.js';
import * as extras from './screens/extras.js';

const SCREENS = { dictionary, review, learn, read, extras };
const NAV = [
  { route: 'dictionary', icon: 'search' },
  { route: 'review', icon: 'repeat' },
  { route: 'learn', icon: 'learn' },
  { route: 'read', icon: 'book' },
  { route: 'extras', icon: 'user' },
];
const FALLBACK_ROUTE = 'dictionary';

const el = {
  header: document.getElementById('app-header'),
  screen: document.getElementById('screen'),
  nav: document.getElementById('app-nav'),
  status: document.getElementById('app-status'),
};

let router = null;

function pickLocale(saved) {
  if (saved && hasLocale(saved)) return saved;
  const preferred = (globalThis.navigator?.languages ?? []).concat(
    globalThis.navigator?.language ?? [],
  );
  for (const tag of preferred) {
    const code = String(tag).toLowerCase().split('-')[0];
    if (hasLocale(code)) return code;
  }
  return hasLocale(DEFAULT_LOCALE) ? DEFAULT_LOCALE : availableLocales()[0] ?? DEFAULT_LOCALE;
}

function renderChrome(route = router?.current()) {
  const screen = (route && SCREENS[route.name]) || SCREENS[FALLBACK_ROUTE];
  const active = route?.name ?? FALLBACK_ROUTE;

  el.header.textContent = t(screen.titleKey);
  el.nav.setAttribute('aria-label', t('nav.label'));
  el.nav.replaceChildren(
    ...NAV.map((item) => {
      const label = h('span', { class: 'tab-label', text: t(`nav.${item.route}`) });
      return h(
        'button',
        {
          type: 'button',
          class: 'tab',
          'data-route': item.route,
          'aria-current': active === item.route ? 'page' : 'false',
          html: icon(item.icon), // trusted local SVG markup
          onclick: () => navigate(item.route),
        },
        label,
      );
    }),
  );

  document.title = t('app.title');
  document.documentElement.lang = getLocale();
}

function flash(message) {
  if (!el.status) return;
  el.status.textContent = message;
  el.status.hidden = false;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => {
    el.status.hidden = true;
  }, 4000);
}

async function boot() {
  await loadAvailableLocales();
  setLocale(pickLocale(await storage.get('settings', 'locale')));

  router = createRouter({
    container: el.screen,
    screens: SCREENS,
    fallback: FALLBACK_ROUTE,
    onRoute: (route) => {
      renderChrome(route);
      if (route.unknown) flash(t('errors.routeMissing', { screen: route.unknown }));
    },
  });

  subscribe(() => {
    renderChrome();
    router.render();
  });

  watchInstallPrompt();
  renderChrome();
  await router.start();
  registerServiceWorker();
  document.documentElement.dataset.ready = 'true';
}

boot().catch((err) => {
  console.error('boot failed', err);
  el.screen.replaceChildren(h('p', { text: String(err?.message ?? err) }));
});
