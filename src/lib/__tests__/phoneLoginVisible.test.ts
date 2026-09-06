/**
 * The canary that decides whether the phone tab renders.
 *
 * It exists to break a deadlock: SMS delivery can only be proven on a real
 * handset on the live site, and while `OTP_LOGIN_ENABLED` is false the tab
 * never renders, so there is nothing to prove it against. `?phone=1` opts one
 * browser in for the price of one SMS instead of shipping an unproven,
 * SMS-spending path to all 125 users.
 *
 * WHAT THESE TESTS ARE FOR. Not the happy path — that is one line. They pin the
 * two ways a query-string check gets quietly wrong: matching a DIFFERENT
 * parameter that merely contains the name, and treating any present value as
 * truthy so `?phone=0` turns it on. Both are the kind of bug that only shows up
 * as "why is the phone tab visible in production".
 */
import { describe, expect, it } from "vitest";
import { OTP_LOGIN_ENABLED, phoneLoginVisible } from "../flags";

describe("phoneLoginVisible", () => {
  it("is off with no query string at all", () => {
    expect(phoneLoginVisible(undefined)).toBe(false);
    expect(phoneLoginVisible("")).toBe(false);
    expect(phoneLoginVisible("?")).toBe(false);
  });

  it("opts in on ?phone=1, with or without the leading question mark", () => {
    expect(phoneLoginVisible("?phone=1")).toBe(true);
    expect(phoneLoginVisible("phone=1")).toBe(true);
    expect(phoneLoginVisible("?mode=signin&phone=1&x=2")).toBe(true);
  });

  it("wants the value 1 exactly — a present parameter is not a true one", () => {
    // `?phone=0` reads as "off" to a human, so it had better not read as "on".
    for (const s of ["?phone=0", "?phone", "?phone=", "?phone=true", "?phone=yes"]) {
      expect(phoneLoginVisible(s)).toBe(false);
    }
  });

  it("does not match a different parameter that merely contains the name", () => {
    for (const s of ["?telephone=1", "?phone_hint=1", "?myphone=1", "?xphone=1"]) {
      expect(phoneLoginVisible(s)).toBe(false);
    }
  });

  it("survives a malformed query string instead of throwing", () => {
    // URLSearchParams is lenient by design; the point is that the auth screen
    // renders rather than white-screening on a URL someone pasted badly.
    expect(() => phoneLoginVisible("?%%%&&&=")).not.toThrow();
    expect(phoneLoginVisible("?%%%&&&=")).toBe(false);
    expect(phoneLoginVisible("?phone=1&&&")).toBe(true);
  });

  it("the flag short-circuits the parameter, so the flip makes it redundant", () => {
    // When OTP_LOGIN_ENABLED goes true this must return true for EVERY input —
    // otherwise the canary would start gating the shipped feature.
    if (!OTP_LOGIN_ENABLED) {
      expect(phoneLoginVisible("?phone=0")).toBe(false);
      return;
    }
    for (const s of [undefined, "", "?phone=0", "?telephone=1"]) {
      expect(phoneLoginVisible(s)).toBe(true);
    }
  });
});

describe("the flag itself", () => {
  it("is still off — flipping it is a delivered SMS, not a green build", () => {
    // This is a TRIPWIRE, not a requirement. If you are turning phone sign-in
    // on, you are meant to delete this test in the same commit — deliberately,
    // having read flags.ts, having watched a code arrive on a real handset.
    expect(OTP_LOGIN_ENABLED).toBe(false);
  });
});
