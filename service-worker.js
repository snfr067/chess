const CACHE_NAME = "taiwan-dark-chess-pwa-pytorch-onnx-v5-20260817";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=pytorch-onnx-v5-20260817",
  "./vendor/tf.min.js?v=4.22.0",
  "./vendor/ort.min.js?v=1.22.0",
  "./vendor/ort-wasm-simd-threaded.mjs",
  "./vendor/ort-wasm-simd-threaded.wasm",
  "./model-core.js?v=pytorch-onnx-v5-20260817",
  "./pytorch-model-core.js?v=pytorch-onnx-v5-20260817",
  "./base-model.json",
  "./base-model.weights.bin",
  "./learning.js?v=pytorch-onnx-v5-20260817",
  "./app.js?v=pytorch-onnx-v5-20260817",
  "./ai-worker.js?v=pytorch-onnx-v5-20260817",
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
  const url = new URL(request.url);
  const accept = request.headers.get("accept") || "";
  const isNavigation = request.mode === "navigate" || accept.includes("text/html");

  if (url.pathname.endsWith("/final_model.onnx")) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request.url, copy));
          }
          return response;
        })
        .catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(request.url)).then((cached) => (
          cached || new Response("final_model.onnx unavailable", { status: 503 })
        )))
    );
    return;
  }

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
          return caches.open(CACHE_NAME).then((cache) => cache.match("./index.html"));
        })
    );
  
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          cache.put(request, copy);
        }
        return response;
      });
      return cached || network;
    }))
  );
});
