const CACHE_NAME = 'geopothole-cache-v1';
const ASSETS_TO_CACHE = [
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install Event: Cache critical static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up outdated caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Network-first fallback to cache for local pages, bypass cache for APIs
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Skip caching API queries and database operations entirely (pass directly to native network)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-First with Cache-Fallback for standard pages and resources
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses from local sources
        if (response.status === 200 && event.request.method === 'GET') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // If network request fails, look in cache
        return caches.match(event.request);
      })
  );
});
