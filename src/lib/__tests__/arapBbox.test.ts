/**
 * The bbox normalization boundary — every way a bbox can arrive, and every
 * way it must be refused. Pure function, pure tests.
 */
import { describe, expect, it } from "vitest";

import { normalizeBbox } from "../arapBbox";

const W = { working: { width: 562, height: 1000 }, original: { width: 1080, height: 1920 } };

function ok(r: ReturnType<typeof normalizeBbox>) {
  if (!r.ok) throw new Error(`expected ok, got MALFORMED: ${r.reason}`);
  return r.bbox;
}
function bad(r: ReturnType<typeof normalizeBbox>) {
  if (r.ok) throw new Error(`expected MALFORMED, got ${JSON.stringify(r.bbox)}`);
  return r.reason;
}

describe("accepted representations, converted explicitly", () => {
  it("explicit ltrb {format, values} is the canonical form and is not 'converted'", () => {
    const b = ok(normalizeBbox({ format: "ltrb", values: [100, 200, 200, 300] }, W));
    expect(b.values).toEqual([100, 200, 200, 300]);
    expect(b.from).toEqual({ format: "ltrb", frame: "working", converted: false });
  });
  it("explicit xywh {format, values} converts to ltrb and says so", () => {
    const b = ok(normalizeBbox({ format: "xywh", values: [100, 200, 100, 100] }, W));
    expect(b.values).toEqual([100, 200, 200, 300]);
    expect(b.from.converted).toBe(true);
    expect(b.from.format).toBe("xywh");
  });
  it("named l/t/r/b keys", () => {
    expect(ok(normalizeBbox({ left: 1, top: 2, right: 11, bottom: 22 }, W)).values).toEqual([
      1, 2, 11, 22,
    ]);
  });
  it("named x/y/width/height keys — the shape the first smoke proof emitted", () => {
    expect(ok(normalizeBbox({ x: 1, y: 2, width: 10, height: 20 }, W)).values).toEqual([
      1, 2, 11, 22,
    ]);
  });
  it("a bare array is accepted ONLY with a declared format", () => {
    expect(ok(normalizeBbox([0, 0, 100, 100], W, "ltrb")).values).toEqual([0, 0, 100, 100]);
    expect(ok(normalizeBbox([0, 0, 100, 100], W, "xywh")).values).toEqual([0, 0, 100, 100]);
    expect(ok(normalizeBbox([10, 10, 20, 30], W, "xywh")).values).toEqual([10, 10, 30, 40]);
  });
  it("original-frame coordinates are scaled into the working frame using the dims given", () => {
    // original 1080x1920 -> working 562x1000: sx = 0.5204, sy = 0.5208
    const b = ok(
      normalizeBbox({ format: "ltrb", frame: "original", values: [0, 0, 1080, 1920] }, W),
    );
    expect(b.values).toEqual([0, 0, 562, 1000]);
    expect(b.from).toEqual({ format: "ltrb", frame: "original", converted: true });
  });
  it("floats round to the pixel grid the crop was taken on", () => {
    expect(
      ok(normalizeBbox({ format: "ltrb", values: [10.4, 10.6, 99.5, 200.49] }, W)).values,
    ).toEqual([10, 11, 100, 200]);
  });
});

