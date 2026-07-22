const CACHE_NAME = 'club-hub-v1';

const SHELL_FILES = [
  './index.html',
  './admin.html',
  './css/style.css',
  './js/app.js',
  './js/admin.js',
  './js/github-api.js',
  './manifest.json',
  './manifest-admin.json',
  './app-icons/app-icon-192.png',
  './app-icons/app-icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isDataFile = url.pathname.includes('/data/') || url.pathname.includes('/assets/');

  if (isDataFile) {
    // Network-first: club content should be as fresh as possible when online,
    // but still viewable offline from the last successful fetch.
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for the app shell itself.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
