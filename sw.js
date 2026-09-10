const CACHE = 'fireracker-v6';
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/css/index.css',
  '/css/contacts.css',
  '/css/dati.css',
  '/css/admin.css',
  '/css/history.css',
  '/js/index.js',
  '/js/admin.js',
  '/js/history.js',
  '/img/favicon.png',
  '/img/logo.png',
  '/img/marker.png',
  '/img/icon-192.png',
  '/img/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;

  // Solo richieste GET (POST/PUT/DELETE passano normali)
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cross-origin (tile mappa): network-first, cache le tile già viste
  if (url.origin !== self.location.origin) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Stesso origin: network-first con fallback cache
  // -> contenuti sempre aggiornati quando online, offline usa la cache
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then(hit => {
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match('/');
          return Response.error();
        })
      )
  );
});