/**
 * The library must be reachable from Home, not only from the Watch screen's
 * header. Owner, 2026-09-03 evening: "watch new addition not on Home page".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSurface, WATCH_SURFACES } from "@/lib/watch/surfaces";

const HOME = readFileSync("src/routes/_authenticated/app.index.tsx", "utf8");
const ROUTE = readFileSync("src/routes/_authenticated/app.watch_.library.tsx", "utf8");
const LIB = readFileSync("src/components/watch/library/WatchLibrary.tsx", "utf8");

describe("the Watch library is reachable from Home", () => {
  it("Home's Watch card carries the library row: Continue, Inbox, Resurface, Save a link", () => {
    expect(HOME).toContain('data-testid="home-watch-library"');
    for (const s of ["continue", "inbox", "resurface"]) {
      expect(HOME).toContain(`openLibrary("${s}")`);
    }
    expect(HOME).toContain('data-testid="home-watch-save"');
    expect(HOME).toMatch(/to: "\/app\/watch\/library", search: \{ save: true \}/);
  });

  it("the counts hook is called inside WatchPreview, above its render return", () => {
    const start = HOME.indexOf("function WatchPreview()");
    const ret = HOME.indexOf("\n  return (", start);
    const hook = HOME.indexOf("useWatchCounts(userId)", start);
    expect(start).toBeGreaterThan(-1);
    expect(ret).toBeGreaterThan(start);
    expect(hook).toBeGreaterThan(start);
    expect(hook).toBeLessThan(ret);
  });

  it("the route validates ?surface and ?save and hands them to the screen", () => {
    expect(ROUTE).toContain("validateSearch");
    expect(ROUTE).toContain("parseSurface(s.surface)");
    expect(ROUTE).toMatch(/<WatchLibrary initialSurface=\{surface\} openSave=\{!!save\} \/>/);
    expect(LIB).toContain("initialSurface");
    expect(LIB).toContain("useState(openSave)");
  });

  it("parseSurface accepts every surface and nothing else", () => {
    for (const s of WATCH_SURFACES) expect(parseSurface(s)).toBe(s);
    expect(parseSurface("everything")).toBeUndefined();
    expect(parseSurface("")).toBeUndefined();
    expect(parseSurface(1)).toBeUndefined();
    expect(parseSurface(null)).toBeUndefined();
  });
});
