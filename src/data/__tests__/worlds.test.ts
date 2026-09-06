/**
 * The worlds directory is real routes only, grouped, with no UPI and no Food
 * (owner mission, 2026-09-03), and the same list everywhere it is drawn.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_WORLDS, GREETING, WORLD_GROUPS, dayPartOf, groupsFor } from "@/data/worlds";
import { TILE_LABELS } from "@/lib/i18n/tileLabel";
import { WORLD_ICON } from "@/data/worldIcons";

const ROUTES = join(process.cwd(), "src/routes/_authenticated");
const routeFileFor = (to: string) =>
  join(ROUTES, `app.${to.replace(/^\/app\//, "").replace(/\//g, ".")}.tsx`);

describe("worlds directory", () => {
  it("every world lands on a route that exists and has a label", () => {
    for (const w of ALL_WORLDS) {
      expect(existsSync(routeFileFor(w.to)), `${w.key} → ${w.to} has no route file`).toBe(true);
      expect(TILE_LABELS[w.key], `${w.key} has no label`).toBeTruthy();
    }
  });

  // UPI CAME BACK, 2026-09-06 — owner directive, "make upi active again
  // meaning everything regarding upi". It had been banned here since the
  // 2026-08-17 hide. Unhiding the registry entry alone was NOT enough and is
  // the mistake worth recording: it lit only the shortcut buried inside Plug,
  // three taps down a directory of third-party apps, while Home still had no
  // tile and THIS TEST forbade adding one. The feature read as shipped and was
  // unreachable — reported, exactly, as "no tabs, no icons".
  //
  // Food, Scan and the debug screen stay banned. Scan is not an oversight:
  // /app/upi's own "Scan a QR instead" reaches the scanner, so it has a door
  // and does not need a second one on Home.
  it("carries UPI, and still no Food, no Scan and no debug screen", () => {
    const text = JSON.stringify(WORLD_GROUPS).toLowerCase();
    for (const banned of ["/app/food", "/app/scan", "/app/diag", "food"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("puts UPI on Home, or the feature has no door", () => {
    const upi = ALL_WORLDS.find((w) => w.to === "/app/upi");
    expect(upi, "no world routes to /app/upi — UPI is unreachable from Home").toBeTruthy();
    expect(upi!.key).toBe("upi");
    // The badge is how a world is found without reading, so a tile with no
    // icon entry renders as an anonymous blank.
    expect(WORLD_ICON[upi!.key], "UPI tile has no icon").toBeTruthy();
  });

  it("lists each world once and every group has something in it", () => {
    const keys = ALL_WORLDS.map((w) => w.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const g of WORLD_GROUPS) expect(g.worlds.length).toBeGreaterThan(0);
  });

  it("keeps jobs behind the 18+ flag", () => {
    expect(ALL_WORLDS.find((w) => w.key === "jobs")?.adultOnly).toBe(true);
  });

  it("reorders by the hour but never drops a group", () => {
    for (const hour of [0, 6, 13, 19, 23]) {
      const part = dayPartOf(hour);
      expect(
        groupsFor(part)
          .map((g) => g.id)
          .sort(),
      ).toEqual(WORLD_GROUPS.map((g) => g.id).sort());
      expect(GREETING[part].hello).toBeTruthy();
    }
    expect(dayPartOf(8)).toBe("morning");
    expect(dayPartOf(14)).toBe("afternoon");
    expect(dayPartOf(20)).toBe("evening");
    expect(dayPartOf(2)).toBe("night");
  });
});
