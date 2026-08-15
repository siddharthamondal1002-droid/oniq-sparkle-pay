/**
 * A ROTATED VAPID KEY MUST NOT LEAVE BROWSERS SUBSCRIBED TO THE OLD ONE.
 *
 * subscribeWebPush() reused any existing subscription unconditionally:
 *
 *     const existing = await reg.pushManager.getSubscription();
 *     if (existing) return (await persist(existing)) ? "granted" : "error";
 *
 * Correct while there is only ever one VAPID key, and wrong the moment one is
 * rotated. A subscription is cryptographically bound to the applicationServerKey
 * it was created with, so after a rotation the browser still holds an address
 * minted under the OLD key. That line re-saved it, returned "granted", and every
 * push to it failed with 403 VapidPkHashMismatch.
 *
 * 403 IS NOT 404/410, so sendWebPush does not mark it `gone` and send-push never
 * wipes the row. The result is a dead address re-confirmed as healthy on every
 * app start, failing on every send, forever, with nothing logged anywhere.
 *
 * Measured 2026-08-15 while rotating the key after it leaked into a third-party
 * log: both live web subscriptions would have gone silently undeliverable.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const WEBPUSH = read("src/lib/webPush.ts");
const SW = read("public/sw.js");
const SEND = read("supabase/functions/send-push/index.ts");
const SHARED = read("supabase/functions/_shared/webpush.ts");

describe("subscribeWebPush after a key rotation", () => {
  it("compares the existing subscription against the live key", () => {
    // The browser's own memory is still read — as the FALLBACK, inside
    // keyFromBrowser. Our recorded row is preferred; see the recorded-key
    // block at the bottom of this file.
    expect(WEBPUSH).toContain("sub.options?.applicationServerKey");
    expect(WEBPUSH).toContain("boundTo !== key");
  });

  it("no longer reuses whatever subscription happens to be there", () => {
    expect(
      /const existing = await reg\.pushManager\.getSubscription\(\);\s*\n\s*if \(existing\) return/.test(
        WEBPUSH,
      ),
      "back to unconditional reuse — a rotated key would go undetected forever",
    ).toBe(false);
  });

  it("unsubscribes and clears the stale row before re-subscribing", () => {
    // The replacement subscription gets a DIFFERENT endpoint, so leaving the
    // old row behind converts one dead address into two.
    const block = WEBPUSH.slice(WEBPUSH.indexOf("boundTo !== key"));
    expect(block).toContain("existing.unsubscribe()");
    expect(block).toContain('.delete().eq("token", existing.endpoint)');
  });

  it("keeps the subscription when it cannot prove a mismatch", () => {
    // A failed key fetch must not destroy a working address. The guard is
    // `key && boundTo && ...` — both values present before replacing anything.
    expect(WEBPUSH).toMatch(/if \(key && boundTo && boundTo !== key\)/);
  });

  /**
   * A CACHED PUBLIC KEY DEFEATS THE COMPARISON ENTIRELY.
   *
   * vapidPublicKey() memoised its answer in a module-scope variable with no
   * expiry and nothing anywhere in the app that invalidated it. A tab open
   * across a rotation kept serving the OLD key out of memory, so the guard
   * above compared old against old, found them equal, and re-persisted a
   * subscription that was already dead — returning "granted". A pinned tab
   * stays broken indefinitely; a sign-out/sign-in in that tab mints a brand
   * new row that was never deliverable.
   *
   * Found by audit after the guard shipped, which is the point worth keeping:
   * the guard was correct and the thing it depended on was not.
   */
  it("does not memoise the key it is about to compare against", () => {
    expect(
      /let cachedKey/.test(WEBPUSH),
      "the module-scope key cache is back — a long-open tab will never notice a rotation",
    ).toBe(false);
    expect(WEBPUSH).not.toContain("if (cachedKey) return cachedKey");
  });

  it("fetches the key before deciding, not only when subscribing fresh", () => {
    const keyAt = WEBPUSH.indexOf("const key = await vapidPublicKey();");
    const existingAt = WEBPUSH.indexOf("const existing = await reg.pushManager.getSubscription();");
    expect(keyAt).toBeGreaterThan(-1);
    expect(keyAt, "the comparison cannot run before the key is known").toBeLessThan(existingAt);
  });
});

