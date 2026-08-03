import { describe, expect, it } from "vitest";
import { isRestrictedError } from "@/lib/ageGate";
import { getCountryConfig } from "@/data/countryRegistry";

/**
 * Age gate unit coverage. The authority for the threshold is
 * `minor_age_for_country()` in Postgres; these tests pin the client-side
 * contract that surrounds it: restricted-error detection, and the registry
 * thresholds the database mirrors (never a hardcoded 18/13 in app code).
 */
describe("isRestrictedError", () => {
  it("detects the restricted-state guard message", () => {
    expect(
      isRestrictedError({
        message:
          "restricted: this account is under the age of digital consent and parental consent has not been verified yet. Nothing was saved.",
      }),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isRestrictedError({ message: "RESTRICTED: nothing was saved" })).toBe(true);
  });

  it("does not claim unrelated failures", () => {
    expect(isRestrictedError({ message: "new row violates row-level security policy" })).toBe(
      false,
    );
    expect(isRestrictedError(new Error("network error"))).toBe(false);
    expect(isRestrictedError(null)).toBe(false);
    expect(isRestrictedError(undefined)).toBe(false);
  });
});

describe("age threshold source of truth", () => {
  it("fails closed to the strictest threshold when the home country is unknown", () => {
    expect(getCountryConfig(null).minorAge).toBe(18);
    expect(getCountryConfig(undefined).minorAge).toBe(18);
  });

  it("uses India's DPDP threshold for IN", () => {
    expect(getCountryConfig("IN").minorAge).toBe(18);
  });

  it("keeps every configured threshold within a legal range", () => {
    for (const code of ["IN", "US", "GB", "AE"] as const) {
      const cfg = getCountryConfig(code);
      expect(cfg.minorAge).toBeGreaterThanOrEqual(13);
      expect(cfg.minorAge).toBeLessThanOrEqual(18);
    }
  });
});
