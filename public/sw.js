
const CACHE_NAME = 'movies-tracker-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/index.tsx'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Bypass caching/interception for Vite internal development files
  if (url.pathname.includes('/@') || url.pathname.includes('node_modules') || url.pathname.endsWith('.tsx') || url.pathname.endsWith('.ts')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
