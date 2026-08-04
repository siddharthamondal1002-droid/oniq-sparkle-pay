import { describe, it, expect } from "vitest";
import {
  tileName,
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
    for (const k of ["watch", "study", "rides", "vitals", "pulse"] as TileKey[]) {
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
