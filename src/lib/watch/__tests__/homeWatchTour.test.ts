/**
 * The Home Watch card's auto-tour timing is an owner decision, recorded
 * here so a refactor cannot quietly change it.
 *
 * Owner directive, 2026-09-03 (evening): "keep loop timing 20 sec for each
 * channel except devotional".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HOME = readFileSync("src/routes/_authenticated/app.index.tsx", "utf8");

describe("Home Watch auto-tour (owner directive 2026-09-03)", () => {
  it("tours every channel at 20 seconds", () => {
    expect(HOME).toMatch(/export const TOUR_MS = 20_000;/);
  });

  it("exempts the devotional genre, which keeps its two minutes while browsing", () => {
    expect(HOME).toMatch(/export const DEVOTIONAL_TOUR_MS = 120_000;/);
    expect(HOME).toContain("isDevotional ? DEVOTIONAL_TOUR_MS : TOUR_MS");
  });

  it("still turns the tour off entirely while a devotional loop is running", () => {
    expect(HOME).toContain("if (isDevotional && (loopActive || loopEnded || showPicker)) return;");
  });

  it("still defers rather than advances while the app is hidden", () => {
    expect(HOME).toContain("document.hidden");
    expect(HOME).toContain("window.setTimeout(tick, HIDDEN_RECHECK_MS)");
  });
});