describe("refused, with a reason — never reinterpreted", () => {
  it("missing", () => {
    expect(bad(normalizeBbox(null, W))).toMatch(/missing/);
    expect(bad(normalizeBbox(undefined, W))).toMatch(/missing/);
  });
  it("ambiguous: a bare array with no declared format", () => {
    expect(bad(normalizeBbox([0, 0, 100, 100], W))).toMatch(/ambiguous/);
  });
  it("ambiguous: an object mixing the two key families", () => {
    expect(bad(normalizeBbox({ left: 0, top: 0, width: 10, height: 10 } as never, W))).toMatch(
      /ambiguous/,
    );
  });
  it("ambiguous: a declared format alongside named keys", () => {
    expect(bad(normalizeBbox({ format: "ltrb", values: [0, 0, 1, 1], x: 0 } as never, W))).toMatch(
      /ambiguous/,
    );
  });
  it("wrong arity", () => {
    expect(bad(normalizeBbox([0, 0, 100], W, "ltrb"))).toMatch(/3 entries/);
    expect(bad(normalizeBbox({ format: "ltrb", values: [0, 0, 1, 1, 1] }, W))).toMatch(/4-number/);
  });
  it("incomplete named keys", () => {
    expect(bad(normalizeBbox({ left: 0, top: 0, right: 5 } as never, W))).toMatch(
      /incomplete l\/t\/r\/b/,
    );
    expect(bad(normalizeBbox({ x: 0, y: 0 } as never, W))).toMatch(/incomplete x\/y\/w\/h/);
  });
  it("unknown format or frame", () => {
    expect(bad(normalizeBbox({ format: "cxcywh" as never, values: [1, 1, 1, 1] }, W))).toMatch(
      /unknown bbox format/,
    );
    expect(
      bad(normalizeBbox({ left: 0, top: 0, right: 5, bottom: 5, frame: "crop" as never }, W)),
    ).toMatch(/unknown bbox frame/);
  });
  it("non-finite values", () => {
    expect(bad(normalizeBbox({ format: "ltrb", values: [0, 0, Number.NaN, 5] }, W))).toMatch(
      /non-finite/,
    );
    expect(
      bad(normalizeBbox({ format: "ltrb", values: [0, 0, Number.POSITIVE_INFINITY, 5] }, W)),
    ).toMatch(/non-finite/);
  });
  it("negative values", () => {
    expect(bad(normalizeBbox({ format: "ltrb", values: [-1, 0, 10, 10] }, W))).toMatch(/negative/);
    expect(bad(normalizeBbox({ x: 0, y: -3, width: 10, height: 10 }, W))).toMatch(/negative/);
  });
  it("inverted or empty", () => {
    expect(bad(normalizeBbox({ format: "ltrb", values: [50, 50, 10, 60] }, W))).toMatch(
      /inverted or empty/,
    );
    expect(bad(normalizeBbox({ format: "ltrb", values: [10, 10, 10, 60] }, W))).toMatch(
      /inverted or empty/,
    );
    expect(bad(normalizeBbox({ x: 0, y: 0, width: 0, height: 10 }, W))).toMatch(
      /non-positive size/,
    );
  });
  it("out of the working image", () => {
    expect(bad(normalizeBbox({ format: "ltrb", values: [0, 0, 563, 10] }, W))).toMatch(
      /exceeds the working image/,
    );
    expect(bad(normalizeBbox({ format: "ltrb", values: [0, 0, 10, 1001] }, W))).toMatch(
      /exceeds the working image/,
    );
  });
  it("original frame without original dims cannot be converted", () => {
    expect(
      bad(
        normalizeBbox(
          { format: "ltrb", frame: "original", values: [0, 0, 10, 10] },
          { working: W.working },
        ),
      ),
    ).toMatch(/no original image dimensions/);
  });
  it("collapses to nothing after rounding", () => {
    expect(bad(normalizeBbox({ format: "ltrb", values: [10.2, 10.2, 10.4, 20] }, W))).toMatch(
      /collapses to zero size/,
    );
  });
});

describe("deterministic", () => {
  it("the same input always yields the same canonical bbox", () => {
    const inputs = [
      { format: "xywh" as const, values: [100.4, 200.6, 99.5, 100] },
      { x: 3, y: 4, width: 5, height: 6 },
      { format: "ltrb" as const, frame: "original" as const, values: [0, 0, 540, 960] },
    ];
    for (const input of inputs) {
      const a = normalizeBbox(input, W);
      const b = normalizeBbox(JSON.parse(JSON.stringify(input)), W);
      expect(a).toEqual(b);
      expect(normalizeBbox(input, W)).toEqual(a);
    }
  });
});
