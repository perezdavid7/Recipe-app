const CACHE_NAME = "kitchen-pro-v263-iphone-update-fix";
const CORE = [
  "./",
  "./index.html",
  "./styles.css?v=263",
  "./app.js?v=263",
  "./recipes.json",
  "./kitchenpro-v261.webmanifest",
  "./kitchenpro-logo.png",
  "./kitchenpro-icon-192-v261.png",
  "./kitchenpro-icon-512-v261.png",
  "./kitchenpro-apple-touch-v261.png",
  "./kitchenpro-favicon-v261.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  try {
    const fresh = await fetch(request, { cache: "no-store" });
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  const cache = await caches.open(CACHE_NAME);
  cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isNavigation = event.request.mode === "navigate";
  const isAppCode =
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/styles.css") ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/recipes.json");

  if (isNavigation || isAppCode) {
    event.respondWith(networkFirst(event.request));
  } else {
    event.respondWith(cacheFirst(event.request));
  }
});
