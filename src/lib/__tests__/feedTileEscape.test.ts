/**
 * EVERY FEED TAB YOU CAN SWITCH OFF MUST BE SWITCHABLE BACK ON.
 *
 * Reported 2026-08-18 as "watch problem": the WATCH feed tab and its ALSO IN
 * ONIQ chip had both vanished. It was not the country gate — the EARN chip was
 * still on screen and is gated to ["IN"] through the same isAvailable() call,
 * which pins the country to IN and proves the gate was passing.
 *
 * What had actually happened: `watch` appeared in Customize's TILE SKINS list,
 * where every row carries an eye toggle writing the shared hidden-tiles key.
 * One tap there removed a feed TAB — and HERO_TOGGLES, the list rendered under
 * the heading "Show / hide feed tiles", did not include Watch. Reachable in one
 * tap, escapable in none.
 *
 * This guard is the invariant, not the instance: whatever BANNER_MODES holds
 * tomorrow, every one of them has a way back.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const SHEET = read("src/components/customize/CustomizeSheet.tsx");
const HOME = read("src/routes/_authenticated/app.index.tsx");

/** The feed tabs Home actually offers. */
function bannerModes(): string[] {
  const raw = /const BANNER_MODES: BannerMode\[\] = \[(.*?)\]/s.exec(HOME)?.[1] ?? "";
  return [...raw.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
}

/** The keys Customize offers under "Show / hide feed tiles". */
function heroToggleKeys(): string[] {
  const block = /const HERO_TOGGLES: \{ key: TileKey; label: string \}\[\] = \[(.*?)\];/s.exec(
    SHEET,
  )?.[1];
  return [...(block ?? "").matchAll(/key: "([a-zA-Z]+)"/g)].map((m) => m[1]);
}

describe("a hidden feed tab is always recoverable", () => {
  it("every banner mode has a toggle in the show/hide list", () => {
    const modes = bannerModes();
    expect(modes.length, "BANNER_MODES could not be parsed").toBeGreaterThan(0);
    const toggles = heroToggleKeys();
    expect(toggles.length, "HERO_TOGGLES could not be parsed").toBeGreaterThan(0);
    for (const mode of modes) {
      expect(
        toggles,
        `"${mode}" is a feed tab a user can hide, with no way to bring it back`,
      ).toContain(mode);
    }
  });

  it("watch specifically, because that is the one that got lost", () => {
    expect(bannerModes()).toContain("watch");
    expect(heroToggleKeys()).toContain("watch");
  });

  it("the toggles are rendered under the heading users look for", () => {
    // A toggle that exists but is not in the section named after the job is
    // the same bug in a different place.
    expect(SHEET).toContain("Show / hide feed tiles");
    expect(SHEET).toContain("HERO_TOGGLES.map");
  });
});
