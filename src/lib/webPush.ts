/**
 * Web Push subscription — the browser half.
 *
 * WHY. Before 2026-08-14 `initPush()` returned "unavailable" on its first line
 * unless Capacitor reported native, and nothing else in the app ever touched
 * `pushManager`. The website could raise a foreground `Notification` while its
 * tab was open, and that was all: close the tab and a call could not reach
 * you. Measured that day — six of the nine people called had no push address
 * of any kind. This module gives the website one.
 *
 * THE ROW SHAPE IS SHARED WITH FCM ON PURPOSE. A subscription's endpoint is a
 * unique stable string, so it goes in `device_tokens.token` exactly where an
 * FCM token goes, and the key material rides alongside in `keys`. One table,
 * one set of RLS policies, one cleanup path.
 */
import { supabase } from "@/integrations/supabase/client";

export type WebPushResult = "granted" | "denied" | "unsupported" | "error";

/** The VAPID public key, base64url, as `applicationServerKey` wants it. */
function b64urlToUint8(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bufToB64url(b: ArrayBuffer | null): string | null {
  if (!b) return null;
  const bytes = new Uint8Array(b);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function webPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * The server's VAPID public key.
 *
 * Fetched rather than compiled in, because it is DERIVED from the one secret
 * the server holds. Hardcoding a copy here would create a second source of
 * truth that silently stops matching the day the key is rotated — and a
 * mismatch does not error, it just makes every push undeliverable.
 *
 * AND NOT MEMOISED, which is the whole point of the rotation guard below.
 *
 * This used to cache the answer in a module-scope variable with no expiry and
 * no invalidation anywhere in the app. That is a second source of truth
 * wearing a different hat: a tab open across a rotation kept serving the OLD
 * key from memory, the guard compared old against old, concluded nothing had
 * changed, and re-persisted a subscription that was already dead — reporting
 * "granted". A pinned tab could stay broken indefinitely, and a
 * sign-out/sign-in in that same tab would mint a fresh row that was never
 * deliverable.
 *
 * One HTTP call per app start is not a cost worth defending against when the
 * thing being protected is the check that catches a rotated key.
 */
async function vapidPublicKey(): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke("push-key");
    const key = (data as { publicKey?: string } | null)?.publicKey;
    if (error || typeof key !== "string" || key.length < 80) return null;
    return key;
  } catch {
    return null;
  }
}

async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (!existing) await navigator.serviceWorker.register("/sw.js");
    // `ready` resolves only once a worker is active — subscribing against a
    // registration that is still installing throws.
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

async function persist(sub: PushSubscription): Promise<boolean> {
  const json = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> };
  const p256dh = bufToB64url(sub.getKey("p256dh")) ?? json.keys?.p256dh;
  const auth = bufToB64url(sub.getKey("auth")) ?? json.keys?.auth;
  if (!sub.endpoint || !p256dh || !auth) return false;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  // WHY THE CAST. `device_tokens.keys` arrives with the 2026-08-14 web-push
  // migration, and src/integrations/supabase/types.ts is GENERATED — it has
  // not been regenerated, so the column is invisible to TypeScript and the
  // literal gets matched against Array.prototype.keys instead. Narrowed to
  // this one call, exactly as storyJobsClient.ts does for story_jobs, and to
  // be deleted the moment the types catch up. If it outlives that, it is
  // hiding a real name mismatch rather than a timing one.
  const table = supabase.from("device_tokens") as unknown as {
    upsert: (
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ) => Promise<{ error: { message: string } | null }>;
  };
  const { error } = await table.upsert(
    {
      user_id: user.id,
      token: sub.endpoint,
      platform: "web",
      keys: { p256dh, auth },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "token" },
  );
  if (error) {
    // Same shape as the FCM path's failure: usually the row still belongs to
    // the previous account on this browser and RLS refuses the update.
    // eslint-disable-next-line no-console
    console.warn("web push upsert failed:", error.message);
    return false;
  }
  return true;
}

/**
 * Subscribe this browser and store the result.
 *
 * Idempotent WHERE THE KEY STILL MATCHES: an existing subscription is
 * re-persisted rather than replaced, so a returning user keeps the same
 * endpoint and does not accumulate dead rows. Where it does NOT match — the
 * server's VAPID key has been rotated since this browser subscribed — the old
 * subscription is dropped and replaced instead, because re-persisting it would
 * be recording a dead address as healthy. See the comment at the comparison.
 *
 * Permission is only REQUESTED when it has not already been decided — asking
 * again after a refusal is how a browser earns a permanent block.
 */
export async function subscribeWebPush(): Promise<WebPushResult> {
  if (!webPushSupported()) return "unsupported";
  try {
    if (Notification.permission === "denied") return "denied";
    if (Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") return "denied";
    }

    const reg = await readyRegistration();
    if (!reg) return "error";

    const key = await vapidPublicKey();
    const existing = await reg.pushManager.getSubscription();

    if (existing) {
      // A SUBSCRIPTION OUTLIVES THE KEY IT WAS MINTED WITH, AND SAYS NOTHING.
      //
      // "Reuse whatever is there" was right while there was only ever one
      // VAPID key. It is wrong the moment one is rotated: the browser still
      // holds a subscription bound to the OLD public key, this re-saved it,
      // returned "granted", and every push to that endpoint failed with 403
      // VapidPkHashMismatch — which is not 404/410, so sendWebPush does not
      // treat it as gone and the row is never cleaned up either. A dead
      // address, re-confirmed as healthy on every app start, forever.
      //
      // Measured 2026-08-15, rotating the key after it leaked: two live web
      // subscriptions would both have been silently undeliverable from then on.
      const boundTo = bufToB64url(existing.options?.applicationServerKey ?? null);
      if (key && boundTo && boundTo !== key) {
        await existing.unsubscribe().catch(() => undefined);
        // Drop the stale row too. The new subscription gets a DIFFERENT
        // endpoint, so without this the old one lingers as a permanent
        // failure in every send.
        await supabase.from("device_tokens").delete().eq("token", existing.endpoint);
        // fall through and subscribe fresh
      } else {
        // Either it matches, or we could not read one of the two values —
        // and a subscription is not thrown away on a maybe. Losing a working
        // address because the key fetch hit a dead network would be worse
        // than the staleness this guards against.
        return (await persist(existing)) ? "granted" : "error";
      }
    }

    if (!key) return "error";

    const sub = await reg.pushManager.subscribe({
      // Non-negotiable in Chrome: a push that shows nothing is not allowed.
      // The service worker honours it — every kind except call_cancel raises a
      // notification, and a cancel only ever closes one it already showed.
      userVisibleOnly: true,
      applicationServerKey: b64urlToUint8(key) as unknown as BufferSource,
    });
    return (await persist(sub)) ? "granted" : "error";
  } catch {
    return "error";
  }
}

/**
 * Drop this browser's subscription and its row. MUST run BEFORE signOut() —
 * RLS only lets the row's owner delete it, and after sign-out there is no
 * owner. Skipping it leaves the next person to use this browser receiving the
 * previous account's calls.
 */
export async function unsubscribeWebPush(): Promise<void> {
  if (!webPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => undefined);
    await supabase.from("device_tokens").delete().eq("token", endpoint);
  } catch {
    /* best-effort */
  }
}
