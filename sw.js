const CACHE_NAME = "kitchen-pro-v292";
const CORE = [
  "./",
  "./index.html",
  "./styles.css?v=292",
  "./app.js?v=292",
  "./kitchenpro-v28.webmanifest",
  "./apple-touch-icon.png",
  "./favicon-32.png",
  "./icon-192.png",
  "./icon-512.png",
  "./kitchenpro-logo.png",
  "./recipes.json"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(CORE.map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME && k.startsWith("kitchen-pro-")).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if(event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try{
      const response = await fetch(event.request, {cache:"no-store"});
      if(response && response.ok) cache.put(event.request, response.clone()).catch(()=>{});
      return response;
    }catch(err){
      const cached = await cache.match(event.request, {ignoreSearch:false}) ||
                     await cache.match(url.pathname.endsWith("/") ? "./index.html" : event.request, {ignoreSearch:true});
      if(cached) return cached;
      if(event.request.mode === "navigate"){
        const fallback = await cache.match("./index.html");
        if(fallback) return fallback;
      }
      throw err;
    }
  })());
});
