/**
 * What matters here is that the grammar reads the PLAN rather than the index.
 *
 * The thing it replaces picked camera travel with `i % 3` and pan with `i % 2`,
 * which passes any test that only asks "is there a camera move". So these tests
 * ask the questions that separate a decision from a pattern: does a close-up
 * hold still, does an establisher move, and does the same prompt always produce
 * the same framing regardless of where it sits in the film.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIZE,
  framingFor,
  isMoving,
  panFor,
  readShotSize,
} from "@/lib/shotGrammar";

describe("readShotSize reads what Ting wrote", () => {
  it("finds the size at the front, where the system prompt asks for it", () => {
    expect(readShotSize("Establishing shot of a city at dusk")).toBe("establishing");
    expect(readShotSize("Wide shot of the courtyard")).toBe("wide");
    expect(readShotSize("Medium shot of the boy")).toBe("medium");
    expect(readShotSize("Close-up on her hands")).toBe("close");
    expect(readShotSize("Full body shot of the merchant")).toBe("full");
  });

  it("takes the FIRST size word, not the first pattern in the table", () => {
    // "Medium shot of a courtyard, the wide sky above" is a medium. Scanning
    // the table in order rather than by position would call it wide.
    expect(readShotSize("Medium shot of a courtyard, the wide sky above")).toBe("medium");
    expect(readShotSize("Wide shot of a close, crowded alley")).toBe("wide");
  });

  it("does not read 'close' out of 'extreme close' as a different size", () => {
    expect(readShotSize("Extreme close on the lamp")).toBe("close");
  });

  it("falls back to medium when Ting says nothing recognisable", () => {
    // A default that is a real shot size, not a throw: a plan that came back
    // slightly off-format should still render.
    expect(readShotSize("The boy sits on a wall")).toBe(DEFAULT_SIZE);
    expect(readShotSize("")).toBe(DEFAULT_SIZE);
  });

  it("does not care about case", () => {
    expect(readShotSize("CLOSE-UP ON THE RING")).toBe("close");
  });
});

describe("the camera follows the shot, not the shot number", () => {
  it("holds still on the close shots", () => {
    // Measured: half the ep3 clips were locked off, and the clip with the
    // biggest camera move had the LOWEST subject motion. Close is where the
    // character carries the frame.
    expect(isMoving(framingFor("Close-up on her face", 0))).toBe(false);
    expect(isMoving(framingFor("Medium shot of the boy", 0))).toBe(false);
  });

  it("moves most on an establisher, and stays under the measured maximum", () => {
    const est = framingFor("Establishing shot of the city", 0);
    expect(isMoving(est)).toBe(true);
    // 19.2% was the largest real drift measured across six clips. Exceeding it
    // would be inventing a move no reference shot ever made.
    expect(est.travel).toBeLessThan(0.192);
    expect(est.travel).toBeGreaterThan(framingFor("Wide shot of a street", 0).travel);
  });

  it("orders travel by how far away the shot is", () => {
    const t = (p: string) => framingFor(p, 0).travel;
    expect(t("Establishing shot")).toBeGreaterThan(t("Wide shot"));
    expect(t("Wide shot")).toBeGreaterThan(t("Full shot"));
    expect(t("Full shot")).toBeGreaterThan(t("Medium shot"));
  });

  it("frames the figure bigger as the shot gets closer", () => {
    const h = (p: string) => framingFor(p, 0).figureHeight;
    expect(h("Establishing shot")).toBeLessThan(h("Wide shot"));
    expect(h("Wide shot")).toBeLessThan(h("Full shot"));
    expect(h("Full shot")).toBeLessThan(h("Medium shot"));
    expect(h("Medium shot")).toBeLessThan(h("Close-up"));
  });

  it("is a function of the prompt alone — same shot, same framing, anywhere", () => {
    // The property the old `i % 3` version could not have. A shot must not be
    // framed differently because it moved position in the film.
    const a = framingFor("Wide shot of the harbour", 4);
    const b = framingFor("Wide shot of the harbour", 4);
    expect(a).toEqual(b);
    expect(framingFor("Wide shot of the harbour", 0).travel).toBe(
      framingFor("Wide shot of the harbour", 7).travel,
    );
  });
});

describe("pans alternate across MOVING shots only", () => {
  it("sends two consecutive moving shots opposite ways, whatever their sizes", () => {
    expect(panFor("establishing", 0)).toBe("right");
    expect(panFor("establishing", 1)).toBe("left");
    expect(panFor("wide", 0)).toBe("right");
    expect(panFor("wide", 1)).toBe("left");
  });

  it("counts moving shots, not all shots", () => {
    // The point of the movingIndex argument. Locked shots between two pans must
    // not consume an alternation, or a film with a locked shot in between pans
    // the same way twice and reads as a drift.
    const shots = [
      "Establishing shot of the city",
      "Close-up on a hand",
      "Wide shot of the alley",
    ];
    let moving = 0;
    const pans = shots.map((s) => {
      const f = framingFor(s, moving);
      if (isMoving(f)) moving += 1;
      return isMoving(f) ? f.pan : null;
    });
    expect(pans[1]).toBeNull();
    expect(pans[0]).not.toBe(pans[2]);
  });

  it("pushes in rather than sliding on a full shot", () => {
    // Sliding sideways past a figure that nearly fills the frame looks like a
    // mistake; a gentle push does not.
    expect(panFor("full", 0)).toBe("in");
    expect(panFor("full", 1)).toBe("in");
  });
});
