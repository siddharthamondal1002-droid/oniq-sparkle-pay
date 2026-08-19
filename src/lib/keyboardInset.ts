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
 * So the same expression is correct with the native padding present (the
 * currently installed build) and with it absent (the pending build).
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
  // 0 means "no trustworthy measurement" and makes consumers fall back to
  // their static height.
  const vvh = zoomed || !usable ? 0 : Math.round(vv.height);
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
    root.style.removeProperty(VAR);
    root.style.removeProperty(VVH);
  };

}
