/** PWA plumbing: service worker registration and install prompt capture. */

let deferredPrompt = null;

export const INSTALLABLE_EVENT = 'chino:installable';

export function watchInstallPrompt(target = globalThis) {
  target.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    target.dispatchEvent(new Event(INSTALLABLE_EVENT));
  });
  target.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    target.dispatchEvent(new Event(INSTALLABLE_EVENT));
  });
}

export function canInstall() {
  return Boolean(deferredPrompt);
}

/** Returns true when the user accepted the install dialog. */
export async function promptInstall() {
  if (!deferredPrompt) return false;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome === 'accepted';
}

export function registerServiceWorker(options = {}) {
  if (!('serviceWorker' in navigator)) return null;
  if (!location.protocol.startsWith('http')) return null; // file:// has no SW
  const url = options.url ?? new URL('../sw.js', import.meta.url);
  const registration = navigator.serviceWorker.register(url, { scope: './' });
  // skipWaiting + clients.claim swap modules mid-session: reload once so the
  // running code and the served shell always come from the same build. Only when
  // a controller already existed: on the first visit there is none, and the
  // controllerchange fired by clients.claim() would reload the page 1-3 s in and
  // throw away whatever the user had started (REVIEW-3 I1).
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); }, { once: true });
  registration.catch((err) => console.warn('service worker registration failed', err));
  return registration;
}
