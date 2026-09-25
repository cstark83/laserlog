/*
 * LaserLog service worker.
 *
 * App shell is cache-first so the thing opens instantly and works with the
 * wifi off. API calls are network-first — a stale settings number is worse
 * than a spinner — and fall back to the last good response when offline.
 * The IndexedDB mirror in api.js is the real offline story; this is the shell.
 */

const VERSION = 'v1.1.0';
const SHELL_CACHE = `laserlog-shell-${VERSION}`;
const API_CACHE = `laserlog-api-${VERSION}`;

const SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/timer.js',
  '/js/views/dashboard.js',
  '/js/views/entries.js',
  '/js/views/library.js',
  '/js/views/projects.js',
  '/js/views/tests.js',
  '/js/views/settings.js',
  '/js/views/photos.js',
  '/js/views/files.js',
  '/js/views/colours.js',
  '/js/views/inventory.js',
  '/js/views/products.js',
  '/js/views/finishes.js',
  '/js/views/maintenance.js',
  '/js/presets.js',
  '/manifest.webmanifest',
  '/img/icon.svg',
  '/img/icon-192.png',
  '/img/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== API_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache auth state — a stale "signed in" wedges the app.
  if (url.pathname.startsWith('/api/auth')) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(cacheFirst(request, API_CACHE));
    return;
  }

  // Navigations: try the network, fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html', { cacheName: SHELL_CACHE }))
    );
    return;
  }

  event.respondWith(cacheFirst(request, SHELL_CACHE));
});

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    const hit = await caches.match(request, { cacheName: API_CACHE });
    if (hit) {
      // Tell the app this came out of the cache, not off the wire. Without
      // this it sees a 200 and believes it is still online.
      const headers = new Headers(hit.headers);
      headers.set('X-LaserLog-Cache', '1');
      return new Response(await hit.blob(), {
        status: hit.status,
        statusText: hit.statusText,
        headers,
      });
    }
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'X-LaserLog-Cache': '1' },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const hit = await caches.match(request, { cacheName });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}
