/**
 * Glance open data: holidays and reference FX.
 *
 * Both sources are free, keyless and commercially usable — which is the whole
 * reason they were chosen over the alternatives recorded in REJECTED_SOURCES.
 * These tests hold that line and the two behaviours most likely to be got
 * wrong later: Indian state-level holidays, and never letting a once-a-day
 * reference rate look like a live quote.
 */
import { describe, expect, it } from "vitest";
import { OPEN_DATA_SOURCES, REJECTED_SOURCES, sourceById } from "@/data/openDataSources";
import {
  filterForSubdivision,
  needsSubdivision,
  nextHoliday,
  normalise,
  type Holiday,
} from "@/lib/holidays";
import { FX_NOTICE, isStale, parseRate } from "@/lib/fxReference";

describe("every shipped source is free, keyless and licence-checked", () => {
  it("records a licence and licence URL for each", () => {
    for (const s of OPEN_DATA_SOURCES) {
      expect(s.licence.length, `${s.id} has no licence`).toBeGreaterThan(2);
      expect(s.licenceUrl).toMatch(/^https:\/\//);
      expect(s.usedFor.length).toBeGreaterThan(20);
    }
  });

  it("ships nothing that needs a paid tier or an API key", () => {
    for (const s of OPEN_DATA_SOURCES) {
      expect(s.freeForCommercialUse, `${s.id} is not free for commercial use`).toBe(true);
      expect(s.requiresApiKey, `${s.id} needs a key`).toBe(false);
    }
  });

  it("keeps the rejected sources and their reasons, so none quietly returns", () => {
    const names = REJECTED_SOURCES.map((r) => r.source.toLowerCase()).join(" ");
    expect(names).toContain("open-meteo");
    expect(names).toContain("ibjarates");
    expect(names).toContain("google maps platform weather");
    for (const r of REJECTED_SOURCES) expect(r.reason.length).toBeGreaterThan(30);
  });

  it("resolves by id", () => {
    expect(sourceById("nager-date")?.source).toBe("Nager.Date");
    expect(sourceById("nope")).toBeNull();
  });
});

const RAW = [
  { date: "2026-01-26", localName: "Republic Day", name: "Republic Day", global: true, counties: null },
  { date: "2026-10-20", localName: "Durga Puja", name: "Durga Puja", global: false, counties: ["IN-WB"] },
  { date: "2026-01-15", localName: "Pongal", name: "Pongal", global: false, counties: ["IN-TN"] },
];

describe("Indian holidays are state-aware", () => {
  const all: Holiday[] = normalise(RAW);

  it("flags India as needing a subdivision", () => {
    expect(needsSubdivision("IN")).toBe(true);
    expect(needsSubdivision("US")).toBe(false);
  });

  it("gives a West Bengal user Durga Puja but not Pongal", () => {
    const names = filterForSubdivision(all, "IN-WB").map((h) => h.name);
    expect(names).toContain("Durga Puja");
    expect(names).not.toContain("Pongal");
    expect(names).toContain("Republic Day");
  });

  it("gives a Tamil Nadu user Pongal but not Durga Puja", () => {
    const names = filterForSubdivision(all, "IN-TN").map((h) => h.name);
    expect(names).toContain("Pongal");
    expect(names).not.toContain("Durga Puja");
  });

  it("shows national holidays only when the state is unknown", () => {
    // A wrong day off is worse than a missing one.
    const names = filterForSubdivision(all, null).map((h) => h.name);
    expect(names).toEqual(["Republic Day"]);
  });

  it("survives a malformed row rather than throwing", () => {
    const messy = normalise([...RAW, { date: undefined, global: true } as never]);
    expect(messy.length).toBe(3);
  });

  it("finds the next holiday from a given date", () => {
    expect(nextHoliday(all, new Date("2026-02-01"))?.name).toBe("Durga Puja");
    expect(nextHoliday(all, new Date("2026-12-01"))).toBeNull();
  });
});

describe("FX is a reference rate, never a quote", () => {
  it("says so in the notice the UI renders", () => {
    expect(FX_NOTICE.toLowerCase()).toContain("not a live quote");
    expect(FX_NOTICE.toLowerCase()).toContain("reference rate");
  });

  it("always carries the publication date, never 'now'", () => {
    const r = parseRate({ base: "EUR", date: "2026-08-04", rates: { INR: 94.2 } }, "INR",
      new Date("2026-08-04T12:00:00Z"));
    expect(r?.asOf).toBe("2026-08-04");
    expect(r?.rate).toBe(94.2);
    expect(r?.stale).toBe(false);
  });

  it("flags a rate that has gone stale over a long weekend", () => {
    expect(isStale("2026-08-04", new Date("2026-08-06T12:00:00Z"))).toBe(false);
    expect(isStale("2026-08-04", new Date("2026-08-11T12:00:00Z"))).toBe(true);
  });

  it("rejects a malformed or nonsensical payload instead of rendering it", () => {
    expect(parseRate({ base: "EUR", date: "2026-08-04", rates: {} }, "INR")).toBeNull();
    expect(parseRate({ base: "EUR", rates: { INR: 94 } }, "INR")).toBeNull();
    expect(parseRate({ base: "EUR", date: "2026-08-04", rates: { INR: 0 } }, "INR")).toBeNull();
    expect(parseRate({ base: "EUR", date: "2026-08-04", rates: { INR: -3 } }, "INR")).toBeNull();
  });
});
