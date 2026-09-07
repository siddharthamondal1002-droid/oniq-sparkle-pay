/**
 * THE KEYBOARD INSET IS MEASURED, NEVER MODELLED.
 *
 * Every previous attempt at this (see chatKeyboardFit.test.ts for the full
 * history) computed the keyboard from a model of how the Android WebView
 * handles the IME — from insets, from decor height, from 100dvh arithmetic —
 * and every one of those models was wrong on at least one build.
 *
 * This module reads the one number that is true whatever combination of
 * subtractions produced it: how much of the LAYOUT viewport
 * (document.documentElement.clientHeight) is not currently VISIBLE
 * (visualViewport.height, offset by visualViewport.offsetTop).
 *
 *     inset = clientHeight - vv.height - vv.offsetTop
 *
 * Its self-correcting property is the point:
 *
 *   - If some layer below us has ALREADY shrunk the layout viewport for the
 *     keyboard (native IME padding on the content view, or Chromium's
 *     interactive-widget resize), then clientHeight has lost the keyboard too
 *     and this difference is ~0. Nothing is subtracted a second time.
 *   - If nothing below us shrank the layout viewport, clientHeight is full
 *     height, the visual viewport is not, and the difference IS the keyboard.
 *     It gets subtracted exactly once, here.
 *
 * THAT SELF-CORRECTING PROPERTY IS FALSE ON REAL DEVICES, and the probe rows
 * say so in arithmetic rather than in theory. 39 of them, 7 users, newest
 * 2026-09-07 02:24. Two representative rows, every number measured:
 *
 *     screenH 832  docH 560  kb 272  vvTop 0   vvH 288
 *                  832 - 560 = 272 = kb   AND   560 - 272 = 288 = vvH
 *     screenH 851  docH 518  kb 316  vvTop 16  vvH 186
 *                  851 - 518 = 333 ~ kb   AND   518 - 316 - 16 = 186 = vvH
 *
 * THE KEYBOARD APPEARS TWICE IN EVERY ROW. The layout viewport has already
 * lost it — the WebView physically sits above the keyboard — and the visual
 * viewport reports the SAME keyboard occluding what is left. So the
 * difference is not ~0 in the "already shrunk" case; it is a full keyboard,
 * and `--vvh` published a height a keyboard smaller than the space that
 * actually exists. The chat column took it, and the message list came out at
 * 20-115px with a keyboard-tall dead band below it.
 *
 * WHICH IS WHY THE DISCRIMINATOR CANNOT BE READ OFF ONE FRAME. Occlusion
 * alone cannot tell "the keyboard is over the window" from "the window
 * already moved and the keyboard is being reported anyway" — both give the
 * same `docH - vvH - vvTop`. What separates them is whether the LAYOUT
 * viewport itself shrank, and that needs the keyboard-down height to compare
 * against. Hence `baseDocH`.
 *
 * `screen.height` looks like the same signal and is not: in split-screen or a
 * freeform window it exceeds the window by far more than a keyboard with no
 * keyboard present, and sizing to docH there would put the composer behind
 * the IME. The observed baseline has no such failure — it is this window's
 * own height, whatever the window manager did to it.
 *
 * Performance: `visualViewport` fires `resize` and `scroll` at animation
 * frequency while the IME animates, and the chat list is being virtualised in
 * parallel. So updates are coalesced into a single requestAnimationFrame, the
 * frame writes ONE CSS custom property and reads no layout after writing, and
 * an unchanged value writes nothing at all.
 */

const VAR = "--kb-inset";
/**
 * --vvh: the height that is ACTUALLY VISIBLE right now, in px.
 *
 * AMENDED 2026-08-19 after a device screenshot showed the thread squeezed to a
 * strip with a keyboard-tall dead band beneath it — again. Every composed
 * expression (`100dvh - --kb-inset`) depends on knowing which layer already
 * subtracted the keyboard, and on a real device that guess was wrong once
 * more: dvh had lost the keyboard AND --kb-inset measured it, so it went twice.
 *
 * --vvh cannot double-subtract, because it is not a subtraction: it is the
 * visible height itself, whatever produced it (native padding, a Chromium
 * layout resize, overlays-content, or nothing at all). A screen that wants to
 * fit above the keyboard uses this and stops reasoning about the keyboard.
 */
const VVH = "--vvh";

/** Last published values, so an unchanged frame does no work. */
let published = -1;
let publishedVvh = -1;

/**
 * Smaller than any IME and larger than any rounding wobble or URL bar.
 *
 * Used for two different questions — "is a keyboard occluding the visual
 * viewport" and "did the layout viewport itself lose a keyboard" — because
 * both are asking whether a gap is keyboard-sized. The measured keyboards
 * across the probe rows run 272-372px; the largest non-keyboard gap seen is
 * 16px of `vvTop`.
 */
const KEYBOARD_MIN = 100;

