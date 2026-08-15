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

// ---------------------------------------------------------------------------
// WEB PUSH.
//
// Until 2026-08-14 this file had no `push` listener, which meant the website
// could not be notified of anything once its tab was closed — measured that
// day: 101 accounts, 14 with a push token, and six of the nine people called
// unreachable. `send-push` returned {"sent":0,"failed":0} and nobody saw a
// failure, because there wasn't one. There was simply no receiver.
//
// The payload arrives already decrypted by the browser (RFC 8291); the server
// half lives in supabase/functions/_shared/webpush.ts. Its shape deliberately
// mirrors the FCM data map so both transports say the same words.
// ---------------------------------------------------------------------------
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let d = {};
      try {
        d = event.data ? event.data.json() : {};
      } catch {
        d = {};
      }

      // A cancel is not news — it is the RETRACTION of news. Close the ring
      // and say nothing more; the missed call is already in the call log, and
      // a second notification announcing a call that stopped is noise. This
      // mirrors what OniqMessagingService does natively.
      if (d.kind === "call_cancel") {
        const tag = "call-" + (d.call_id || d.conversation_id || "");
        const open = await self.registration.getNotifications({ tag });
        for (const n of open) n.close();
        return;
      }

      const isCall = d.kind === "call";
      const title = d.title || (isCall ? "Incoming call 📞" : "ONIQ");
      const body = d.body || (isCall ? "Open ONIQ to answer" : "New message");
      // Tagged per call / per conversation so a second push REPLACES the first
      // rather than stacking — five missed-call cards is not five pieces of
      // information.
      const tag = isCall
        ? "call-" + (d.call_id || d.conversation_id || "")
        : "chat-" + (d.conversation_id || "");

      await self.registration.showNotification(title, {
        body,
        tag,
        renotify: isCall,
        requireInteraction: isCall,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        vibrate: isCall ? [400, 200, 400, 200, 400] : [120],
        data: { url: d.url || "/app/chat", call_id: d.call_id, kind: d.kind },
      });
    })()
  );
});

// The push service can retire an endpoint on its own. Re-subscribing here
// keeps the browser reachable; PERSISTING the new endpoint is left to the
// page, which re-registers on every load — a service worker has no Supabase
// session of its own to write with, and inventing one would mean keeping a
// credential in the worker.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        // RE-SUBSCRIBES WITH THE KEY IT ALREADY HAD, which is the only key a
        // service worker can reach without the app's Supabase credentials. If
        // that key has since been rotated the new subscription is dead on
        // arrival — but not permanently: subscribeWebPush() compares every
        // existing subscription's applicationServerKey against the live one on
        // the next app start and replaces it when they differ. This keeps push
        // alive across an ordinary browser-initiated change; the page fixes the
        // rotation case.
        const old = event.oldSubscription || (await self.registration.pushManager.getSubscription());
        const key = old && old.options && old.options.applicationServerKey;
        if (!key) return;
        await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
      } catch {
        /* the next page load re-subscribes from scratch */
      }
    })()
  );
});

// Focus an existing app window (or open one) when the user taps an incoming
// call notification. Works with the tab closed now that web push is wired —
// openWindow starts the app when no client is alive.
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

