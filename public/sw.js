/*
 * Service worker: make the app open without a connection.
 *
 * The data was always local (localStorage), but the app itself loads from
 * GitHub Pages - so in a dealership basement with no signal the page would not
 * load at all, which is exactly where this thing is meant to be used. That is
 * the whole job.
 *
 * Hand-written rather than generated. Workbox would be a large dependency for
 * sixty lines, and the caching policy is the one part of a service worker that
 * has to be understood rather than copied: get it wrong and users are stuck on
 * old code with no way to tell.
 *
 * ## The policy, and why
 *
 * HTML is **network-first**. It is the file that names which hashed assets to
 * load, so serving a stale one is how people end up pinned to an old build
 * forever. Online, every navigation gets the current HTML; offline, the last
 * one seen. Staleness is therefore bounded by one navigation with signal - which
 * matters here, because the app is mid-way through a series of data-shape
 * migrations and a phone running last month's bundle is a case the code has to
 * handle rather than a case to create.
 *
 * Hashed assets are **cache-first**. Their filenames change when their contents
 * do, so a cached one can never be wrong.
 *
 * Everything cross-origin is **left alone**: the GitHub API must always be live
 * or sync would read a stale gist, and Google Fonts failing offline costs a
 * fallback font rather than a broken app.
 *
 * ## Taking over
 *
 * `skipWaiting` + `clients.claim` so a new build is in charge immediately rather
 * than after every tab has been closed. That is safe *because this app is a
 * single bundle*: with code splitting, an open page could ask for a lazy chunk
 * that the new worker has just evicted. If chunks are ever introduced, this has
 * to become the wait-for-the-next-load dance instead.
 *
 * The open page is deliberately not reloaded. It would be the only way to
 * guarantee fresh code in a tab left open for days, and it would also throw away
 * whatever half-filled car form the person was looking at.
 */

// Bump to evict everything. The hashed assets make that rarely necessary; the
// HTML cache is the reason it exists at all.
const VERSION = 'v1';
const SHELL = `car-tco-shell-${VERSION}`;
const ASSETS = `car-tco-assets-${VERSION}`;
const MINE = new Set([SHELL, ASSETS]);

self.addEventListener('install', () => {
  // Nothing is precached: the asset filenames are hashed at build time and this
  // file is not built, so it cannot know them. The first online visit caches
  // what the app actually uses, which is the same set and needs no build step.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('car-tco-') && !MINE.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** A request for a page, as opposed to for something a page needs. */
function isNavigation(request) {
  return (
    request.mode === 'navigate' ||
    (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'))
  );
}

/**
 * Fresh if possible, cached if not.
 *
 * Only a *network error* falls back to the cache - an HTTP error is a real
 * answer from a working server and belongs to the page, not to us. Serving a
 * cached page over somebody's 404 would hide it.
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // A deep link with nothing cached for it: the app is a single page, so its
    // shell answers for any path within scope.
    const shell = await cache.match('./');
    if (shell) return shell;
    throw new Error('offline and nothing cached');
  }
}

/** Cached if present, otherwise fetched and kept. Safe only for immutable URLs. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Cross-origin is none of our business - see the note above about the GitHub
  // API and fonts.
  if (url.origin !== self.location.origin) return;

  if (isNavigation(request)) {
    event.respondWith(networkFirst(request, SHELL));
    return;
  }

  // Vite emits hashed filenames into assets/, so those are immutable. Icons and
  // the manifest are not hashed, but they change about once a year and a stale
  // icon is not a bug worth a network round trip on every load.
  if (/\/(assets|icons)\//.test(url.pathname) || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(cacheFirst(request, ASSETS));
  }
});
