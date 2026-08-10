/**
 * checkoutTarget is the client half of the Play-policy line, and it is pure so
 * this file can hold its whole truth table. The stakes of each row are not
 * symmetric: a wrong "in-page" on native is a POLICY VIOLATION collecting real
 * money in the app, a wrong "none" is a missed sale. Every ambiguous input
 * below therefore resolves toward "none".
 */
import { describe, expect, it } from "vitest";
import { checkoutTarget, formatPaise, PRICE_TIERS } from "@/lib/storyPricing";

const selling = {
  purchaseEnabled: true,
  nativeLinkOut: true,
  checkoutUrl: "https://oniqhub.com/pay/story",
};

describe("checkoutTarget draws the policy line per surface", () => {
  it("lets a web page collect in place", () => {
    expect(checkoutTarget(selling, false)).toEqual({ kind: "in-page" });
  });

  it("sends the native app to the system browser, marked as a handoff", () => {
    expect(checkoutTarget(selling, true)).toEqual({
      kind: "link-out",
      url: "https://oniqhub.com/pay/story?from=app",
    });
  });

  it("appends rather than clobbers when the checkout URL already has a query", () => {
    const t = checkoutTarget(
      { ...selling, checkoutUrl: "https://oniqhub.com/pay/story?x=1" },
      true,
    );
    expect(t).toEqual({ kind: "link-out", url: "https://oniqhub.com/pay/story?x=1&from=app" });
  });

  it("shows the reader-app posture when the link-out row is off", () => {
    // The one-row Play response: the website keeps selling, the app stops
    // mentioning it. No button, not a disabled button.
    expect(checkoutTarget({ ...selling, nativeLinkOut: false }, true)).toEqual({ kind: "none" });
    // And the row governs only the NATIVE surface — the web keeps collecting.
    expect(checkoutTarget({ ...selling, nativeLinkOut: false }, false)).toEqual({
      kind: "in-page",
    });
  });

  it("offers nothing anywhere when purchasing is switched off", () => {
    expect(checkoutTarget({ ...selling, purchaseEnabled: false }, false)).toEqual({ kind: "none" });
    expect(checkoutTarget({ ...selling, purchaseEnabled: false }, true)).toEqual({ kind: "none" });
  });

  it("refuses to link out to anything that is not https", () => {
    // The checkout URL is a mutable row read by the client. If it ever holds
    // something other than an https URL, the safe failure is no button — not a
    // navigation to whatever got written there.
    for (const url of ["http://oniqhub.com/pay/story", "javascript:alert(1)", "", null]) {
      expect(checkoutTarget({ ...selling, checkoutUrl: url }, true)).toEqual({ kind: "none" });
    }
  });
});

describe("formatPaise shows the chart's own numbers", () => {
  it("formats whole-rupee tiers without invented paise", () => {
    // ₹49, not ₹49.00 — the fraction would read as precision the chart does
    // not have. The i18n fence owns the symbol and grouping; what this pins is
    // the amount surviving the paise→rupee conversion for every real tier.
    for (const t of PRICE_TIERS) {
      const shown = formatPaise(t.pricePaise, t.currency);
      expect(shown).toContain(String(t.pricePaise / 100));
      expect(shown).not.toMatch(/\.00/);
    }
  });
});
