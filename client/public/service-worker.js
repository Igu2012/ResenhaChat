const CACHE_NAME = "resenha-chat-shell-v3";
const CORE_ASSETS = ["/", "/manifest.json", "/favicon.ico?v=3", "/favicon.png?v=3", "/icon-192.png?v=4", "/icon-512.png?v=4"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    const shell = await fetch("/");
    const html = await shell.clone().text();
    await cache.put("/", shell);
    const assetPaths = Array.from(html.matchAll(/(?:src|href)="([^\"]*\/assets\/[^\"]+)"/g), match => match[1]);
    await cache.addAll(assetPaths);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) || (request.mode === "navigate" ? caches.match("/") : Response.error())),
  );
});
