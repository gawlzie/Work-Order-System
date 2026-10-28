// Service worker for the installable web app. It caches the app shell so the app opens without a network,
// but never caches /api: work-order data always comes live from the server.
const CACHE = 'wos-shell-v2';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = (request, response) => {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;

  // Pages: network first so a new deploy shows up at once; offline falls back to the cached shell (SPA routes).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => put('/', res))
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Built assets have content hashes, so a cached copy is always correct.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => put(request, res))));
    return;
  }

  // Everything else (icons, manifest): serve cached, refresh in the background.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request).then((res) => put(request, res)).catch(() => hit);
      return hit || network;
    }),
  );
});
