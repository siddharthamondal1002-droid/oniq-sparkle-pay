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
    expect(WEBPUSH).toContain("existing.options?.applicationServerKey");
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
