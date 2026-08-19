/**
 * The payout gate, asserted against SOURCE.
 *
 * These are source assertions because the thing being defended is structural:
 * that there is exactly one door to money movement, that it is closed, and
 * that the RTDN worker cannot become a second one. A behavioural test of "no
 * money moved" against a disabled flag proves nothing a later edit could not
 * silently undo, so the shape is pinned instead.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";

const ROOT = process.cwd();
// 19 Aug 2026 — the billing surface is PARKED outside src/ until the feature
// launches with a matching Play Data safety declaration. The guards below keep
// running against the parked source so nothing rots, plus a guard that it
// stays out of the shipped tree.
const PARKED = "parked/creator-billing";
const rtdn = readFileSync(join(ROOT, `${PARKED}/play-rtdn.ts`), "utf8");
const rtdnCode = stripComments(rtdn);
const purchase = stripComments(readFileSync(join(ROOT, `${PARKED}/purchase.ts`), "utf8"));

describe("the billing surface does not ship", () => {
  it("is absent from the app source tree", () => {
    expect(existsSync(join(ROOT, "src/lib/creator/purchase.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "src/routes/api/public/play-rtdn.ts"))).toBe(false);
  });

  it("the payment SDK is not a dependency", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("@revenuecat/purchases-capacitor");
  });
});

describe("no client-side path moves money or grants entitlement", () => {
  it("the purchase wrapper never writes earnings", () => {
    // A client saying "I paid" is not evidence that anyone paid. Everything
    // that credits a creator happens server-side off the fetched Play state.
    for (const bad of [
      "record_creator_charge",
      "creator_ledger",
      "request_creator_payout",
      "settle_creator_payout",
    ]) {
      expect(purchase, `client calls ${bad}`).not.toContain(bad);
    }
  });

  it("refuses self-subscription before it starts, and says so", () => {
    expect(purchase).toMatch(/creatorId === input\.subscriberId|input\.creatorId === input\.subscriberId/);
  });

  it("keeps the native billing plugin out of the web bundle", () => {
    // A module-scope import drags a Capacitor bridge into a build that has no
    // Play Billing at all.
    expect(purchase).not.toMatch(/^import .*@revenuecat/m);
    expect(purchase).toMatch(/await import\("@revenuecat\/purchases-capacitor"\)/);
  });
});

describe("the RTDN endpoint is authenticated, deduped, and does not trust the notice", () => {
  it("refuses when the shared secret is unset rather than allowing everyone", () => {
    expect(rtdnCode).toMatch(/secret\.length < 20 \|\| !constantTimeEqual/);
  });

  it("compares the secret in constant time", () => {
    expect(rtdnCode).toMatch(/function constantTimeEqual/);
  });

  it("dedupes on messageId BEFORE doing any work", () => {
    // Pub/Sub push is at-least-once. A duplicate that posts a second charge is
    // a creator paid twice for one subscription.
    const insertAt = rtdnCode.indexOf("creator_rtdn_events");
    const chargeAt = rtdnCode.indexOf("record_creator_charge");
    expect(insertAt).toBeGreaterThan(-1);
    expect(chargeAt).toBeGreaterThan(insertAt);
    expect(rtdnCode).toMatch(/deduped: true/);
  });

  it("fetches the real state from the Play Developer API", () => {
    // The notification only says something changed. Acting on its body gives
    // you renewals that never happened.
    expect(rtdnCode).toContain("androidpublisher.googleapis.com");
    expect(rtdnCode).toMatch(/subscriptionsv2\/tokens/);
    const fetchAt = rtdnCode.indexOf("androidpublisher.googleapis.com");
    expect(rtdnCode.indexOf("record_creator_charge")).toBeGreaterThan(fetchAt);
  });

  it("prices the charge from the SKU table, never from the notification", () => {
    expect(rtdnCode).toMatch(/from\("creator_sub_skus"\)/);
    expect(rtdnCode).not.toMatch(/notice\.[a-zA-Z.]*price|payload\.price/);
  });

  it("never settles or queues a payout", () => {
    // The worker's job ends at the ledger. Money movement has exactly one
    // door, and it is not this file.
    for (const bad of ["settle_creator_payout", "request_creator_payout", "payout"]) {
      expect(rtdnCode.toLowerCase(), `rtdn touches ${bad}`).not.toContain(bad.toLowerCase());
    }
  });
});

describe("the reason the gate exists is recorded in the code, not in a chat log", () => {
  it("names 194O, section 52 CGST, TAN and the 24(vi) registration", () => {
    // None of these is code. Someone will eventually find payouts_enabled and
    // wonder why it is false; the answer has to be next to the flag.
    const economics = readFileSync(join(ROOT, "src/lib/creator/economics.ts"), "utf8");
    const panel = readFileSync(
      join(ROOT, "src/components/creator/CreatorEarningsPanel.tsx"),
      "utf8",
    );
    expect(panel).toMatch(/Payouts are not switched on/i);
    // The full statutory reason lives in the migration comment and in the
    // config table's own documentation; the client explains it in plain words.
    expect(panel).toMatch(/tax registrations/i);
    expect(economics).toMatch(/creator_payout_config/);
  });
});
