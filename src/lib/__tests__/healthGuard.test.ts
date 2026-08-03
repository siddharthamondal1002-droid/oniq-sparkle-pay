import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  healthWritesAllowed,
  assertHealthWriteAllowed,
  clearLocalHealthData,
  LOCAL_HEALTH_KEYS,
} from "@/lib/healthGuard";
import { getCrisisLines, primaryEmergency, medicalEmergency } from "@/data/countryRegistry";

describe("UAE health-data block", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    vi.stubGlobal("window", { dispatchEvent: () => true, CustomEvent: class {} });
    vi.stubGlobal("CustomEvent", class {});
  });

  it("refuses health writes when Home is AE", () => {
    expect(healthWritesAllowed("AE")).toBe(false);
    expect(() => assertHealthWriteAllowed("AE")).toThrow();
  });

  it("allows health writes for every other supported Home country", () => {
    for (const c of ["IN", "US", "GB", "CA", "AU", "SG"] as const) {
      expect(healthWritesAllowed(c)).toBe(true);
      expect(() => assertHealthWriteAllowed(c)).not.toThrow();
    }
  });

  it("clears every device-local health key", () => {
    for (const k of LOCAL_HEALTH_KEYS) localStorage.setItem(k, "x");
    clearLocalHealthData();
    for (const k of LOCAL_HEALTH_KEYS) expect(localStorage.getItem(k)).toBeNull();
  });

  it("covers the safety plan and vitals cache keys", () => {
    expect(LOCAL_HEALTH_KEYS).toContain("oniq.safetyplan.v1");
    expect(LOCAL_HEALTH_KEYS).toContain("oniq.vitals.score.v1");
    expect(LOCAL_HEALTH_KEYS).toContain("oniq.vitals.experience.v1");
  });

  it("keeps crisis and emergency content fully available for AE", () => {
    expect(getCrisisLines("AE").length).toBeGreaterThan(0);
    expect(primaryEmergency("AE")).toBe("999");
    expect(medicalEmergency("AE")).toBe("998");
  });
});
