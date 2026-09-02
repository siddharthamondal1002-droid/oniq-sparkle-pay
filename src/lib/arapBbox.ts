/**
 * The bbox normalization boundary — ONE canonical representation, entered
 * through one door, with every other shape either converted explicitly or
 * refused.
 *
 * WHY. Two producers of "a bbox" already existed and disagreed:
 * arapProvider.ts's AutorigArtifacts declares `[left, top, right, bottom]`,
 * and the first autorig_smoke.py emitted `{x, y, width, height}`. Passed
 * straight into computeEligibilityMetrics, the object form is destructured as
 * a tuple, every bound comes out undefined, and the artifact is rejected as
 * "invalid bbox". Nothing noticed, because nothing had carried a real artifact
 * across that seam. This module is the seam.
 *
 * CANONICAL: `[l, t, r, b]` in WORKING-image pixels, integers, l < r, t < b,
 * inside the working image. "Working" is the frame autorig_reference.py
 * detects in — the source downsized so its long side is at most 1000 px.
 * The mask and the joints are CROP-LOCAL (origin at the bbox's top-left);
 * that frame is not a bbox frame and is never accepted as one here.
 *
 * FAILS CLOSED, and "ambiguous" is a failure. A bare 4-number array reads
 * equally well as l,t,r,b or x,y,w,h — [0, 0, 100, 100] is both — so it is
 * accepted ONLY when the record declares which. An object is accepted when
 * its keys name one representation and not the other. Anything else is
 * MALFORMED with a reason, and MALFORMED never becomes a measurement.
 */

export type BboxFormat = "ltrb" | "xywh";
export type BboxFrame = "working" | "original";

/** Canonical: working-frame [l, t, r, b], validated. */
export type CanonicalBbox = {
  format: "ltrb";
  frame: "working";
  values: readonly [number, number, number, number];
  /** How the input was read — visible, so no conversion is ever silent. */
  from: { format: BboxFormat; frame: BboxFrame; converted: boolean };
};

export type BboxNormalization =
  { ok: true; bbox: CanonicalBbox } | { ok: false; status: "MALFORMED"; reason: string };

export type ImageDims = { width: number; height: number };

/** What the evidence may carry. Declared shapes only. */
export type BboxEvidence =
  | { format: BboxFormat; frame?: BboxFrame; values: readonly number[] }
  | { left: number; top: number; right: number; bottom: number; frame?: BboxFrame }
  | { x: number; y: number; width: number; height: number; frame?: BboxFrame }
  | readonly number[]
  | null
  | undefined;

const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function malformed(reason: string): BboxNormalization {
  return { ok: false, status: "MALFORMED", reason };
}

/**
 * Read a declared representation out of the evidence WITHOUT interpreting
 * numbers. Returns the four numbers plus the format they were declared in.
 */
function readDeclared(
  input: BboxEvidence,
  declaredFormat: BboxFormat | undefined,
): { format: BboxFormat; frame: BboxFrame; nums: number[] } | { reason: string } {
  if (input == null) return { reason: "missing bbox" };

  if (Array.isArray(input)) {
    if (input.length !== 4) return { reason: `bbox array has ${input.length} entries, need 4` };
    if (!declaredFormat) {
      return {
        reason:
          "ambiguous: a bare 4-number array reads as either l,t,r,b or x,y,w,h and no format was declared",
      };
    }
    return { format: declaredFormat, frame: "working", nums: [...input] as number[] };
  }

  const o = input as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const frame: BboxFrame = o.frame === "original" ? "original" : "working";
  if (has("frame") && o.frame !== "original" && o.frame !== "working") {
    return { reason: `unknown bbox frame "${String(o.frame)}"` };
  }

  // { format, values } — the explicit form the Python writer emits.
  if (has("format") || has("values")) {
    if (o.format !== "ltrb" && o.format !== "xywh")
      return { reason: `unknown bbox format "${String(o.format)}"` };
    if (!Array.isArray(o.values) || o.values.length !== 4)
      return { reason: "bbox.values must be a 4-number array" };
    if (has("left") || has("x") || has("width") || has("right"))
      return { reason: "ambiguous: bbox declares a format AND carries named keys" };
    return { format: o.format, frame, nums: [...(o.values as number[])] };
  }

  const ltrbKeys = ["left", "top", "right", "bottom"].filter(has);
  const xywhKeys = ["x", "y", "width", "height"].filter(has);
  if (ltrbKeys.length > 0 && xywhKeys.length > 0) {
    return {
      reason: `ambiguous: bbox mixes l/t/r/b keys (${ltrbKeys.join(",")}) with x/y/w/h keys (${xywhKeys.join(",")})`,
    };
  }
  if (ltrbKeys.length === 4)
    return { format: "ltrb", frame, nums: [o.left, o.top, o.right, o.bottom] as number[] };
  if (xywhKeys.length === 4)
    return { format: "xywh", frame, nums: [o.x, o.y, o.width, o.height] as number[] };
  if (ltrbKeys.length > 0) return { reason: `incomplete l/t/r/b bbox: have ${ltrbKeys.join(",")}` };
  if (xywhKeys.length > 0) return { reason: `incomplete x/y/w/h bbox: have ${xywhKeys.join(",")}` };
  return { reason: "bbox is an object with no recognised keys" };
}

