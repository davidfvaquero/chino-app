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
  registration.catch((err) => console.warn('service worker registration failed', err));
  return registration;
}
