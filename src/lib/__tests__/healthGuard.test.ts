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

describe("UAE region axis (data generated in the UAE)", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  });

  it("blocks an IN-home user physically in the UAE", () => {
    expect(healthWritesAllowed("IN", "AE")).toBe(false);
    expect(() => assertHealthWriteAllowed("IN", "AE")).toThrow();
  });

  it("blocks regardless of home when region is AE", () => {
    for (const c of ["IN", "US", "GB", "CA", "AU", "SG", "AE"] as const) {
      expect(healthWritesAllowed(c, "AE")).toBe(false);
    }
  });

  it("still blocks an AE-home user travelling elsewhere", () => {
    expect(healthWritesAllowed("AE", "IN")).toBe(false);
  });

  it("allows when both axes are non-AE", () => {
    expect(healthWritesAllowed("IN", "IN")).toBe(true);
    expect(healthWritesAllowed("US", null)).toBe(true);
  });

  it("region fails OPEN on null (no positive signal) — documented decision", () => {
    expect(healthWritesAllowed("IN", null)).toBe(true);
  });

  it("crisis content stays available in every state, including region=AE", () => {
    expect(getCrisisLines("AE").length).toBeGreaterThan(0);
    expect(primaryEmergency("AE")).toBe("999");
    expect(medicalEmergency("AE")).toBe("998");
    for (const c of ["IN", "US", "GB", "CA", "AU", "SG"] as const) {
      expect(getCrisisLines(c).length).toBeGreaterThan(0);
    }
  });
});
