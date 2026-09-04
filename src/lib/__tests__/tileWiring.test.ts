import { describe, it, expect } from "vitest";
import {
  tileName,
  tileNamePlain,
  TILE_LABELS,
  TILE_LABELS_HI,
  TILE_LABELS_BY_COUNTRY,
  type TileKey,
} from "@/lib/i18n/tileLabel";
import { isAvailable } from "@/data/countryRegistry";

const NEW_KEYS: TileKey[] = ["university", "jobs", "jobsApps", "cv"];

describe("Phase 4a tile wiring", () => {
  it("resolves every new key in en and hi", () => {
    for (const k of NEW_KEYS) {
      expect(tileName("en", k)).toBe(TILE_LABELS[k]);
      expect(tileName("hi", k)).toBe(TILE_LABELS_HI[k]);
      expect(TILE_LABELS[k]).toBeTruthy();
      expect(TILE_LABELS_HI[k]).toBeTruthy();
    }
  });

  it("uses the US override for cv, with the accent", () => {
    expect(tileName("en", "cv", "US")).toBe("Résumé");
    expect(tileName("en", "cv", "GB")).toBe("CV");
    expect(tileName("en", "cv")).toBe("CV");
    expect(TILE_LABELS_BY_COUNTRY.cv?.US).toBe("Résumé");
  });

  it("lets Hindi win over the country override", () => {
    expect(tileName("hi", "cv", "US")).toBe("सीवी");
  });

  it("leaves existing labels unchanged when country is omitted or passed", () => {
    for (const k of ["study", "rides", "vitals", "pulse"] as TileKey[]) {
      expect(tileName("en", k)).toBe(TILE_LABELS[k]);
      expect(tileName("en", k, "US")).toBe(TILE_LABELS[k]);
      expect(tileName("hi", k, "US")).toBe(TILE_LABELS_HI[k]);
    }
  });

  it("registers the new surfaces as available features", () => {
    for (const id of ["university", "jobs", "jobsApps"]) {
      expect(isAvailable(id, "IN")).toBe(true);
      expect(isAvailable(id, "US")).toBe(true);
    }
  });
});

describe("the Pay tile on the home row", () => {
  it("is registered India-only — the NPCI rail does not exist elsewhere", () => {
    // isAvailable() answers TRUE for ids it does not know, so this test is the
    // difference between "gated to India" and "silently worldwide": if the
    // registry entry is ever removed, the US expectation below flips to true
    // and fails here rather than on someone's phone in Ohio.
    expect(isAvailable("upi", "IN")).toBe(true);
    expect(isAvailable("upi", "US")).toBe(false);
    expect(isAvailable("upi", "GB")).toBe(false);
  });

  it("resolves its label in both languages", () => {
    expect(tileName("en", "upi")).toBe(TILE_LABELS.upi);
    expect(tileName("hi", "upi")).toBe(TILE_LABELS_HI.upi);
    expect(TILE_LABELS.upi).toBeTruthy();
    expect(TILE_LABELS_HI.upi).toBeTruthy();
  });
});

describe("tileNamePlain — the name a drawn tile shows", () => {
  const ALL = Object.keys(TILE_LABELS) as TileKey[];

  it("never leaves a trailing emoji for a tile that draws its own icon", () => {
    // The bug this exists for: "Moments ✨" under a well already showing ✨,
    // with the second copy wrapping onto its own line. Assert by Unicode
    // property so a label added later is covered without editing this test.
    const trailing = /[\s\u200d\ufe0f\p{Extended_Pictographic}]+$/u;
    for (const k of ALL) {
      expect(tileNamePlain("en", k), `en ${k}`).not.toMatch(trailing);
      expect(tileNamePlain("hi", k), `hi ${k}`).not.toMatch(trailing);
    }
  });

  it("never returns an empty name", () => {
    for (const k of ALL) {
      expect(tileNamePlain("en", k).length).toBeGreaterThan(0);
      expect(tileNamePlain("hi", k).length).toBeGreaterThan(0);
    }
  });

  it("keeps the word itself, and the country override with it", () => {
    expect(tileNamePlain("en", "wander")).toBe("Wanderlust");
    expect(tileNamePlain("en", "moments")).toBe("Moments");
    expect(tileNamePlain("hi", "wander")).toBe("सफ़र");
    expect(tileNamePlain("en", "cv", "US")).toBe("Résumé");
  });

  it("is a no-op for a label that never had an emoji", () => {
    for (const k of ["pulse", "moots", "university", "jobs", "cv"] as TileKey[]) {
      expect(tileNamePlain("en", k)).toBe(tileName("en", k));
    }
  });
});
