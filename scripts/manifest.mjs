/**
 * Builds manifest.webmanifest from a locale dictionary, so the app name and
 * description live in i18n like every other string (no duplicated copy).
 */
export const THEME_COLOR = '#17645f';
export const BACKGROUND_COLOR = '#eef1ec';

export function manifestFromLocale(dict, lang = 'en') {
  const app = dict?.app ?? {};
  return {
    name: app.title ?? 'Chino',
    short_name: app.short_name ?? app.title ?? 'Chino',
    description: app.description ?? '',
    lang,
    dir: 'ltr',
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'portrait',
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: './icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
