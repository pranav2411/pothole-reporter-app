const CACHE_NAME = 'geopothole-cache-v4';
const ASSETS_TO_CACHE = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install Event: Activate immediately
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
});

// Activate Event: Delete ALL previous caches and take control of all clients immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Purging outdated cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Direct network pass-through for APIs and HTML pages
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip caching API queries and database operations entirely (pass directly to native network)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Always fetch HTML documents directly from network so client app is never stuck on stale code
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Network-First with Cache-Fallback for static assets
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        if (response.status === 200 && event.request.method === 'GET' && !url.pathname.endsWith('.html')) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      });
    })
  );
});
