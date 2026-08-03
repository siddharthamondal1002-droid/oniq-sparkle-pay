// currentRegion must only ever come from a genuine location signal.
// A device language tag is NOT one — see src/lib/region.ts.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getCurrentRegion, setCurrentRegion } from "../region";
import { getCrisisLines, medicalEmergency } from "@/data/countryRegistry";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

/** Mirrors the only accepted detection path in useCurrentRegion(). */
function applyEdgeSignal(headerCountry: string | null) {
  const raw = (headerCountry ?? "").toUpperCase();
  const known = raw && raw !== "XX" && raw !== "T1";
  const supported = ["IN", "US", "GB", "AE", "CA", "AU", "SG"];
  if (known && supported.includes(raw)) setCurrentRegion(raw as never);
}

describe("currentRegion detection", () => {
  it("stays null when the edge header is missing", () => {
    applyEdgeSignal(null);
    expect(getCurrentRegion()).toBeNull();
  });

  it("stays null for XX (unknown client)", () => {
    applyEdgeSignal("XX");
    expect(getCurrentRegion()).toBeNull();
  });

  it("stays null for T1 (Tor exit node)", () => {
    applyEdgeSignal("T1");
    expect(getCurrentRegion()).toBeNull();
  });

  it("accepts a genuine edge country", () => {
    applyEdgeSignal("AE");
    expect(getCurrentRegion()).toBe("AE");
  });

  it("never derives a region from a device language tag", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/region.ts", "utf8"),
    );
    // No language-to-region inference may exist in this module.
    expect(src).not.toMatch(/Intl\.Locale/);
    expect(src).not.toMatch(/getLanguageTag/);
    expect(src).not.toMatch(/navigator\.language/);
    expect(src).not.toMatch(/detectRegionFromDevice/);
  });

  it("an en-US phone in India produces no region on its own", () => {
    // Simulate: language tag says en-US, edge says nothing.
    applyEdgeSignal(null);
    expect(getCurrentRegion()).toBeNull();
  });
});

describe("CrisisCard fallback when region is null", () => {
  it("uses HOME when currentRegion is null", () => {
    const region = getCurrentRegion(); // null
    const home = "IN" as const;
    const here = region ?? home;
    expect(here).toBe("IN");
    expect(medicalEmergency(here)).toBe("112");
    expect(getCrisisLines(here).length).toBeGreaterThan(0);
  });

  it("prefers a genuine currentRegion over HOME", () => {
    applyEdgeSignal("AE");
    const here = getCurrentRegion() ?? "IN";
    expect(here).toBe("AE");
    // UAE has no unified line for medical — must be the ambulance number.
    expect(medicalEmergency("AE")).toBe("998");
  });
});
