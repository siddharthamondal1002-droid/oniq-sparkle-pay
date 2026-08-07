/**
 * A3 — profile QRs, and the proof that payments are untouched.
 *
 * The loop's guardrail treats decodeQr.ts as the dangerous file because it
 * "sits in front of payments". Having read the code, the danger is narrower
 * and this suite is aimed at what it actually is: a scanned string now has TWO
 * possible meanings, and a UPI string must resolve as UPI every single time,
 * before anything else is tried.
 *
 * The dispatch is therefore tested against the REAL parseUpiUri imported from
 * app.scan.tsx, not a stand-in. A mock would prove the dispatch works against
 * my idea of the UPI rules, which is exactly the thing that could be wrong.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROFILE_QR_ORIGIN,
  parseProfileQr,
  profileQrUrl,
  resolveScannedCode,
} from "@/lib/qr/oniqProfileQr";
import { parseUpiUri } from "@/routes/_authenticated/app.scan";
import { stripComments } from "@/test/sourceText";

/** The real thing, so the dispatch is tested against production UPI rules. */
const isUpi = (s: string) => parseUpiUri(s) !== null;

const TOKEN = "Ab3xY7zQ9pL2mN4kR6tW1s";

/** Real-shaped UPI strings, including the merchant fields that must survive. */
const UPI_CODES = [
  "upi://pay?pa=merchant@okhdfcbank&pn=Chai%20Point&am=45.00&cu=INR",
  "upi://pay?pa=someone@paytm",
  "upi://pay?pa=store@ybl&pn=Store&am=1200&tn=Order%20882&mc=5411&tr=TXN1234&mode=02&sign=abc",
  "UPI://PAY?pa=caps@okaxis&pn=Caps",
  "  upi://pay?pa=padded@okicici&am=10  ",
];

describe("every UPI string still resolves as UPI, first", () => {
  it("resolves each one as a payment, never as a profile", () => {
    for (const code of UPI_CODES) {
      const r = resolveScannedCode(code, isUpi);
      expect(r.kind, `${code} did not resolve as UPI`).toBe("upi");
    }
  });

  it("the real parser still extracts payee and amount unchanged", () => {
    // Payee and amount confirmation is the part a user reads before money
    // moves. If A3 changed it, this is where that shows up.
    const p = parseUpiUri("upi://pay?pa=merchant@okhdfcbank&pn=Chai%20Point&am=45.00&cu=INR");
    expect(p).not.toBeNull();
    expect(p!.pa).toBe("merchant@okhdfcbank");
    expect(p!.pn).toBe("Chai Point");
    expect(p!.am).toBe("45.00");
  });

  it("still carries the untouched raw URI, which merchant QRs depend on", () => {
    // Merchant codes include mc/tr/mode/sign that ONIQ does not model. Drop
    // them and UPI apps flag the payment as unverified P2P and decline it.
    const raw = "upi://pay?pa=store@ybl&pn=Store&am=1200&mc=5411&tr=TXN1234&mode=02&sign=abc";
    const p = parseUpiUri(raw);
    expect(p!.raw).toBe(raw);
    expect(p!.raw).toContain("sign=abc");
    expect(p!.raw).toContain("mc=5411");
  });

  it("a profile QR never parses as UPI", () => {
    expect(parseUpiUri(profileQrUrl(TOKEN))).toBeNull();
  });

  it("the two formats cannot collide, by construction", () => {
    // UPI requires the literal upi:// scheme; profile QRs are https on ONIQ's
    // own origin. There is no string that satisfies both.
    expect(profileQrUrl(TOKEN).startsWith("https://")).toBe(true);
    expect(profileQrUrl(TOKEN).toLowerCase()).not.toContain("upi://");
  });
});

describe("profile QRs parse strictly", () => {
  it("round-trips a valid token", () => {
    const url = profileQrUrl(TOKEN);
    expect(parseProfileQr(url)).toEqual({ token: TOKEN, url });
  });

  it("tolerates surrounding whitespace from a scanner", () => {
    expect(parseProfileQr(`  ${profileQrUrl(TOKEN)}  `)?.token).toBe(TOKEN);
  });

  it("rejects another host that merely starts like ours", () => {
    // The nastiest case: a prefix check alone passes this, and the parsed
    // host is somewhere else entirely.
    for (const bad of [
      "https://oniqhub.com.evil.test/u/" + TOKEN,
      "https://evil.test/u/" + TOKEN,
      "https://oniqhub.com@evil.test/u/" + TOKEN,
    ]) {
      expect(parseProfileQr(bad), bad).toBeNull();
    }
  });

  it("rejects http, since a downgrade is not ours", () => {
    expect(parseProfileQr(`http://oniqhub.com/u/${TOKEN}`)).toBeNull();
  });

  it("rejects extra path segments", () => {
    expect(parseProfileQr(`${PROFILE_QR_ORIGIN}/u/${TOKEN}/extra`)).toBeNull();
    expect(parseProfileQr(`${PROFILE_QR_ORIGIN}/x/${TOKEN}`)).toBeNull();
    expect(parseProfileQr(`${PROFILE_QR_ORIGIN}/u/`)).toBeNull();
  });

  it("rejects a token outside the charset or length", () => {
    for (const bad of ["short", "has spaces here now", "has/slash/inside", "a".repeat(65)]) {
      expect(parseProfileQr(`${PROFILE_QR_ORIGIN}/u/${encodeURIComponent(bad)}`), bad).toBeNull();
    }
  });

  it("refuses to BUILD a url from a bad token", () => {
    // Fail where the mistake is made, not where the QR is scanned.
    for (const bad of ["", "short", "has space", "x".repeat(65)]) {
      expect(() => profileQrUrl(bad), bad).toThrow();
    }
  });

  it("survives hostile and empty input without throwing", () => {
    for (const bad of ["", "   ", "not a url", "javascript:alert(1)", "://", "https://"]) {
      expect(() => parseProfileQr(bad)).not.toThrow();
      expect(parseProfileQr(bad), bad).toBeNull();
    }
  });
});

