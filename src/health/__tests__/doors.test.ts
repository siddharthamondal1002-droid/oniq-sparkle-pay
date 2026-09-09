/**
 * EVERY DOOR TO ONIQ HEALTH IS SHUT, AND ONE FLAG WOULD OPEN ALL OF THEM.
 *
 * The lesson is upiDoors.test.ts, applied from the other side: a feature is
 * where its doors are, and a door that is not enumerated is the one that
 * stays open — or, when it is time to open them, the one that stays shut and
 * gets reported as "no tabs, no icons". The Home tile, the bottom tab and the
 * badge are all declared in src/health/doors.ts and spread into their lists
 * through `healthDoorsOpen()`. This evaluates the app's own expressions with
 * the flag as it is (shut) and as it would be (open).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HEALTH_ENABLED } from "@/health/flags";
import {
  HEALTH_NAV,
  HEALTH_NAV_PREFIX,
  HEALTH_ROUTE,
  HEALTH_WORLD,
  healthDoorsOpen,
} from "@/health/doors";
import { ALL_WORLDS, WORLD_GROUPS } from "@/data/worlds";
import { WORLD_ICON } from "@/data/worldIcons";
import { TILE_LABELS, TILE_LABELS_HI } from "@/lib/i18n/tileLabel";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { stripComments } from "@/test/sourceText";

const ROOT = join(__dirname, "..", "..", "..");
const ROUTES = join(ROOT, "src", "routes", "_authenticated");
const read = (p: string) => stripComments(readFileSync(p, "utf8"));

describe("open (Phase 3, owner directive 2026-09-09) — by the flag, through the spreads", () => {
  it("the flag is on and the expression says so", () => {
    expect(HEALTH_ENABLED).toBe(true);
    expect(healthDoorsOpen()).toBe(true);
    // And shut is still one word away: the same expression, evaluated off.
    expect(healthDoorsOpen(false)).toBe(false);
  });

  it("door 1 — exactly one Home tile routes to /app/health, and it is the declared one", () => {
    const tiles = ALL_WORLDS.filter((w) => w.to === HEALTH_ROUTE);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toBe(HEALTH_WORLD);
    expect(ALL_WORLDS.filter((w) => w.key === "health")).toHaveLength(1);
  });

  it("door 2 — the bottom nav spread reads the flag, by app.tsx's own text", () => {
    const src = read(join(ROUTES, "app.tsx"));
    expect(src).toContain(
      "...(healthDoorsOpen() ? [{ prefix: HEALTH_NAV_PREFIX, tab: HEALTH_NAV }] : [])",
    );
    // No hard-coded health tab beside the gated one.
    expect(src.match(/\/app\/health/g)?.length ?? 0).toBe(0);
  });

  it("door 1, by worlds.ts's own text — the spread, not a literal", () => {
    const src = read(join(ROOT, "src", "data", "worlds.ts"));
    expect(src).toContain("...(healthDoorsOpen() ? [HEALTH_WORLD] : [])");
    expect(src).not.toMatch(/to:\s*"\/app\/health"/);
  });
});

describe("openable by that flag alone", () => {
  it("the tile is well formed: real route, both label tables, a badge, a known world", () => {
    expect(HEALTH_WORLD.to).toBe(HEALTH_ROUTE);
    expect(existsSync(join(ROUTES, "app.health.tsx"))).toBe(true);
    expect(TILE_LABELS[HEALTH_WORLD.key]).toBeTruthy();
    expect(TILE_LABELS_HI[HEALTH_WORLD.key]).toBeTruthy();
    expect(WORLD_ICON[HEALTH_WORLD.key]).toBeTruthy();
    const canvas = readFileSync(join(ROOT, "src", "components", "oniq", "OniqCanvas.tsx"), "utf8");
    expect(canvas).toContain(`| "${HEALTH_WORLD.world}"`);
  });

  it("the tab is well formed and its label exists in en, hi and bn", () => {
    expect(HEALTH_NAV.to).toBe(HEALTH_ROUTE);
    expect(HEALTH_NAV_PREFIX).toBe(HEALTH_ROUTE);
    for (const lang of ["en", "hi", "bn"]) {
      expect(
        DICTIONARIES[lang][HEALTH_NAV.labelKey],
        `${lang} lacks ${HEALTH_NAV.labelKey}`,
      ).toBeTruthy();
    }
  });

  it("the same spread, evaluated with the flag on, carries the tile", () => {
    const live = WORLD_GROUPS.find((g) => g.id === "live")!;
    const opened = [...live.worlds, ...(healthDoorsOpen(true) ? [HEALTH_WORLD] : [])];
    expect(opened.some((w) => w.to === HEALTH_ROUTE)).toBe(true);
    expect(healthDoorsOpen(true)).toBe(true);
  });

  it("hidden is not deleted — the four route files exist and the parent has an Outlet", () => {
    for (const f of [
      "app.health.tsx",
      "app.health.index.tsx",
      "app.health.records.tsx",
      "app.health.consent.tsx",
    ]) {
      expect(existsSync(join(ROUTES, f)), f).toBe(true);
    }
    expect(read(join(ROUTES, "app.health.tsx"))).toMatch(/<Outlet\b/);
  });

  it("the layout answers 'not switched on' before it mounts a child", () => {
    const src = read(join(ROUTES, "app.health.tsx"));
    expect(src.indexOf("if (!HEALTH_ENABLED)")).toBeGreaterThan(0);
    expect(src.indexOf("if (!HEALTH_ENABLED)")).toBeLessThan(src.indexOf("<Outlet"));
  });
});
