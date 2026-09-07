/**
 * THE ROWS IN THIS FILE ARE MEASURED, NOT INVENTED.
 *
 * Every one of them is a real `client_error_reports` row, surface
 * `chat-viewport`, read off production 2026-09-07 — the probe that
 * app.chat.$conversationId.tsx has been writing since 2026-08-24. 39 rows, 7
 * users, newest 2026-09-07 02:24.
 *
 * That matters because this exact layout has now been "fixed" four times, and
 * every previous fix was proved against a fixture written by whoever was
 * fixing it. This repo has the receipt for what that costs: the UPI passes
 * were "proved" against a QR nobody had ever scanned, and the real QR's bytes
 * implied a different defect entirely.
 *
 * WHAT THE ROWS SAY. The keyboard is subtracted TWICE on the devices that
 * break, and the arithmetic is visible without any model of the WebView:
 *
 *     screenH 832  docH 560  kb 272   832 - 560 = 272 = kb
 *                  vvH 288            560 - 272 = 288 = vvH
 *
 * The window is a keyboard shorter than the screen — it already sits above
 * the IME — and the visual viewport then reports the same keyboard occluding
 * what is left. `--vvh` published 288 where 560 was actually visible, and the
 * message list came out 115px tall with 272px of dead band beneath it.
 *
 * THE CONTROL IS THE ROW THAT WAS ALREADY RIGHT. Ten seconds before that
 * second row, the same device reported docH 850 on an 851px screen: the
 * layout viewport had NOT shrunk, the keyboard really was over the window,
 * and vvH 548 was correct. A fix that raises the broken rows by blanket-
 * preferring docH would wreck that one — the composer would sit behind the
 * keyboard. So it is asserted to come back BYTE-IDENTICAL to what the old
 * code produced, and it is what makes this a discriminator rather than a
 * fifth guess.
 */
import { describe, expect, it } from "vitest";
import { visibleHeight } from "@/lib/keyboardInset";

/**
 * A recorded frame. `screenH` is present only where the probe captured it;
 * `base` is the layout-viewport height with no keyboard up, which is what
 * keyboardInset.ts observes on an unoccluded frame.
 */
type Row = {
  what: string;
  screenH: number;
  base: number;
  docH: number;
  vvH: number;
  vvTop: number;
  /** measured header + composer, i.e. colH - scrollerH from the same row */
  chrome: number;
  /** measured env(safe-area-inset-top), i.e. vvH - colH from the same row */
  safeTop: number;
  /** the message list height the owner actually got */
  scrollerWas: number;
};

/**
 * The three rows where the probe captured `screen.height`, so the baseline is
 * measured rather than reconstructed. Two broken, one correct.
 */
const MEASURED: Row[] = [
  {
    what: "SM-A176B, Android 16, 2026-09-07 02:24 — the newest row",
    screenH: 832,
    base: 832,
    docH: 560,
    vvH: 288,
    vvTop: 0,
    chrome: 252 - 115,
    safeTop: 288 - 252,
    scrollerWas: 115,
  },
  {
    what: "25098RA98I, Android 16, 2026-09-06 19:31:39 — the worst row",
    screenH: 851,
    base: 851,
    docH: 518,
    vvH: 186,
    vvTop: 16,
    chrome: 140 - 20,
    safeTop: 186 - 140,
    scrollerWas: 20,
  },
];

/** The control: same device, ten seconds earlier, layout viewport NOT shrunk. */
const CONTROL: Row = {
  what: "25098RA98I, 2026-09-06 19:31:29 — keyboard over a full-height window",
  screenH: 851,
  base: 851,
  docH: 850,
  vvH: 548,
  vvTop: 0,
  chrome: 502 - 365,
  safeTop: 548 - 502,
  scrollerWas: 365,
};

const frame = (r: Row) => ({
  docH: r.docH,
  vvH: r.vvH,
  vvTop: r.vvTop,
  baseDocH: r.base,
  zoomed: false,
});

describe("the keyboard is subtracted exactly once", () => {
  it("has rows to run at all, so this cannot pass vacuously", () => {
    expect(MEASURED.length).toBeGreaterThanOrEqual(2);
  });

  for (const r of MEASURED) {
    it(`${r.what}: the window already moved, so docH is what is visible`, () => {
      // The premise, restated as an assertion so the row cannot drift: the
      // layout viewport is a keyboard shorter than the screen AND the visual
      // viewport is a keyboard shorter than that.
      const nativeTook = r.screenH - r.docH;
      const occluded = r.docH - r.vvH - r.vvTop;
      expect(nativeTook, "the window did not lose a keyboard").toBeGreaterThan(100);
      expect(occluded, "the visual viewport did not lose one too").toBeGreaterThan(100);

      expect(visibleHeight(frame(r))).toBe(r.docH);
    });

    it(`${r.what}: the message list stops collapsing`, () => {
      const column = visibleHeight(frame(r)) - r.safeTop;
      const scroller = column - r.chrome;
      // Not a magic number: the old value is what the owner photographed.
      expect(scroller).toBeGreaterThan(r.scrollerWas);
      // A thread you can actually read. The worst measured row goes 20 -> 352.
      expect(scroller).toBeGreaterThan(240);
    });
  }

  it(`${CONTROL.what}: unchanged, because it was already correct`, () => {
    const nativeTook = CONTROL.screenH - CONTROL.docH;
    expect(nativeTook, "the control's window DID shrink — it is not a control").toBeLessThan(100);

    // Byte-identical to what the previous code published for this frame.
    expect(visibleHeight(frame(CONTROL))).toBe(CONTROL.vvH);
    const scroller = CONTROL.vvH - CONTROL.safeTop - CONTROL.chrome;
    expect(scroller).toBe(CONTROL.scrollerWas);
  });

  it("never claims more room than the layout viewport has", () => {
    for (const r of [...MEASURED, CONTROL]) {
      expect(visibleHeight(frame(r))).toBeLessThanOrEqual(r.docH);
    }
  });
});

describe("the degenerate readings that produced three bogus probe rows", () => {
  it("a zero-height visual viewport is the absence of a measurement", () => {
    // 2026-08-18: vv.height 0 with innerHeight 211 on an 832px screen, three
    // byte-identical rows. 0 means consumers keep their static height.
    expect(visibleHeight({ docH: 211, vvH: 0, vvTop: 0, baseDocH: 832, zoomed: false })).toBe(0);
  });

  it("a pinch-zoomed viewport describes the magnifier, not the keyboard", () => {
    expect(visibleHeight({ docH: 832, vvH: 400, vvTop: 0, baseDocH: 832, zoomed: true })).toBe(0);
  });

  it("with no baseline yet, it behaves exactly as it did before", () => {
    // Mounting with the IME already up. baseDocH is 0, so there is nothing to
    // compare against and vv.height is used — today's behaviour, never worse.
    const r = MEASURED[1];
    expect(visibleHeight({ ...frame(r), baseDocH: 0 })).toBe(r.vvH);
  });
});

describe("a window the manager resized is not a keyboard", () => {
  it("split-screen with no keyboard keeps using the visual viewport", () => {
    // The reason the baseline is observed rather than read off screen.height:
    // here the window is less than half the display and NO keyboard is up, so
    // preferring docH would be right by luck. Once a keyboard does come up in
    // that window, the baseline is the window's own height and the answer
    // stays vv.height — the composer stays above the IME.
    const half = { docH: 400, vvH: 400, vvTop: 0, baseDocH: 400, zoomed: false };
    expect(visibleHeight(half)).toBe(400);
    expect(visibleHeight({ ...half, vvH: 130 })).toBe(130);
  });
});
