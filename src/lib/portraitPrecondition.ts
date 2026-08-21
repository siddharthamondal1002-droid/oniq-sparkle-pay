/**
 * PORTRAIT PRECONDITION — reshape an owner reference's CANVAS to 9:16 before it
 * is handed to Gemini, without ever cutting the actor.
 *
 * The 2026-08-21 validation proved two things: (1) owner-asset identity
 * conditioning works, and (2) the conditioned output inherits the REFERENCE's
 * aspect, not the "9:16" prompt text — so a landscape owner frame (1344x768)
 * comes back landscape and the post-render reframe can only letterbox it. This
 * planner attacks the cause instead of the symptom: give Gemini a reference that
 * is ALREADY portrait, so it regenerates the scene into the portrait frame.
 *
 * The rule the owner set is absolute: the actor is never cropped and never
 * regenerated here. We only ADD canvas (background padding / expansion) around
 * the untouched source — the face, hair, clothing and body are byte-for-byte the
 * owner's until Gemini redraws them. This is deterministic image processing, not
 * a second generation. The preconditioned image is a TEMPORARY generation input;
 * the owner asset on disk is never modified.
 *
 * PURE. Given the source dimensions this returns the canvas plan the worker
 * realises with ffmpeg (blurred-fill expansion). Because we only expand, the
 * canvas is always >= the source in both dimensions and the source sits fully
 * inside it — the actor cannot be clipped.
 */

/** 9:16 as width/height — the production portrait aspect. */
export const PRECOND_ASPECT = 1080 / 1920;

export type PreconditionStrategy = "already-portrait" | "pad-portrait" | "skip";

export type PreconditionPlan = {
  strategy: PreconditionStrategy;
  /** The portrait canvas the reference is expanded onto (source px units). */
  canvasW: number;
  canvasH: number;
  /** Where the untouched source sits on that canvas. */
  offsetX: number;
  offsetY: number;
  /** The source content, never scaled down or cropped by the plan. */
  contentW: number;
  contentH: number;
  /** True when the whole actor survives (always true unless the input is junk). */
  actorPreserved: boolean;
  /** True when canvas was expanded (a landscape source); false = already portrait. */
  padded: boolean;
  /** True only for unusable input. */
  flagged: boolean;
};

/**
 * Plan the portrait preconditioning of a `srcW x srcH` owner reference.
 *
 * - A source already at or taller than 9:16 needs nothing added — it conditions
 *   portrait as-is (`already-portrait`).
 * - A landscape source is expanded VERTICALLY to reach 9:16 at full width, the
 *   source centred, the new top/bottom bands filled by the worker — the actor is
 *   fully contained, never cut (`pad-portrait`).
 * - Degenerate input is flagged and skipped rather than reshaped blind.
 */
export function planPrecondition(srcW: number, srcH: number): PreconditionPlan {
  if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
    return {
      strategy: "skip",
      canvasW: 0,
      canvasH: 0,
      offsetX: 0,
      offsetY: 0,
      contentW: 0,
      contentH: 0,
      actorPreserved: false,
      padded: false,
      flagged: true,
    };
  }

  const srcAspect = srcW / srcH;

  // Already portrait (or taller than 9:16): the reference conditions portrait as
  // it is. Nothing added, nothing cut.
  if (srcAspect <= PRECOND_ASPECT) {
    return {
      strategy: "already-portrait",
      canvasW: srcW,
      canvasH: srcH,
      offsetX: 0,
      offsetY: 0,
      contentW: srcW,
      contentH: srcH,
      actorPreserved: true,
      padded: false,
      flagged: false,
    };
  }

  // Landscape / wide: expand the canvas DOWN+UP to 9:16, keep full width, centre
  // the source. Canvas height grows; the source is never scaled or cropped.
  const canvasH = Math.round(srcW / PRECOND_ASPECT);
  const offsetY = Math.max(0, Math.round((canvasH - srcH) / 2));
  return {
    strategy: "pad-portrait",
    canvasW: srcW,
    canvasH,
    offsetX: 0,
    offsetY,
    contentW: srcW,
    contentH: srcH,
    actorPreserved: true,
    padded: true,
    flagged: false,
  };
}
