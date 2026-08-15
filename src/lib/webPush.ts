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

/**
 * Which VAPID key this browser says it subscribed with.
 *
 * `options.applicationServerKey` is the browser's own record and the engines
 * do not agree on it: some report null even when a key was supplied. That is
 * the one gap left in the rotation guard — no readable value means no
 * comparison, which means a rotated key is never noticed on that engine.
 */
function keyFromBrowser(sub: PushSubscription): string | null {
  return bufToB64url(sub.options?.applicationServerKey ?? null);
}

/**
 * Which VAPID key WE recorded when we stored this subscription.
 *
 * The row is written by persist() below, so this answer exists on every
 * engine regardless of what `options` exposes.
 *
 * THREE ANSWERS, NOT TWO. This returned `string | null` and folded three
 * different situations into that null: no key recorded (a row written before
 * 2026-08-15), no row at all, and THE READ FAILED. The first two mean "there
 * is nothing here"; the third means "we do not know", and a caller that
 * cannot tell them apart will happily overwrite a record it merely failed to
 * read. postgrest-js resolves rather than throws on an error, so the `catch`
 * around it was close to dead code and the failure arrived disguised as an
 * empty answer — the quiet kind.
 */
type RecordedKey =
  | { state: "recorded"; key: string }
  /** Row read cleanly; there is no key on it. */
  | { state: "absent" }
  /** The read did not complete. Says nothing about what is stored. */
  | { state: "unreadable" };

async function keyFromRow(endpoint: string): Promise<RecordedKey> {
  try {
    const { data, error } = await supabase
      .from("device_tokens")
      .select("keys")
      .eq("token", endpoint)
      .maybeSingle();
    if (error) return { state: "unreadable" };
    const keys = data?.keys as { appServerKey?: string } | null | undefined;
    return typeof keys?.appServerKey === "string"
      ? { state: "recorded", key: keys.appServerKey }
      : { state: "absent" };
  } catch {
    return { state: "unreadable" };
  }
}

async function persist(sub: PushSubscription, appServerKey: string | null): Promise<boolean> {
  const json = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> };
  const p256dh = bufToB64url(sub.getKey("p256dh")) ?? json.keys?.p256dh;
  const auth = bufToB64url(sub.getKey("auth")) ?? json.keys?.auth;
  if (!sub.endpoint || !p256dh || !auth) return false;

  // The upsert REPLACES `keys` wholesale, so writing without an appServerKey
  // would erase one already recorded — turning a row we could reason about
  // into one we cannot.
  let recorded = appServerKey;
  if (!recorded) {
    const known = await keyFromRow(sub.endpoint);
    if (known.state === "unreadable") {
      // WE KNOW NOTHING NEW AND CANNOT SEE WHAT IS THERE, so we write nothing.
      // The only thing this call would add is a fresher `updated_at`, and
      // that is not worth risking the erasure of a binding record we merely
      // failed to read. The subscription itself is untouched and the next app
      // start tries again against a working connection.
      // eslint-disable-next-line no-console
      console.warn("web push: could not read the stored key, leaving the row alone");
      return true;
    }
    if (known.state === "recorded") recorded = known.key;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase.from("device_tokens").upsert(
    {
      user_id: user.id,
      token: sub.endpoint,
      platform: "web",
      // appServerKey RIDES ALONG so the rotation check never has to ask the
      // browser. It is the public half — the same value push-key hands to
      // anyone who asks — so it is not key material and needs no protection
      // beyond the row's own RLS. Recorded here and nowhere else, because the
      // only moment we know it for certain is the moment we subscribe with it.
      keys: recorded ? { p256dh, auth, appServerKey: recorded } : { p256dh, auth },
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
      // OUR RECORD FIRST, THE BROWSER'S SECOND. `options.applicationServerKey`
      // is the browser's memory of what it was handed, and engines disagree
      // about whether to expose it — some return null even when a key was
      // supplied, which left the comparison unable to run and the rotation
      // unnoticed on those engines forever. The row we wrote ourselves has no
      // such variation. The browser stays as the fallback for rows written
      // before this was recorded.
      const known = await keyFromRow(existing.endpoint);
      const boundTo = known.state === "recorded" ? known.key : keyFromBrowser(existing);
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
        //
        // ONLY WHAT WE ACTUALLY KNOW. This passed `key ?? boundTo`, meaning
        // that when the binding was UNKNOWN — no recorded row and an engine
        // that reports options.applicationServerKey as null — it wrote the
        // LIVE key as though the subscription had been minted with it. A
        // fabricated record, and a self-sealing one: every later comparison
        // reads it back, sees a match, and can never detect the rotation it
        // was invented across. Precisely the engines this change exists to
        // help would have been left worse off than before it.
        //
        // `boundTo` is null exactly when we do not know, and recording
        // nothing is the honest answer to that. Where boundTo IS known this
        // branch was reached because it equals `key`, so the legitimate
        // backfill is untouched.
        return (await persist(existing, boundTo)) ? "granted" : "error";
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
    // `key` is what we just subscribed with, so it is recorded as fact rather
    // than read back from a browser that may not report it.
    return (await persist(sub, key)) ? "granted" : "error";
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
