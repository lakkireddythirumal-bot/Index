const CACHE_NAME = "feed-manager-dashboard-v14";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./records.html"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
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
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Keep the page fresh after GitHub Pages deployments, but retain an offline fallback.
  const isNavigation = request.mode === "navigate" || url.pathname.endsWith("/index.html");
  const isAppAsset = /\.(?:js|css|json|webmanifest)$/i.test(url.pathname);

  if (isNavigation || isAppAsset) {
    event.respondWith(
      networkFirst(request).catch(async () => {
        if (isNavigation) {
          const fallback = await caches.match("./index.html");
          if (fallback) return fallback;
        }
        return new Response("Offline: this resource is not available in the cache.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      })
    );
    return;
  }

  // Other same-origin GET assets use cache-first for fast repeat visits, then network.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)));
        }
        return response;
      });
    })
  );
});
