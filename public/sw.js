// ONIQ minimal service worker — network-first passthrough.
// Live-data app: do NOT cache /app routes or API calls; only shell essentials.
const CACHE = "oniq-shell-v1";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((r) => r || Response.error()))
  );
});
