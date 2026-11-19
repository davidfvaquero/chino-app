/**
 * Service worker: precaches the app shell and caches downloaded data JSON at
 * runtime so the app keeps working offline once visited.
 *
 * Paths are relative to this file, so the built site works from any subfolder.
 */
/** Cache namespace. `npm run build` rewrites 'dev' with a content hash. */
const VERSION = 'dev';
const SHELL_CACHE = `chino-shell-${VERSION}`;
const DATA_CACHE = `chino-data-${VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './src/styles.css',
  './fonts/onest-latin.woff2',
  './src/main.js',
  './src/dom.js',
  './src/i18n.js',
  './src/icons.js',
  './src/pwa.js',
  './src/router.js',
  './src/storage.js',
  './src/locales/index.json',
  './src/locales/en.json',
  './src/screens/dictionary.js',
  './src/screens/extras.js',
  './src/screens/learn.js',
  './src/screens/placeholder.js',
  './src/screens/read.js',
  './src/screens/review.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individual adds: one missing optional file must not break install.
      await Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, DATA_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

const isDataRequest = (url) => /\/data\//.test(url.pathname) && url.pathname.endsWith('.json');

/** Data JSON: stale-while-revalidate (fast, and refreshes in the background). */
async function dataStrategy(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached ?? (await network) ?? Response.error();
}

/** Shell assets: cache-first, then network (and store what we fetched). */
async function shellStrategy(request, event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isDataRequest(url)) {
    event.respondWith(dataStrategy(request));
    return;
  }
  event.respondWith(shellStrategy(request, event));
});