/**
 * Normalize to the canonical working-frame [l, t, r, b].
 *
 * `working` is required: bounds are checked against it, and an original-frame
 * bbox is scaled into it using `original`. Pure and deterministic — the same
 * input always yields the same output, and it never touches anything else.
 */
export function normalizeBbox(
  input: BboxEvidence,
  dims: { working: ImageDims; original?: ImageDims },
  declaredFormat?: BboxFormat,
): BboxNormalization {
  const read = readDeclared(input, declaredFormat);
  if ("reason" in read) return malformed(read.reason);

  const { format, frame, nums } = read;
  // A plain boolean, not the `fin` type guard: `every(guard)` narrows `nums`
  // to `never` on its false branch and the diagnostic could not read it.
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    return malformed(`non-finite bbox value in ${format}: [${nums.map(String).join(", ")}]`);
  }
  if (nums.some((n) => n < 0))
    return malformed(`negative bbox value in ${format}: [${nums.join(", ")}]`);

  let [l, t, r, b] =
    format === "ltrb" ? nums : [nums[0], nums[1], nums[0] + nums[2], nums[1] + nums[3]];
  if (format === "xywh" && (nums[2] <= 0 || nums[3] <= 0)) {
    return malformed(`non-positive size in x/y/w/h bbox: width ${nums[2]}, height ${nums[3]}`);
  }
  if (r <= l || b <= t) return malformed(`inverted or empty bbox: l=${l} t=${t} r=${r} b=${b}`);

  let converted = false;
  if (frame === "original") {
    const o = dims.original;
    if (!o || !fin(o.width) || !fin(o.height) || o.width <= 0 || o.height <= 0) {
      return malformed(
        "bbox is in the original frame but no original image dimensions were given to convert it",
      );
    }
    const sx = dims.working.width / o.width;
    const sy = dims.working.height / o.height;
    [l, t, r, b] = [l * sx, t * sy, r * sx, b * sy];
    converted = true;
  } else if (format === "xywh") {
    converted = true;
  }

  const w = dims.working;
  if (!fin(w.width) || !fin(w.height) || w.width <= 0 || w.height <= 0) {
    return malformed("working image dimensions are missing or non-positive");
  }
  // Round to the pixel grid the way the crop was taken (autorig rounds the
  // detector's floats), then check bounds on the rounded values.
  const R = (n: number) => Math.round(n);
  const [L, T, Rr, B] = [R(l), R(t), R(r), R(b)];
  if (Rr <= L || B <= T)
    return malformed(`bbox collapses to zero size after rounding: [${L}, ${T}, ${Rr}, ${B}]`);
  if (L < 0 || T < 0 || Rr > w.width || B > w.height) {
    return malformed(
      `bbox [${L}, ${T}, ${Rr}, ${B}] exceeds the working image ${w.width}x${w.height}`,
    );
  }

  return {
    ok: true,
    bbox: {
      format: "ltrb",
      frame: "working",
      values: [L, T, Rr, B],
      from: { format, frame, converted },
    },
  };
}
