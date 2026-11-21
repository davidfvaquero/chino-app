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
/** Data cache. `npm run build` stamps it with a hash of the data files it holds,
 *  so a corrected shard reaches a user who already had the old copy. A code-only
 *  change leaves the name alone and the downloaded data survives (REVIEW-3 I7). */
const DATA_CACHE = 'chino-data-dev';

// Minimal list; `npm run build` injects the full shell list. In dev the SW is
// bypassed entirely (see the fetch listener), so this only serves as a stub.
const SHELL_ASSETS = [
  './',
  './index.html',
];

/** Entry points: without them the app cannot boot offline, so their failure
 *  must fail the install (the browser retries later) instead of activating a
 *  service worker that serves a half-filled shell. */
const isEssential = (url) => url === './' || /(^|\/)index\.html$/.test(url) || url.endsWith('manifest.webmanifest');

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const add = (url) => cache.add(new Request(url, { cache: 'reload' }));
      const settle = (urls) =>
        Promise.allSettled(urls.map(add)).then((results) => urls.filter((_, i) => results[i].status === 'rejected'));
      // Individual adds: one missing optional file must not break install.
      // Retry the failures once (a transient blip must not leave a half-filled
      // precache), then fail the install if an essential is still missing.
      let failed = await settle(SHELL_ASSETS);
      if (failed.length) failed = await settle(failed);
      const missing = failed.filter(isEssential);
      if (missing.length) throw new Error(`precache failed: ${missing.join(', ')}`);
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

/** Data that never changes between app versions: cache-first, no revalidation. */
const isImmutableData = (url) => /\/(?:es\/)?(?:dict|search|search-es|strokes)\//.test(url.pathname);

/** Data JSON: stale-while-revalidate, or cache-first for immutable data.
 *  Returns `{ response, network }` so the fetch listener can hand `network` to
 *  `event.waitUntil` synchronously: once the response has settled, a later
 *  `waitUntil` throws InvalidStateError and the refresh would be lost. */
function dataStrategy(request) {
  const cachePromise = caches.open(DATA_CACHE);
  const cachedPromise = caches.match(request);
  const network = cachedPromise
    .then((cached) => (cached && isImmutableData(new URL(request.url)) ? null : fetch(request)))
    .then((response) => {
      if (!response || !response.ok) return response ?? null;
      // A failed `put` (quota) must not hold back a response the network gave:
      // the refresh is a bonus, not a condition.
      return cachePromise
        .then((cache) => cache.put(request, response.clone()))
        .then(() => response, () => response);
    })
    .catch(() => null);
  const response = (async () => {
    const cached = await cachedPromise;
    if (cached && isImmutableData(new URL(request.url))) return cached;
    return cached ?? (await network) ?? Response.error();
  })();
  return { response, network };
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
    const { response, network } = dataStrategy(request);
    // Called synchronously, before respondWith settles.
    event.waitUntil(network);
    event.respondWith(response);
    return;
  }
  event.respondWith(shellStrategy(request));
});
