/**
 * Hash router. Routes look like `#/learn/hsk1/lesson-1?x=1`.
 *
 * A screen module is any module exporting:
 *   titleKey: string                      -> i18n key used as the header title
 *   render(container, ctx)                -> mount the screen, optionally return
 *                                            a cleanup function
 *   ctx = { route: { name, segments, params, path }, navigate }
 */

/** Parses a hash into { name, segments, params, path }. */
export function parseRoute(hash, fallback = 'dictionary') {
  const raw = String(hash ?? '').replace(/^#\/?/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?');
  const segments = pathPart
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  const params = Object.fromEntries(new URLSearchParams(queryPart));
  return {
    name: segments[0] || fallback,
    segments: segments.slice(1),
    params,
    path: segments.join('/'),
  };
}

export function href(path) {
  return `#/${String(path).replace(/^#?\/?/, '')}`;
}

export function navigate(path, { replace = false } = {}) {
  const target = href(path);
  if (replace) {
    location.replace(`${location.pathname}${location.search}${target}`);
  } else {
    location.hash = target;
  }
}

export function createRouter({ container, screens, fallback = 'dictionary', onRoute }) {
  let cleanup = null;
  let currentRoute = null;
  // Monotonic render token: a slow screen must not paint over the next one.
  let seq = 0;

  async function render() {
    const parsed = parseRoute(location.hash, fallback);
    const known = Object.prototype.hasOwnProperty.call(screens, parsed.name);
    const route = known ? parsed : { ...parsed, name: fallback, unknown: parsed.name };
    const screen = screens[route.name];

    if (typeof cleanup === 'function') {
      try {
        cleanup();
      } catch (err) {
        console.warn('router: screen cleanup failed', err);
      }
    }
    cleanup = null;

    container.replaceChildren();
    const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
    let slot = container;
    if (doc) {
      slot = doc.createElement('div');
      slot.className = 'route-slot';
      container.append(slot);
    }
    const token = ++seq;
    const result = await screen.render(slot, { route, navigate });
    if (token !== seq) {
      // A newer render started: run this one's cleanup and drop its subtree
      // (it may have painted into the slot after its own await).
      if (typeof result === 'function') result();
      if (slot !== container) slot.remove();
      return route;
    }
    if (typeof result === 'function') cleanup = result;

    currentRoute = route;
    if (onRoute) onRoute(route);
    return route;
  }

  return {
    render,
    current: () => currentRoute,
    start() {
      globalThis.addEventListener('hashchange', () => {
        render();
      });
      if (!location.hash) {
        location.hash = href(fallback);
        return Promise.resolve(null);
      }
      return render();
    },
  };
}