describe("the dispatch order is the safety property", () => {
  it("asks the payment question first, even about a profile QR", () => {
    // THE test for the ordering, and it took two attempts to write one that
    // actually detects a swap.
    //
    // The obvious version — feed it a UPI string and check isUpi was called —
    // passes with the branches in EITHER order, because parseProfileQr
    // correctly rejects "upi://..." and the dispatch simply falls through to
    // the payment branch. It observes that isUpi ran, not that it ran first.
    //
    // Feeding it a PROFILE QR is decisive. UPI-first means isUpi is consulted
    // about it before the profile branch is reached. Profile-first means the
    // function returns before isUpi is ever called. So a single call count
    // separates the two orders with no ambiguity.
    let asked = 0;
    const r = resolveScannedCode(profileQrUrl(TOKEN), (s) => {
      asked += 1;
      return parseUpiUri(s) !== null;
    });
    expect(asked, "the payment branch was skipped — dispatch order is wrong").toBe(1);
    expect(r.kind).toBe("oniq-profile");
  });

  it("returns immediately on a UPI match, without consulting the profile parser", () => {
    // The other direction: a UPI string must not reach the profile branch at
    // all. Observable because parseProfileQr is pure — if it had run, the
    // result would still be upi, so this pins the outcome while the count
    // above pins the order.
    expect(resolveScannedCode(UPI_CODES[0], isUpi).kind).toBe("upi");
  });

  it("falls through to profile, then to unknown", () => {
    expect(resolveScannedCode(profileQrUrl(TOKEN), isUpi).kind).toBe("oniq-profile");
    expect(resolveScannedCode("https://example.com/hello", isUpi).kind).toBe("unknown");
    expect(resolveScannedCode("", isUpi).kind).toBe("unknown");
  });

  it("hands unknown content back untouched for the caller to explain", () => {
    const r = resolveScannedCode("some random text", isUpi);
    expect(r.kind).toBe("unknown");
    expect(r.raw).toBe("some random text");
  });
});

describe("nothing on the payment path was modified", () => {
  const ROOT = process.cwd();

  it("decodeQr.ts still knows nothing about any format", () => {
    // The loop budgeted for editing this file. It turned out not to need it:
    // it converts an image to a string and never inspects the string. If a
    // format ever leaks in here, the separation this feature relies on is
    // gone.
    const decode = readFileSync(join(ROOT, "src/lib/qr/decodeQr.ts"), "utf8");
    for (const bad of ["upi:", "oniqhub", "parseUpi", "profileQr", "/u/"]) {
      expect(decode, `decodeQr.ts now references ${bad}`).not.toContain(bad);
    }
  });

  it("parseUpiUri still guards on the exact upi://pay? prefix", () => {
    const scan = readFileSync(join(ROOT, "src/routes/_authenticated/app.scan.tsx"), "utf8");
    expect(scan).toMatch(/\^upi:\\\/\\\/pay\\\?/);
  });

  it("parseUpiUri still validates the VPA before returning", () => {
    expect(parseUpiUri("upi://pay?pa=not-a-vpa")).toBeNull();
    expect(parseUpiUri("upi://pay?pn=NoPayee&am=10")).toBeNull();
  });

  it("the profile module never imports the payment module", () => {
    // isUpi is injected precisely so this stays true — one direction of
    // dependency, and no second copy of the UPI rules to drift.
    //
    // Checked against CODE, not prose. The module's header comment has to be
    // able to say "this deliberately does not import parseUpiUri" — explaining
    // the constraint is not violating it, and the first draft of this
    // assertion failed on exactly that sentence.
    // stripComments, NOT executableText: an import specifier is a string
    // literal, and executableText blanks string contents — which would make
    // the path assertion below pass no matter what the file imported.
    const code = stripComments(readFileSync(join(ROOT, "src/lib/qr/oniqProfileQr.ts"), "utf8"));
    expect(code).not.toMatch(/from "@\/routes\/_authenticated\/app\.scan"/);
    expect(code).not.toMatch(/parseUpiUri|upiLink|isValidVpa/);
  });

  it("that check would still catch a real import", () => {
    // Stripping comments is only safe if a genuine import still trips it.
    // Without this, the assertion above could quietly be a way of never
    // failing — which is exactly what it was on the first attempt.
    const fake = [
      "// we deliberately do not import parseUpiUri",
      `import { parseUpiUri } from "@/routes/_authenticated/app.scan";`,
    ].join("\n");
    const code = stripComments(fake);
    expect(code).toMatch(/parseUpiUri/);
    expect(code).toMatch(/from "@\/routes\/_authenticated\/app\.scan"/);
    // ...and the comment alone is not enough to trip it.
    expect(stripComments("// we deliberately do not import parseUpiUri")).toBe("");
  });
});
