/**
 * Service worker: precaches the app shell and caches downloaded data JSON at
 * runtime so the app keeps working offline once visited.
 *
 * Paths are relative to this file, so the built site works from any subfolder.
 */
/** Cache namespace. `npm run build` rewrites 'dev' with a content hash. */
const VERSION = 'dev';
const DEV = VERSION === 'dev';
const SHELL_CACHE = `chino-shell-${VERSION}`;
const DATA_CACHE = `chino-data-${VERSION}`;

// Minimal list; `npm run build` injects the full shell list. In dev the SW is
// bypassed entirely (see the fetch listener), so this only serves as a stub.
const SHELL_ASSETS = [
  './',
  './index.html',
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
  // Search every cache: a cold visit precached lessons/files into SHELL_CACHE.
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached ?? (await network) ?? Response.error();
}

/** Shell assets: cache-first, then network (and store what we fetched). */
async function shellStrategy(request) {
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
  // In dev, always hit the network: caching would serve stale modules forever.
  if (DEV) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isDataRequest(url)) {
    event.respondWith(dataStrategy(request));
    return;
  }
  event.respondWith(shellStrategy(request));
});
