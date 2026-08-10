/**
 * The native app must never take a Story payment itself.
 *
 * That is a Google Play position, not a preference: a Story is digital content
 * consumed in the app, Play requires Play Billing for that, and ONIQ's answer
 * is that the app does not collect at all — it hands off to the website. The
 * routing decision is therefore the part of this feature with consequences
 * outside the codebase, so it is a pure function and this is what holds it.
 *
 * Every case below is written so that the WRONG answer is the interesting one:
 * an "inline" result on native is a policy violation shipped, and no amount of
 * correct behaviour elsewhere compensates for it.
 */
import { describe, expect, it } from "vitest";
import { type PurchaseConfig, checkoutTarget } from "@/lib/storyCheckout";

const LIVE: PurchaseConfig = {
  purchaseEnabled: true,
  nativeLinkOut: true,
  checkoutUrl: "https://oniqhub.com/pay/story",
};

describe("where a Story payment is allowed to happen", () => {
  it("never returns inline on native, under any configuration", () => {
    // The exhaustive version, because this is the assertion that matters. Every
    // combination of the two switches and a good/bad URL — none of them may
    // produce an in-app checkout.
    for (const purchaseEnabled of [true, false]) {
      for (const nativeLinkOut of [true, false]) {
        for (const checkoutUrl of [
          "https://oniqhub.com/pay/story",
          "http://oniqhub.com/pay/story",
          "",
          null,
        ]) {
          const target = checkoutTarget({ purchaseEnabled, nativeLinkOut, checkoutUrl }, true, 60);
          expect(
            target.where,
            `native checkout went inline with ${JSON.stringify({ purchaseEnabled, nativeLinkOut, checkoutUrl })}`,
          ).not.toBe("inline");
        }
      }
    }
  });

  it("sends native to the website, carrying the length asked for", () => {
    const target = checkoutTarget(LIVE, true, 120);
    expect(target).toEqual({
      where: "browser",
      url: "https://oniqhub.com/pay/story?seconds=120",
    });
  });

  it("pays inline on the web, which is the whole point of collecting there", () => {
    expect(checkoutTarget(LIVE, false, 60)).toEqual({ where: "inline" });
  });
});

describe("the switches actually switch", () => {
  it("offers nothing on native once the link-out is turned off", () => {
    // The reader-app posture. This is the row that gets flipped if Play
    // objects, and flipping it must not need an app release — so the ONLY thing
    // that changes is what the app offers. The web path below is untouched.
    const off = { ...LIVE, nativeLinkOut: false };
    expect(checkoutTarget(off, true, 60).where).toBe("unavailable");
    expect(checkoutTarget(off, false, 60).where).toBe("inline");
  });

  it("stops selling everywhere when purchases are paused", () => {
    const paused = { ...LIVE, purchaseEnabled: false };
    expect(checkoutTarget(paused, true, 60).where).toBe("unavailable");
    expect(checkoutTarget(paused, false, 60).where).toBe("unavailable");
  });

  it("refuses a checkout URL that is not https", () => {
    // A mutable redirect target read by the client is a phishing primitive if
    // it is ever writable by the wrong role. The database has a CHECK; this is
    // the second half of that, because a client should not open whatever it is
    // handed either.
    expect(checkoutTarget({ ...LIVE, checkoutUrl: "http://evil.test" }, true, 60).where).toBe(
      "unavailable",
    );
    expect(checkoutTarget({ ...LIVE, checkoutUrl: "javascript:alert(1)" }, true, 60).where).toBe(
      "unavailable",
    );
  });

  it("says where to buy instead of failing silently", () => {
    // "Unavailable" with no explanation reads as a bug and generates support
    // mail. The product still exists; it is just somewhere else.
    const target = checkoutTarget({ ...LIVE, nativeLinkOut: false }, true, 60);
    expect(target.where === "unavailable" && target.reason).toMatch(/oniqhub\.com/);
  });
});
