/** Inline SVG icons for the tab bar (decorative: never translatable text). */
const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>',
  repeat: '<path d="M20 12a8 8 0 0 1-13.7 5.6L4 15"/><path d="M4 12a8 8 0 0 1 13.7-5.6L20 9"/><path d="M20 5v4h-4"/><path d="M4 19v-4h4"/>',
  learn: '<path d="M12 4 2 9l10 5 10-5-10-5z"/><path d="M6 11v5c0 1.4 2.7 3 6 3s6-1.6 6-3v-5"/>',
  book: '<path d="M3 5h6a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H3z"/><path d="M21 5h-6a3 3 0 0 0-3 3v11a2 2 0 0 1 2-2h7z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
};

export function icon(name) {
  const paths = PATHS[name] ?? PATHS.search;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export const ICONS = Object.keys(PATHS);
