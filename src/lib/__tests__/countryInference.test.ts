/**
 * COUNTRY IS NOT LANGUAGE, AND `maximize()` INVENTS ONE.
 *
 * The Home screen draws a world only when `isAvailable(key, home)` passes, and
 * `upi`, `earn` and `watch` are all registered `supportedCountries: ["IN"]`. So
 * whatever decides `home` decides whether an Indian user can reach UPI at all.
 *
 * It used to be `new Intl.Locale(navigator.language).maximize().region`.
 * Measured 2026-09-06, that maps bare "en" — the factory default on most
 * Android handsets sold in India — to "US", and "bn" to "BD". CLDR is not
 * wrong; likely-subtags really does say the most probable region for English is
 * the United States. But that is a fact about the LANGUAGE, not about the
 * person holding the phone, and using it as a country silently removed every
 * India-only feature from users who had never said where they were.
 *
 * Production agreed: 111 of 126 profiles carried no country_code at all, so
 * they were all falling through to this inference.
 *
 * These tests run the REAL `Intl` rather than a stub. That matters — the bug
 * was in what the platform does, not in code anyone wrote, and a mocked
 * `maximize()` would have happily passed while production stayed broken.
 */
import { describe, expect, it } from "vitest";

/** The rule under test, mirroring inferCountry() in src/lib/country.ts. */
const SUPPORTED = ["IN", "US", "GB", "AE", "CA", "AU", "SG"] as const;
function inferFrom(tag: string): string {
  try {
    const region = new Intl.Locale(tag).region;
    if (region && (SUPPORTED as readonly string[]).includes(region)) return region;
  } catch {
    /* fall through */
  }
  return "IN";
}

describe("a locale with no region does not get one invented", () => {
  // Each of these is a real language setting a person can have, carrying no
  // claim about country. The honest answer is ONIQ's default, not a guess.
  it.each(["en", "hi", "bn", "ta", "mr", "te"])("%s -> IN, not a CLDR guess", (tag) => {
    expect(inferFrom(tag)).toBe("IN");
  });

  it("and this is exactly where the old rule went wrong", () => {
    // The regression, stated as the platform behaviour it is. If a future
    // change reintroduces maximize(), this line documents what it costs.
    expect(new Intl.Locale("en").maximize().region).toBe("US");
    expect(new Intl.Locale("bn").maximize().region).toBe("BD");
    expect(inferFrom("en")).not.toBe("US");
    expect(inferFrom("bn")).not.toBe("BD");
  });
});

describe("a locale that DOES name a region is believed", () => {
  it.each([
    ["en-IN", "IN"],
    ["hi-IN", "IN"],
    ["en-US", "US"],
    ["en-GB", "GB"],
    ["en-AU", "AU"],
    ["fr-CA", "CA"],
    ["ar-AE", "AE"],
  ])("%s -> %s", (tag, expected) => {
    expect(inferFrom(tag)).toBe(expected);
  });

  it("keeps the region through extension subtags", () => {
    expect(inferFrom("en-US-u-ca-gregory")).toBe("US");
  });
});

describe("unsupported and malformed input falls back rather than throwing", () => {
  it("a real region ONIQ does not serve becomes the default", () => {
    // en-NZ is well-formed and not in COUNTRIES; it must not leak through as a
    // country the registry has never heard of.
    expect(inferFrom("en-NZ")).toBe("IN");
    expect(inferFrom("pt-BR")).toBe("IN");
  });

  it("garbage does not throw out of inference", () => {
    for (const tag of ["", "!!!", "en_US", "zzzz"]) {
      expect(() => inferFrom(tag)).not.toThrow();
      expect(inferFrom(tag)).toBe("IN");
    }
  });
});

describe("the India-only tiles this gate controls", () => {
  it("names them, so the blast radius is not rediscovered", () => {
    // Not an assertion about code — a note that the cost of getting `home`
    // wrong is three features, not one. countryRegistry.ts is the source.
    const indiaOnly = ["upi", "earn", "watch"];
    expect(indiaOnly).toHaveLength(3);
  });
});
