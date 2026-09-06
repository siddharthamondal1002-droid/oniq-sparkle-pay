/**
 * THE PREFERRED-APP SHORTCUT MUST NOT COST A MERCHANT PAYMENT.
 *
 * Skipping Android's chooser means rewriting `upi://pay?…` to `tez://upi/pay?…`
 * before launch. Everything that makes a merchant payment valid — mc, tr, tid,
 * mode, orgid, sign — lives in the QUERY, and a UPI app declines a merchant
 * payment that arrives without them as unverified P2P. So the only safe
 * transformation is a PREFIX swap, and that is what these pin: the query the
 * shop printed comes out the other side character for character.
 *
 * The round trip that proves the query is correct in the first place is in
 * src/lib/qr/__tests__/upiRoundTrip.test.ts. This file proves retargeting does
 * not then undo it.
 */
import { describe, expect, it } from "vitest";
import {
  genericUpiUri,
  isUpiAppId,
  amendUpiUri,
  isMerchantUpiUri,
  orderedPayApps,
  retargetUpiUri,
  UPI_APP_IDS,
  type UpiAppId,
} from "@/lib/upiPreference";

const MERCHANT =
  "upi://pay?pa=store@ybl&pn=Kirana%20Store&am=1200.00&cu=INR&tn=Order%20882" +
  "&mc=5411&tr=TXN1234567890&tid=TID998877&mode=02&orgid=159753&sign=MEUCIQDabc123";

const query = (uri: string) => uri.slice(uri.indexOf("?") + 1);

describe("retargeting keeps the payment identical", () => {
  it.each(UPI_APP_IDS)("%s gets the merchant query character for character", (app) => {
    const out = retargetUpiUri(MERCHANT, app);
    expect(query(out)).toBe(query(MERCHANT));
    expect(out).not.toBe(MERCHANT); // the scheme really did change
  });

  it("every unmodelled merchant field survives", () => {
    for (const app of UPI_APP_IDS) {
      const out = retargetUpiUri(MERCHANT, app);
      for (const f of ["mc=5411", "tr=TXN1234567890", "tid=TID998877", "mode=02", "sign=MEUCIQDabc123"]) {
        expect(out).toContain(f);
      }
    }
  });

  it("targets the scheme each app actually registers", () => {
    expect(retargetUpiUri(MERCHANT, "gpay").startsWith("tez://upi/pay?")).toBe(true);
    expect(retargetUpiUri(MERCHANT, "phonepe").startsWith("phonepe://pay?")).toBe(true);
    expect(retargetUpiUri(MERCHANT, "paytm").startsWith("paytmmp://pay?")).toBe(true);
  });

  it("round-trips back to the exact generic intent", () => {
    // The uninstalled-app fallback depends on this: the retry must be the same
    // payment, not a reconstruction of it.
    for (const app of UPI_APP_IDS) {
      expect(genericUpiUri(retargetUpiUri(MERCHANT, app))).toBe(MERCHANT);
    }
  });
});

describe("it declines to touch what it does not recognise", () => {
  it("no preference means no rewrite", () => {
    expect(retargetUpiUri(MERCHANT, null)).toBe(MERCHANT);
  });

  it("leaves a non-UPI URI alone", () => {
    for (const uri of ["https://example.com/pay?a=1", "tez://upi/pay?pa=x@y", "nonsense"]) {
      expect(retargetUpiUri(uri, "gpay")).toBe(uri);
    }
  });

  it("a URI with no query is returned unchanged", () => {
    expect(retargetUpiUri("upi://pay", "gpay")).toBe("upi://pay");
    expect(genericUpiUri("upi://pay")).toBe("upi://pay");
  });

  it("genericUpiUri leaves an already-generic intent alone", () => {
    expect(genericUpiUri(MERCHANT)).toBe(MERCHANT);
  });
});

describe("button order is the feature", () => {
  it("with no preference, every app is offered in registry order", () => {
    expect(orderedPayApps(null)).toEqual([...UPI_APP_IDS]);
  });

  it.each(UPI_APP_IDS)("%s leads once it is the last used", (app) => {
    const order = orderedPayApps(app);
    expect(order[0]).toBe(app);
    // and nothing is lost — switching apps must never need a settings screen
    expect([...order].sort()).toEqual([...UPI_APP_IDS].sort());
    expect(new Set(order).size).toBe(UPI_APP_IDS.length);
  });
});

