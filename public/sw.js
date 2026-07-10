// ONIQ minimal service worker — same-origin GET passthrough only.
// Large POSTs (e.g. Supabase storage uploads) MUST bypass the SW entirely:
// routing streaming/large request bodies through a SW fetch handler is a
// known Chrome failure mode that surfaces as "TypeError: Failed to fetch".
const CACHE = "oniq-shell-v2";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 1. Never intercept non-GET (uploads, RPC, auth, webhooks).
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // 2. Never intercept cross-origin (Supabase storage/functions/rest/realtime,
  //    CDNs, analytics, etc.) — let the browser handle them directly.
  if (url.origin !== self.location.origin) return;

  // 3. Belt-and-braces: even if these ever get proxied same-origin, skip.
  if (
    url.pathname.startsWith("/storage/") ||
    url.pathname.startsWith("/functions/") ||
    url.pathname.startsWith("/rest/") ||
    url.pathname.startsWith("/realtime/")
  ) {
    return;
  }

  // 4. Same-origin GET: network-first, cache as offline fallback only.
  event.respondWith(
    fetch(req).catch(() =>
      caches.match(req).then((r) => r ?? Response.error())
    )
  );
});

// Focus an existing app window (or open one) when the user taps an incoming
// call notification. Best effort — only works while the app is alive in the
// background. Closed-app push requires the native Capacitor build.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/app/chat";
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clientsList) {
        try {
          if ("navigate" in c && c.url && new URL(c.url).pathname !== targetUrl) {
            await c.navigate(targetUrl);
          }
          if ("focus" in c) { await c.focus(); return; }
        } catch { /* try next */ }
      }
      if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
    })()
  );
});

