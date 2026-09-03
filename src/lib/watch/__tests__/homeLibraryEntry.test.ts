/**
 * The library's deep links. The Home row that used them was added on
 * 2026-09-03 ("watch new addition not on Home page") and removed the same
 * evening on the owner's word ("remove those new buttons from home page
 * watch its looking ugly"); the Watch screen's header link is the front
 * door, and the route still honours ?surface= and ?save= for it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSurface, WATCH_SURFACES } from "@/lib/watch/surfaces";

const HOME = readFileSync("src/routes/_authenticated/app.index.tsx", "utf8");
const WATCH = readFileSync("src/routes/_authenticated/app.watch.tsx", "utf8");
const ROUTE = readFileSync("src/routes/_authenticated/app.watch_.library.tsx", "utf8");
const LIB = readFileSync("src/components/watch/library/WatchLibrary.tsx", "utf8");

describe("the Watch library's front door", () => {
  it("is the Watch screen's header link, not a row of buttons on Home (owner, 2026-09-03)", () => {
    expect(WATCH).toContain('data-testid="watch-library-link"');
    expect(HOME).not.toContain("home-watch-library");
    expect(HOME).not.toContain("home-watch-save");
    expect(HOME).not.toContain("HomeLibraryChip");
    expect(HOME).not.toContain("useWatchCounts");
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