describe("a stored value is validated, never trusted", () => {
  it("accepts only known ids", () => {
    for (const good of UPI_APP_IDS) expect(isUpiAppId(good)).toBe(true);
    for (const bad of ["", "GPAY", "cred", null, undefined, 7, {}]) {
      expect(isUpiAppId(bad)).toBe(false);
    }
  });

  it("an unknown id cannot reach retargeting as a scheme", () => {
    // localStorage is writable by anything running on the origin, so a junk
    // value must degrade to the chooser rather than build a bogus scheme.
    const junk = "evil" as unknown as UpiAppId;
    expect(retargetUpiUri(MERCHANT, isUpiAppId(junk) ? junk : null)).toBe(MERCHANT);
  });
});

/**
 * THE ₹3,300 THAT FAILED — the exact case, pinned.
 *
 * A puja society's SBI collection QR: merchant fields present, NO amount,
 * because the payer is meant to type one. Typing it flipped `rawIntact` false
 * and the launcher fell back to a payee-only link, dropping mc/tr/mode/orgid/
 * sign. The banks saw a P2P payment to a current account and refused it AFTER
 * settlement (UTR 586505577554) with "UPI payments are not allowed on either
 * your account type or the receiver's account type" — a true statement about
 * the account and a badly misleading one about the cause. The same QR pays
 * fine inside PhonePe, which is the control proving the payee was never wrong.
 */
describe("a collection QR survives having its amount typed", () => {
  // Amount-less, merchant-marked — the shape that broke.
  const COLLECTION = "upi://pay?pa=officerws@sbi&pn=OFFICERS%20W%20SOCITY&mc=8398&cu=INR";

  it("is recognised as a merchant, not a person", () => {
    expect(isMerchantUpiUri(COLLECTION)).toBe(true);
    expect(isMerchantUpiUri("upi://pay?pa=friend@okicici&pn=Friend&cu=INR")).toBe(false);
  });

  it("keeps the merchant identity when an amount is typed", () => {
    const out = amendUpiUri(COLLECTION, { am: "3300", tn: "" });
    expect(out).toContain("mc=8398");
    expect(out).toContain("pa=officerws%40sbi");
    expect(out).toContain("am=3300");
  });

  it("REGRESSION: the payee-only fallback is what dropped the merchant", () => {
    // This is what shipped and failed. Kept as the contrast that gives the
    // test above its meaning — without it, "contains mc" proves nothing.
    const payeeOnly = "upi://pay?pa=officerws%40sbi&pn=OFFICERS+W+SOCITY&cu=INR";
    expect(payeeOnly).not.toContain("mc=");
    expect(amendUpiUri(COLLECTION, { am: "3300" })).toContain("mc=");
  });

  it("carries every unmodelled field across an amount edit", () => {
    const full =
      "upi://pay?pa=store@ybl&pn=Store&cu=INR&mc=5411&tr=TXN1&tid=TID2&mode=02&orgid=159753&sign=abc";
    const out = amendUpiUri(full, { am: "250.00", tn: "Order 9" });
    for (const f of ["mc=5411", "tr=TXN1", "tid=TID2", "mode=02", "orgid=159753", "sign=abc"]) {
      expect(out).toContain(f);
    }
    expect(out).toContain("am=250.00");
    expect(out).toContain("tn=Order+9");
  });

  it("clearing the amount removes am rather than sending an empty one", () => {
    const withAmt = amendUpiUri(COLLECTION, { am: "3300" });
    expect(amendUpiUri(withAmt, { am: "" })).not.toContain("am=");
    expect(amendUpiUri(withAmt, { am: "  " })).not.toContain("am=");
  });

  it("leaves a non-UPI string alone", () => {
    expect(amendUpiUri("https://example.com?a=1", { am: "5" })).toBe("https://example.com?a=1");
    expect(isMerchantUpiUri("not a uri")).toBe(false);
  });

  it("an amended merchant URI still retargets to a named app intact", () => {
    const amended = amendUpiUri(COLLECTION, { am: "3300" });
    const gpay = retargetUpiUri(amended, "gpay");
    expect(gpay.startsWith("tez://upi/pay?")).toBe(true);
    expect(gpay).toContain("mc=8398");
    expect(gpay).toContain("am=3300");
  });
});