/**
 * The height that is genuinely visible, given one frame's measurements and
 * the layout-viewport height last seen with no keyboard up.
 *
 * Pure so it can be tested against the recorded device rows rather than
 * reasoned about — see keyboardVisibleHeight.test.ts, which runs every one of
 * them. Returns 0 for "no trustworthy measurement", which makes consumers
 * fall back to their static height.
 */
export function visibleHeight(m: {
  docH: number;
  vvH: number;
  vvTop: number;
  baseDocH: number;
  zoomed: boolean;
}): number {
  if (m.zoomed || !(m.vvH > 0) || !(m.docH > 0)) return 0;
  // How much of the LAYOUT viewport some layer below us already took. A
  // keyboard's worth means the window itself moved above the IME.
  const nativeTook = m.baseDocH > 0 ? Math.max(0, m.baseDocH - m.docH) : 0;
  // The window is already above the keyboard, so the visual viewport's report
  // of that same keyboard is the second subtraction. docH IS the visible area.
  if (nativeTook > KEYBOARD_MIN) return Math.round(m.docH);
  // Nothing below us moved: the keyboard really is over the window, and
  // vv.height is what is left of it. Subtracted exactly once, here.
  return Math.round(m.vvH);
}

/**
 * The layout viewport's height with nothing occluding it, for THIS window.
 *
 * Re-read on every unoccluded frame rather than latched, so a rotation, a
 * split-screen drag or a foldable unfolding replaces it for free — each of
 * those changes docH while no keyboard is up.
 *
 * 0 until the first such frame. Chat mounts with the keyboard down, so that
 * is the mount frame in the ordinary flow; a mount that somehow starts with
 * the IME already up falls through to `vv.height`, which is exactly today's
 * behaviour. Never worse than before, and self-corrects the moment the
 * keyboard is dismissed once.
 */
let baseDocH = 0;

function measure(): { inset: number; vvh: number } {
  const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
  // No API (older WebViews, SSR, tests) means no keyboard term at all. The
  // layout has to be correct with the variables simply absent.
  if (!vv) return { inset: 0, vvh: 0 };

  // A pinch-zoomed visual viewport describes the magnifier, not the keyboard.
  // Without this the chat column collapses by up to half the screen on a pan.
  const zoomed = vv.scale > 1.01;

  const docH = document.documentElement.clientHeight;
  // vv.height of exactly 0 is the absence of a measurement, not a keyboard
  // filling the screen — the WebView reports it before the view is measured.
  const usable = vv.height > 0 && docH > 0;
  const raw = Math.max(0, docH - vv.height - vv.offsetTop);
  // A real IME takes roughly a third of the screen. One that takes nine
  // tenths is a measurement failure wearing a keyboard's clothes.
  const plausible = usable && raw < docH * 0.9;
  const inset = zoomed || !plausible ? 0 : Math.round(raw);

  // Nothing is occluding the visual viewport, so whatever the layout viewport
  // is right now IS this window's full height. Only trustworthy readings
  // update it — a degenerate frame must not poison the baseline.
  if (usable && !zoomed && raw <= KEYBOARD_MIN) baseDocH = docH;

  const vvh = visibleHeight({ docH, vvH: vv.height, vvTop: vv.offsetTop, baseDocH, zoomed });
  return { inset, vvh };
}

/**
 * Start publishing `--kb-inset` on the document element. Returns a cleanup
 * that removes both the listeners and the variable.
 */
export function startKeyboardInsetTracking(): () => void {
  if (typeof window === "undefined") return () => {};
  const vv = window.visualViewport;
  const root = document.documentElement;
  let raf = 0;

  const apply = () => {
    raf = 0;
    // READ everything first...
    const next = measure();
    // ...then WRITE, and read nothing afterwards in this frame.
    if (next.inset !== published) {
      published = next.inset;
      root.style.setProperty(VAR, `${next.inset}px`);
    }
    if (next.vvh !== publishedVvh) {
      publishedVvh = next.vvh;
      // 0 = no trustworthy measurement: remove it so the CSS fallback applies.
      if (next.vvh > 0) root.style.setProperty(VVH, `${next.vvh}px`);
      else root.style.removeProperty(VVH);
    }
  };

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(apply);
  };

  // Both listeners are required: iOS often moves offsetTop and fires `scroll`
  // without ever firing `resize`.
  vv?.addEventListener("resize", schedule);
  vv?.addEventListener("scroll", schedule);
  schedule();

  return () => {
    vv?.removeEventListener("resize", schedule);
    vv?.removeEventListener("scroll", schedule);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    published = -1;
    publishedVvh = -1;
    // The baseline belongs to a window configuration, not to the app. Keeping
    // it across an unmount would compare the next mount's docH against a
    // height measured in some other window.
    baseDocH = 0;
    root.style.removeProperty(VAR);
    root.style.removeProperty(VVH);
  };
}
