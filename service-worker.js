const CACHE_NAME = "taiwan-dark-chess-pwa-learning-r1-20260729-online-imitation";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=learning-r1-20260729-online-imitation",
  "./learning.js?v=learning-r1-20260729-online-imitation",
  "./app.js?v=learning-r1-20260729-online-imitation",
  "./manifest.webmanifest",
  "./icon.svg",
  "./apple-touch-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("taiwan-dark-chess-pwa-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const request = event.request;
  const accept = request.headers.get("accept") || "";
  const isNavigation = request.mode === "navigate" || accept.includes("text/html");

  if (isNavigation) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
  
    event.respondWith(
      fetch(request, {
        cache: "no-store",
        signal: controller.signal
      })
        .then((response) => {
          clearTimeout(timeoutId);
  
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put("./index.html", copy);
          });
  
          return response;
        })
        .catch(() => {
          clearTimeout(timeoutId);
          return caches.match("./index.html");
        })
    );
  
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
      return cached || network.catch(() => caches.match("./index.html"));
    })
  );
});
