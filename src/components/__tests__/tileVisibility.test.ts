import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TILE_LABELS, type TileKey } from "@/lib/i18n/tileLabel";

const home = readFileSync("src/routes/_authenticated/app.index.tsx", "utf8");
const sheet = readFileSync("src/components/customize/CustomizeSheet.tsx", "utf8");
// The tile list moved out of Home on 2026-09-03: src/data/worlds.ts is the one
// directory Home and Explore both draw from, so the wiring is pinned there.
const worlds = readFileSync("src/data/worlds.ts", "utf8");

// Mirrors AlsoInOniqRow's filter for the adultOnly axis.
function visible(tiles: { key: TileKey; adultOnly?: boolean }[], isAdult: boolean): TileKey[] {
  return tiles.filter((t) => !t.adultOnly || isAdult).map((t) => t.key);
}

// Jobs and the job/gig directory were two adult-only tiles pointing at two
// routes. They are one screen now — /app/jobs with a ?tab switch — so there is
// a single adult-only tile. The gate itself is unchanged and still the thing
// under test.
const TILES: { key: TileKey; adultOnly?: boolean }[] = [
  { key: "university" },
  { key: "jobs", adultOnly: true },
];

describe("age-gated tile rendering", () => {
  it("hides jobs when is_adult_18 is false", () => {
    expect(visible(TILES, false)).toEqual(["university"]);
  });

  it("shows them for an adult", () => {
    expect(visible(TILES, true)).toEqual(["university", "jobs"]);
  });

  it("wires each tile to its route and uses the 18+ gate, never is_minor_account", () => {
    expect(worlds).toMatch(/key: "university",\s*to: "\/app\/university"/);
    expect(worlds).toMatch(/key: "jobs",\s*to: "\/app\/jobs"[\s\S]{0,200}adultOnly: true/);
    expect(home).toContain("useIsAdult18");
    expect(home).toContain("adultOnly || isAdult");
    expect(home).not.toContain("is_minor_account");
  });

  it("no longer renders a second, separate job-apps tile", () => {
    expect(home).not.toContain('key: "jobsApps"');
    expect(home).not.toContain("/app/jobs-apps");
    expect(worlds).not.toContain('key: "jobsApps"');
    expect(worlds).not.toContain("/app/jobs-apps");
  });

  it("the retired jobs-apps route redirects instead of 404ing", () => {
    // It shipped in the Android build already on phones, so it has to keep
    // resolving.
    const retired = readFileSync("src/routes/_authenticated/app.jobs-apps.tsx", "utf8");
    expect(retired).toMatch(/redirect\(/);
    expect(retired).toMatch(/tab: "apps"/);
  });

  it("CustomizeSheet lists the new tiles but not cv", () => {
    const bannerOnly = /BANNER_ONLY_TILES: TileKey\[\] = \[(.*?)\]/s.exec(sheet)![1];
    const keys = (Object.keys(TILE_LABELS) as TileKey[]).filter(
      (k) => !bannerOnly.includes(`"${k}"`),
    );
    expect(keys).toContain("university");
    expect(keys).toContain("jobs");
    expect(keys).not.toContain("cv");
  });
});
