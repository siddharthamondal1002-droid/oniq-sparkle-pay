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

  // UPI IS BANNED HERE AGAIN — owner directive, 2026-09-06 (evening): "hide
  // upi", reversing that morning's "make upi active again".
  //
  // THE LESSON FROM THE MORNING IS STILL THE VALUABLE PART, and it applies in
  // this direction too: unhiding the registry entry alone was NOT enough,
  // because it lit only the shortcut buried inside Plug, three taps down a
  // directory of third-party apps, while Home had no tile and this test
  // forbade adding one. The feature read as shipped and was unreachable —
  // reported, exactly, as "no tabs, no icons". So HIDING it means closing
  // every door, not just the registry one; the ban below and `hidden: true`
  // in appRegistry.ts are two halves of the same change.
  //
  // Food, Scan and the debug screen stay banned for their own reasons. Scan
  // was never an oversight: /app/upi's own "Scan a QR instead" reached the
  // scanner, so it had a door and did not need a second one on Home.
  it("carries no Food, no Scan, no debug screen — and no UPI", () => {
    const text = JSON.stringify(WORLD_GROUPS).toLowerCase();
    for (const banned of ["/app/food", "/app/scan", "/app/diag", "food", "/app/upi"]) {
      expect(text).not.toContain(banned);
    }
  });

  /**
   * UPI IS OFF HOME AGAIN — owner directive, 2026-09-06 (evening): "hide upi".
   * This assertion is the exact inverse of the one it replaces, which had been
   * the exact inverse of the ban before THAT. The flag has moved four times.
   *
   * The reason is measured: the upi:// hand-off was declined by PhonePe,
   * Google Pay AND Paytm on a real merchant QR, including when handed the QR's
   * own bytes with zero transformation, while scanning the same code inside
   * the app succeeded. A tile is a promise, and this one could not be kept.
   *
   * `/app/upi` still RESOLVES — hiding is not deleting — so this bans the DOOR
   * and not the room. `WORLD_ICON["upi"]` stays defined for the same reason:
   * it costs nothing and is what a fifth flip would need.
   */
  it("keeps UPI off Home, and the registry entry hidden to match", () => {
    expect(
      ALL_WORLDS.find((w) => w.to === "/app/upi"),
      "a Home tile routes to /app/upi while oniq-upi carries hidden: true — " +
        "see appRegistry.ts, marketingCopy.ts and playCompliance.ts, which move together",
    ).toBeUndefined();
    expect(ALL_WORLDS.find((w) => w.key === "upi")).toBeUndefined();

    // The comment above claims the icon survives the tile, so it is asserted
    // rather than left as prose — a badge missing on the fifth flip renders an
    // anonymous blank, and nothing else would catch it until someone looked.
    expect(WORLD_ICON["upi"], "WORLD_ICON lost its upi entry").toBeTruthy();
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