describe("the failure this guards against stays un-self-healing", () => {
  it("still treats only 404/410 as gone", () => {
    // If this ever widens to 403, the rows WOULD be cleaned up and half the
    // reasoning above changes. Pinned so the two are considered together.
    expect(SHARED).toMatch(/404|410/);
    expect(
      /status === 403[\s\S]{0,80}gone/.test(SHARED),
      "403 now counts as gone — revisit the rotation story, it may self-heal now",
    ).toBe(false);
  });

  it("keeps a web transport that a rotation can break at all", () => {
    // Sanity that this test is still pointed at something real.
    expect(SEND).toContain('platform === "web"');
  });
});

describe("the service worker's own recovery path", () => {
  it("still re-subscribes, and says why that is not the rotation fix", () => {
    // A service worker cannot reach push-key without the app's credentials, so
    // it reuses the key it has. That is right for a browser-initiated change
    // and wrong after a rotation — which the page corrects on next start.
    expect(SW).toContain("pushsubscriptionchange");
    expect(SW).toContain("subscribeWebPush() compares");
  });
});

/**
 * THE COMPARISON NOW READS OUR OWN RECORD, NOT THE BROWSER'S MEMORY.
 *
 * `options.applicationServerKey` is what the browser remembers being handed,
 * and engines disagree about exposing it — some report null even when a key
 * was supplied. On those the comparison could not run at all, so a rotation
 * went unnoticed forever: the one silent case the guard could not reach.
 *
 * The key is now written into `device_tokens.keys.appServerKey` at subscribe
 * time, where we know it for certain. `keys` is already jsonb, so there is no
 * migration and no new column. The browser stays as the fallback, for rows
 * written before this existed.
 */
describe("the recorded subscribe key", () => {
  it("is stored on the row at subscribe time", () => {
    expect(WEBPUSH).toContain("appServerKey");
    expect(WEBPUSH).toContain(
      "keys: appServerKey ? { p256dh, auth, appServerKey } : { p256dh, auth }",
    );
  });

  it("is preferred over the browser's own memory", () => {
    expect(WEBPUSH).toContain("(await keyFromRow(existing.endpoint)) ?? keyFromBrowser(existing)");
  });

  it("backfills a row that predates it, without waiting for a rotation", () => {
    // persist() is called with the live key on the match path too, so an old
    // row gains its appServerKey on the next app start it survives.
    expect(WEBPUSH).toContain("persist(existing, key ?? boundTo)");
  });

  it("stores only the PUBLIC half — push-key hands this to anyone", () => {
    // A guard against someone later "improving" this into storing the JWK.
    expect(WEBPUSH).not.toMatch(/keys:[^}]*\bd\b\s*:/);
  });
});

describe("send-push refuses a row it can prove is undeliverable", () => {
  it("compares the recorded key against the one it is about to sign with", () => {
    expect(SEND).toContain("const livePublicKey = vapidPublicKey(jwk)");
    expect(SEND).toContain("s.appServerKey && s.appServerKey !== livePublicKey");
  });

  it("treats a missing recorded key as deliverable, not as a fault", () => {
    // Rows written before this existed have no appServerKey. Refusing them
    // would invent a failure out of an absent field.
    expect(SEND).toContain("!s.appServerKey || s.appServerKey === livePublicKey");
  });

  /**
   * The circuit-breaker suppresses cleanup when a whole transport fails
   * identically, because that means a message-level fault. A rotated key is
   * the one total, identical failure that is fully explained — so it must
   * bypass that guard, or the first send after any rotation (when EVERY web
   * row is stale) would refuse to clean up anything.
   */
  it("keeps rotated-key rows out of the circuit-breaker", () => {
    expect(SEND).toContain("rotatedKeyEndpoints");
    const breaker = SEND.slice(SEND.indexOf("const wipedWeb"));
    expect(breaker).toContain("deadEndpoints.length === webAttempted");
    expect(
      /wipedWeb \? \[\] : rotatedKeyEndpoints/.test(SEND),
      "rotated-key rows are suppressed by the breaker — nothing would ever be cleaned after a rotation",
    ).toBe(false);
  });

  it("counts the breaker against rows actually attempted", () => {
    expect(SEND).toContain("webAttempted = deliverable.length");
    expect(
      /deadEndpoints\.length === webSubs\.length/.test(SEND),
      "the breaker counts refused rows as attempted again",
    ).toBe(false);
  });

  it("reports rotated-key rows separately from failures", () => {
    expect(SEND).toContain("rotatedKey: rotatedKeyEndpoints.length");
  });
});
