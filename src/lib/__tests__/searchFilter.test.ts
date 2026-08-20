/**
 * SECURITY — the people-search sanitizer must neutralise PostgREST
 * filter-injection. The attack: user search text is interpolated into a
 * hand-built `.or("username.ilike.%<q>%,...")`, and `,` `(` `)` in <q> break
 * out of the ilike term to inject conditions like `is_admin.eq.true`.
 */
import { describe, expect, it } from "vitest";
import { sanitizeLikeQuery } from "@/lib/searchFilter";

describe("sanitizeLikeQuery", () => {
  it("strips the PostgREST breakout characters , ( ) and backslash", () => {
    expect(sanitizeLikeQuery("x,is_admin.eq.true,username.ilike.%")).not.toMatch(/[,()\\]/);
  });

  it("removes the injected admin-enumeration clause structure", () => {
    // After sanitising, the commas that would create new OR terms are gone, so
    // the whole thing collapses into a single literal ilike value.
    const out = sanitizeLikeQuery("a,is_admin.eq.true,b");
    expect(out).toBe("ais_admin.eq.trueb");
    expect(out.includes(",")).toBe(false);
  });

  it("strips parentheses used for PostgREST grouping", () => {
    expect(sanitizeLikeQuery("and(is_admin.eq.true)")).toBe("andis_admin.eq.true");
  });

  it("leaves ordinary search text (and ilike wildcards) intact", () => {
    expect(sanitizeLikeQuery("María José")).toBe("María José");
    expect(sanitizeLikeQuery("o'brien")).toBe("o'brien");
    // % and _ are ilike wildcards, not breakout chars — preserved by design.
    expect(sanitizeLikeQuery("50%_off")).toBe("50%_off");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeLikeQuery("  alex  ")).toBe("alex");
  });

  it("a fully-malicious input cannot reintroduce a comma-delimited term", () => {
    const attacks = [
      "*,is_admin.eq.true",
      "),or(is_admin.eq.true",
      "\\,is_admin.eq.true",
      "a),(b",
    ];
    for (const a of attacks) expect(sanitizeLikeQuery(a)).not.toMatch(/[,()\\]/);
  });
});
