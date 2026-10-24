const CACHE_NAME = "chat-story-static-v1";
const MANIFEST_URL = new URL("./precache-manifest.json", self.registration.scope).toString();

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Offline asset manifest unavailable");
    const manifest = await response.clone().json();
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(manifest.files);
    await cache.put(MANIFEST_URL, response);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("chat-story-") && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") await cache.put(request, response.clone());
      return response;
    } catch {
      if (request.mode === "navigate") {
        const fallback = await cache.match(new URL("./index.html", self.registration.scope).toString());
        if (fallback) return fallback;
      }
      return Response.error();
    }
  })());
});
