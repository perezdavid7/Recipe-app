const CACHE_NAME = "kitchen-pro-v261-icon-refresh";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./recipes.json",
  "./kitchenpro-v261.webmanifest",
  "./kitchenpro-icon-192-v261.png",
  "./kitchenpro-icon-512-v261.png",
  "./kitchenpro-apple-touch-v261.png",
  "./kitchenpro-logo.png",
  "./kitchenpro-favicon-v261.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      return response;
    }).catch(() => caches.match("./index.html")))
  );
});
