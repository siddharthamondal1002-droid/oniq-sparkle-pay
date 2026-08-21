/**
 * PORTRAIT REFRAME — turn a conditioned still into the production 1080x1920.
 *
 * The 2026-08-21 batch proved that google/gemini-2.5-flash-image conditioned on
 * a reference inherits the reference's ASPECT, not the "9:16" text: landscape
 * owner frames came back ~1344x768, portrait/sheet frames ~864x1184. So a
 * conditioned still has to be reframed to the composition's 1080x1920 — and the
 * owner's rule is absolute: NEVER a blind centre crop that cuts the actor.
 *
 * PURE. Given the source dimensions (and, when a caller can supply it, a subject
 * region), this returns a deterministic plan the worker executes with ffmpeg.
 * The reframe operates on the GENERATED still, never the owner reference asset —
 * the reference stays the untouched identity source.
 *
 * Three strategies, chosen so the actor is never cut:
 *   cover        — the excess dimension is small enough that a centre crop keeps
 *                  most of the frame (portrait-ish sources); safe.
 *   crop-subject — a heavy side crop IS needed, but a subject region is known and
 *                  a target-aspect slice centred on it contains the whole
 *                  subject; the actor-aware win.
 *   pad          — a heavy crop is needed and no safe subject slice exists; the
 *                  whole image is contained in 1080x1920 (letterbox/fill) so
 *                  nothing is cut, and the shot is FLAGGED as a framing
 *                  compromise rather than silently producing a severe crop.
 */

export const PORTRAIT_W = 1080;
export const PORTRAIT_H = 1920;
/** 9:16 as width/height. */
export const PORTRAIT_ASPECT = PORTRAIT_W / PORTRAIT_H;
/**
 * The smallest fraction of the cropped dimension a plain cover crop may keep
 * before it counts as "severe". A portrait 864x1184 keeps 77% (safe); a
 * landscape 1344x768 would keep only 32% (severe → needs subject or pad).
 */
export const SAFE_COVER_KEEP = 0.6;

/** A subject's horizontal placement, as fractions of the source width (0..1). */
export type Subject = {
  /** Centre of the subject, 0 (left) .. 1 (right). */
  cx: number;
  /** Half-width of the subject, as a fraction of source width. */
  halfW: number;
};

export type ReframeStrategy = "cover" | "crop-subject" | "pad";

export type ReframePlan = {
  strategy: ReframeStrategy;
  outputW: number;
  outputH: number;
  /** Crop rect in SOURCE pixels (then scaled to 1080x1920); null for `pad`. */
  crop: { x: number; y: number; w: number; h: number } | null;
  /** True when the whole actor survives the plan. */
  actorPreserved: boolean;
  /** True when the plan is a compromise (pad, or an unusable source). */
  flagged: boolean;
};

/**
 * Plan the reframe of a `srcW x srcH` still to 1080x1920. Pass a `subject` when
 * one is known to unlock the actor-aware crop; without it, a source that needs a
 * heavy crop is padded rather than cut.
 */
export function planPortrait(srcW: number, srcH: number, subject?: Subject): ReframePlan {
  const out = { outputW: PORTRAIT_W, outputH: PORTRAIT_H };
  if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
    return { strategy: "pad", crop: null, actorPreserved: false, flagged: true, ...out };
  }

  const srcAspect = srcW / srcH;

  // Taller than 9:16 → crop top/bottom, keep full width. Always safe.
  if (srcAspect <= PORTRAIT_ASPECT) {
    const cropH = Math.round(srcW / PORTRAIT_ASPECT);
    const y = Math.max(0, Math.round((srcH - cropH) / 2));
    return {
      strategy: "cover",
      crop: { x: 0, y, w: srcW, h: Math.min(cropH, srcH) },
      actorPreserved: true,
      flagged: false,
      ...out,
    };
  }

  // Wider than 9:16 → crop the sides. How much would a centre crop keep?
  const cropW = Math.round(srcH * PORTRAIT_ASPECT);
  const keep = cropW / srcW;
  if (keep >= SAFE_COVER_KEEP) {
    const x = Math.max(0, Math.round((srcW - cropW) / 2));
    return {
      strategy: "cover",
      crop: { x, y: 0, w: Math.min(cropW, srcW), h: srcH },
      actorPreserved: true,
      flagged: false,
      ...out,
    };
  }

  // A severe side crop is needed. Centre the slice on the subject if we can, and
  // only if the whole subject fits inside it.
  if (subject && Number.isFinite(subject.cx) && Number.isFinite(subject.halfW)) {
    const cxPx = subject.cx * srcW;
    const x = Math.max(0, Math.min(srcW - cropW, Math.round(cxPx - cropW / 2)));
    const left = (subject.cx - subject.halfW) * srcW;
    const right = (subject.cx + subject.halfW) * srcW;
    if (left >= x && right <= x + cropW) {
      return {
        strategy: "crop-subject",
        crop: { x, y: 0, w: cropW, h: srcH },
        actorPreserved: true,
        flagged: false,
        ...out,
      };
    }
  }

  // No safe slice: keep the whole image (letterbox/fill), flag the compromise.
  return { strategy: "pad", crop: null, actorPreserved: true, flagged: true, ...out };
}
