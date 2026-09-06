/**
 * The canary that decides whether the phone tab renders.
 *
 * It was built to break a deadlock: SMS delivery can only be proven on a real
 * handset on the live site, and while `OTP_LOGIN_ENABLED` is false the tab
 * never renders, so there is nothing to prove it against. The owner chose to
 * turn the flag on for everyone rather than prove it through the canary first
 * (2026-09-06), which makes `?phone=1` the ROLLBACK path: set the flag back to
 * false and one browser can still reach the flow to diagnose it.
 *
 * WHY THE PARAMETER TESTS TARGET `phoneOptInParam` AND NOT `phoneLoginVisible`.
 * The first version of this file tested the parameter through the combined
 * function — and every one of those assertions became vacuous the moment the
 * flag went true, because the flag short-circuits and the function then returns
 * true for every input. They did not fail; they just stopped testing anything,
 * which is worse. Splitting the parse out keeps the rollback path covered
 * whichever way the flag is set.
 *
 * The cases below are the two ways a query-string check goes quietly wrong:
 * matching a DIFFERENT parameter that merely contains the name, and treating
 * any present value as truthy so `?phone=0` reads as on.
 */
import { describe, expect, it } from "vitest";
import { OTP_LOGIN_ENABLED, phoneLoginVisible, phoneOptInParam } from "../flags";

describe("phoneOptInParam — the rollback opt-in, independent of the flag", () => {
  it("is off with no query string at all", () => {
    expect(phoneOptInParam(undefined)).toBe(false);
    expect(phoneOptInParam("")).toBe(false);
    expect(phoneOptInParam("?")).toBe(false);
  });

  it("opts in on ?phone=1, with or without the leading question mark", () => {
    expect(phoneOptInParam("?phone=1")).toBe(true);
    expect(phoneOptInParam("phone=1")).toBe(true);
    expect(phoneOptInParam("?mode=signin&phone=1&x=2")).toBe(true);
  });

  it("wants the value 1 exactly — a present parameter is not a true one", () => {
    // `?phone=0` reads as "off" to a human, so it had better not read as "on".
    for (const s of ["?phone=0", "?phone", "?phone=", "?phone=true", "?phone=yes"]) {
      expect(phoneOptInParam(s)).toBe(false);
    }
  });

  it("does not match a different parameter that merely contains the name", () => {
    for (const s of ["?telephone=1", "?phone_hint=1", "?myphone=1", "?xphone=1"]) {
      expect(phoneOptInParam(s)).toBe(false);
    }
  });

  it("survives a malformed query string instead of throwing", () => {
    // URLSearchParams is lenient by design; the point is that the auth screen
    // renders rather than white-screening on a URL someone pasted badly.
    expect(() => phoneOptInParam("?%%%&&&=")).not.toThrow();
    expect(phoneOptInParam("?%%%&&&=")).toBe(false);
    expect(phoneOptInParam("?phone=1&&&")).toBe(true);
  });
});

describe("phoneLoginVisible — flag OR opt-in", () => {
  it("follows the flag for every input the parameter would refuse", () => {
    // Flag on  -> true regardless, so the canary never gates the shipped tab.
    // Flag off -> the parameter is the only way in.
    // Asserting against the flag itself keeps this meaningful either way.
    for (const s of [undefined, "", "?phone=0", "?telephone=1"]) {
      expect(phoneLoginVisible(s)).toBe(OTP_LOGIN_ENABLED);
    }
  });

  it("is always true for ?phone=1", () => {
    expect(phoneLoginVisible("?phone=1")).toBe(true);
  });
});

describe("the flag itself", () => {
  it("is ON — owner directive, 2026-09-06", () => {
    // This replaced a tripwire that asserted `false` and was written to be
    // deleted deliberately by whoever turned phone sign-in on. It was: the
    // owner was shown the measured evidence and the two things still unproven
    // (reCAPTCHA on oniqhub.com, and an SMS actually arriving), was offered the
    // ?phone=1 canary to prove them on one handset first, and chose to turn it
    // on for everyone instead.
    //
    // It stays as an assertion rather than being dropped because the value is
    // now load-bearing in the other direction: `phoneLoginVisible` short-
    // circuits on it, so a silent flip back to false would hide the tab from
    // every user and only this line would say so.
    expect(OTP_LOGIN_ENABLED).toBe(true);
  });
});
