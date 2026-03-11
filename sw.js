const CACHE_NAME = 'turni-v10';
const ASSETS = [
  '/weekly-shifts/',
  '/weekly-shifts/index.html',
  '/weekly-shifts/style.css',
  '/weekly-shifts/app.js',
  '/weekly-shifts/manifest.json',
  '/weekly-shifts/icon-192.png',
  '/weekly-shifts/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
