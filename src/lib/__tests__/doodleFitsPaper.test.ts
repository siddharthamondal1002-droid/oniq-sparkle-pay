/**
 * THE WALLPAPER HAS TO FIT ON THE PAPER.
 *
 * Reported 2026-08-18 from screenshots: a dark band down the right-hand side of
 * the chat, with bubbles clipped against it. The cause was the doodle scatter,
 * not the bubbles — figures were being placed at up to 67% of the column with a
 * width of up to 171px, which on the shell's 448px column lands 23px past the
 * right edge.
 *
 * That overflow became visible rather than harmless because the scroller sets
 * `overflow-y: auto`, and CSS computes the OTHER axis to `auto` the moment one
 * axis is not `visible` — so the thread was quietly scrollable sideways.
 *
 * This is a behavioural test, not a string grep: it runs the real placement
 * function over many seeds and checks the geometry. A future tweak to the
 * offsets or sizes that reintroduces overflow fails here with the seed that
 * broke it, which is the thing a grep could never tell you.
 */
import { describe, expect, it } from "vitest";
import { doodleScatter } from "@/data/doodleLibrary";

/**
 * The shell caps the app at max-w-md on a phone. That is the narrowest — and so
 * the worst-case — column the wallpaper has to fit inside.
 */
const COLUMN_PX = 448;

describe("no doodle runs off the right edge of the thread", () => {
  it("holds across a wide spread of conversation ids", () => {
    const offenders: string[] = [];
    for (let i = 0; i < 400; i += 1) {
      const seed = `conversation-${i}`;
      for (const d of doodleScatter(seed)) {
        // `start` is a percentage of the column; `size` is the figure's height,
        // and the figures are roughly square, so height is a fair proxy for the
        // width it occupies.
        const right = (d.start / 100) * COLUMN_PX + d.size;
        if (right > COLUMN_PX) {
          offenders.push(
            `${seed}/${d.key}: start ${d.start}% + ${d.size}px = ${Math.round(right)}px > ${COLUMN_PX}px`,
          );
        }
      }
    }
    expect(
      offenders.slice(0, 5),
      `${offenders.length} doodle placements overflow the column`,
    ).toEqual([]);
  });

  it("still scatters — the fix must not collapse every figure to the left", () => {
    // A cheap way to make the test above pass would be to pin every figure at
    // start: 0, which would look like a stripe rather than a scatter. The
    // wallpaper is supposed to cross the page.
    const starts = new Set<number>();
    for (let i = 0; i < 60; i += 1) {
      for (const d of doodleScatter(`seed-${i}`)) starts.add(Math.round(d.start));
    }
    expect(starts.size, "the scatter collapsed to a single column").toBeGreaterThan(8);
    expect(Math.max(...starts), "nothing is placed on the right half any more").toBeGreaterThan(35);
  });

  it("the scroller clips sideways, so an overflow can never be visible again", () => {
    // Belt and braces: the geometry above keeps the wallpaper on the paper, and
    // this keeps ANY future overflow — a wide bubble, a long code block, an
    // unbroken URL — from turning the thread into a sideways scroller.
    //
    // `clip` and not `hidden`: `hidden` would make this a scroll container on
    // both axes and break the sticky doodle layer inside it.
    const src = new URL(
      "../../routes/_authenticated/app.chat.$conversationId.tsx",
      import.meta.url,
    );
    const chat = require("node:fs").readFileSync(src, "utf8") as string;
    expect(chat).toContain("overflow-y-auto overflow-x-clip");
    expect(chat, "overflow-x-hidden would break the sticky wallpaper layer").not.toContain(
      "overflow-y-auto overflow-x-hidden",
    );
  });
});
