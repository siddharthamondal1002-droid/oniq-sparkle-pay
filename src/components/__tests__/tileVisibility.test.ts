import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TILE_LABELS, type TileKey } from "@/lib/i18n/tileLabel";

const home = readFileSync("src/routes/_authenticated/app.index.tsx", "utf8");
const sheet = readFileSync("src/components/customize/CustomizeSheet.tsx", "utf8");

// Mirrors AlsoInOniqRow's filter for the adultOnly axis.
function visible(tiles: { key: TileKey; adultOnly?: boolean }[], isAdult: boolean): TileKey[] {
  return tiles.filter((t) => !t.adultOnly || isAdult).map((t) => t.key);
}

const TILES: { key: TileKey; adultOnly?: boolean }[] = [
  { key: "university" },
  { key: "jobs", adultOnly: true },
  { key: "jobsApps", adultOnly: true },
];

describe("age-gated tile rendering", () => {
  it("hides jobs and jobsApps when is_adult_18 is false", () => {
    expect(visible(TILES, false)).toEqual(["university"]);
  });

  it("shows them for an adult", () => {
    expect(visible(TILES, true)).toEqual(["university", "jobs", "jobsApps"]);
  });

  it("wires each tile to its route and uses the 18+ gate, never is_minor_account", () => {
    expect(home).toContain('{ key: "university", to: "/app/university" }');
    expect(home).toContain('key: "jobs", to: "/app/jobs", adultOnly: true');
    expect(home).toContain('key: "jobsApps", to: "/app/jobs-apps", adultOnly: true');
    expect(home).toContain("useIsAdult18");
    expect(home).not.toContain("is_minor_account");
  });

  it("CustomizeSheet lists the new tiles but not cv", () => {
    const bannerOnly = /BANNER_ONLY_TILES: TileKey\[\] = \[(.*?)\]/s.exec(sheet)![1];
    const keys = (Object.keys(TILE_LABELS) as TileKey[]).filter(
      (k) => !bannerOnly.includes(`"${k}"`),
    );
    expect(keys).toContain("university");
    expect(keys).toContain("jobs");
    expect(keys).toContain("jobsApps");
    expect(keys).not.toContain("cv");
  });
});
