/**
 * The lens rack, and the one bug that would be blamed on the wrong lens.
 *
 * Every filter here paints onto the SAME canvas context, one after another,
 * inside a draw loop that runs during a live call. A lens that returns having
 * left a transform, a blend mode, an alpha or a clip behind does not break
 * itself — it breaks whichever lens the user picks NEXT, and the report comes
 * back as "the crown is broken" when the fault is in the halo. That failure is
 * close to undebuggable from a bug report, so it is asserted here instead:
 * after every lens, the context must be exactly as it was handed over.
 *
 * The lenses are also checked for being DRAWN AT ALL. A filter that silently
 * paints nothing looks, on a phone, identical to a filter that is switched
 * off, and this rack is big enough now that nobody is going to notice one
 * quiet member of it by eye.
 *
 * WHAT THIS FILE CANNOT SEE is whether a lens looks right — whether the ears
 * sit on the head or beside it. That was checked by rendering all fifteen in
 * headless Chromium over a stand-in face and looking at the result, which is
 * how the hero mask was caught reading as swim goggles (its eye holes were
 * smaller than the eyes). Pixels are reviewed by eye; invariants are reviewed
 * here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FACE_FX, FACE_LENSES, geometryFrom, isFaceFilter, type FaceGeometry } from "@/lib/faceFx";

/** A face at a plausible scale, matching the headless-render harness. */
const GEO: FaceGeometry = {
  leftEye: { x: 95, y: 185 },
  rightEye: { x: 145, y: 185 },
  eyeWidth: 20,
  noseTip: { x: 120, y: 210 },
  headTop: { x: 120, y: 125 },
  chin: { x: 120, y: 275 },
  faceWidth: 120,
  faceHeight: 150,
  tilt: 0,
  mouth: { x: 120, y: 240 },
  mouthLeft: { x: 98, y: 240 },
  mouthRight: { x: 142, y: 240 },
  mouthWidth: 44,
  mouthOpen: 0.06,
  browLeft: { x: 95, y: 168 },
  browRight: { x: 145, y: 168 },
  cheekLeft: { x: 88, y: 222 },
  cheekRight: { x: 152, y: 222 },
};

type Rec = { calls: string[]; depth: number; maxDepth: number };

/**
 * A recording stand-in for CanvasRenderingContext2D.
 *
 * Deliberately not jsdom: jsdom has no canvas at all, and pulling in a native
 * one to check bookkeeping would be a compiled dependency in CI for something
 * a counter answers. The properties are plain fields, so a lens that sets one
 * and does not clear it is visible afterwards — which is the entire point.
 */
function fakeCtx(): { ctx: CanvasRenderingContext2D; rec: Rec } {
  const rec: Rec = { calls: [], depth: 0, maxDepth: 0 };
  const note =
    (name: string) =>
    (...a: unknown[]) => {
      void a;
      rec.calls.push(name);
    };
  const stack: Record<string, unknown>[] = [];
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    lineCap: "butt",
    shadowColor: "transparent",
    shadowBlur: 0,
    save() {
      rec.calls.push("save");
      rec.depth += 1;
      rec.maxDepth = Math.max(rec.maxDepth, rec.depth);
      stack.push({
        globalAlpha: ctx.globalAlpha,
        globalCompositeOperation: ctx.globalCompositeOperation,
        filter: ctx.filter,
        shadowBlur: ctx.shadowBlur,
        shadowColor: ctx.shadowColor,
      });
    },
    restore() {
      rec.calls.push("restore");
      rec.depth -= 1;
      // Mirrors the real restore, or a leak inside a save/restore pair would
      // show up as a leak at the end and the test would be lying about where.
      const s = stack.pop();
      if (s) Object.assign(ctx, s);
    },
    translate: note("translate"),
    rotate: note("rotate"),
    scale: note("scale"),
    beginPath: note("beginPath"),
    closePath: note("closePath"),
    moveTo: note("moveTo"),
    lineTo: note("lineTo"),
    quadraticCurveTo: note("quadraticCurveTo"),
    bezierCurveTo: note("bezierCurveTo"),
    arc: note("arc"),
    ellipse: note("ellipse"),
    rect: note("rect"),
    fill: note("fill"),
    stroke: note("stroke"),
    fillRect: note("fillRect"),
    clip: note("clip"),
    drawImage: note("drawImage"),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rec };
}

/** Big enough that the bounds checks in bigEyes/bigHead do not bail out. */
const CANVAS = { width: 240, height: 340 } as HTMLCanvasElement;

const IDS = Object.keys(FACE_FX);

describe("the face lens rack", () => {
  it("labels exactly the lenses it can paint, and paints exactly the ones it labels", () => {
    // A label with no painter is a chip that does nothing; a painter with no
    // label is a lens nobody can reach. Both are silent.
    expect(new Set(FACE_LENSES.map((l) => l.id))).toEqual(new Set(IDS));
    expect(FACE_LENSES.length).toBe(IDS.length);
    expect(IDS.length).toBeGreaterThanOrEqual(15);
    for (const l of FACE_LENSES) {
      expect(isFaceFilter(l.id), `${l.id} has no painter`).toBe(true);
      expect(l.label.trim().length, `${l.id} has no label`).toBeGreaterThan(0);
    }
  });

  it("is spread into the call chips rather than listed there a second time", () => {
    // The whole point of FACE_LENSES is that there is one list. If someone
    // re-hardcodes the ids into CallOverlay, the two drift apart and the
    // check above goes on passing while the app disagrees with itself.
    const src = readFileSync(join(process.cwd(), "src/components/chat/CallOverlay.tsx"), "utf8");
    const block = src.slice(src.indexOf("const CALL_FILTERS"), src.indexOf("const PHOTO_MIX"));
    expect(block).toContain("...FACE_LENSES");
    for (const id of IDS) {
      expect(
        block.includes(`{ id: "${id}"`),
        `${id} is hardcoded into CALL_FILTERS as well as FACE_LENSES`,
      ).toBe(false);
    }
    // The colour filters and the photo pick stay literal — they are not face
    // lenses and have css/fallback fields the lens list has no place for.
    for (const id of ["none", "alien", "noir", "photo"]) {
      expect(block).toContain(`id: "${id}"`);
    }
  });

  it("is offered in the photo editor too, from the same list", () => {
    const src = readFileSync(join(process.cwd(), "src/components/photo/PhotoStudio.tsx"), "utf8");
    expect(src).toContain("FACE_LENSES.map");
    // Baked into the source bitmap, so crop/rotate/pan/export need no
    // landmark maths. If this stops being true, the preview and the exported
    // file can disagree about where the ears are.
    expect(src).toContain("createImageBitmap(lensBlobRef.current ?? file)");
  });

  for (const id of IDS) {
    describe(id, () => {
      it("draws something", () => {
        const { ctx, rec } = fakeCtx();
        FACE_FX[id](ctx, GEO, CANVAS, 400);
        const painted = rec.calls.filter(
          (c) => c === "fill" || c === "stroke" || c === "drawImage",
        );
        expect(
          painted.length,
          "painted nothing — indistinguishable from being off",
        ).toBeGreaterThan(0);
      });

      it("hands the context back exactly as it got it", () => {
        const { ctx, rec } = fakeCtx();
        FACE_FX[id](ctx, GEO, CANVAS, 400);
        expect(rec.depth, "unbalanced save/restore — the next lens inherits a transform").toBe(0);
        expect(ctx.globalAlpha, "left globalAlpha set — the next lens draws see-through").toBe(1);
        expect(
          ctx.globalCompositeOperation,
          "left a blend mode set — the next lens composites wrong",
        ).toBe("source-over");
        expect(ctx.filter).toBe("none");
      });

      it("never erases the frame underneath", () => {
        // destination-out and friends cut a hole through the composited video
        // rather than through the lens's own art. The hero mask's eye holes
        // are done with path winding for exactly this reason.
        const { ctx, rec } = fakeCtx();
        const seen: string[] = [];
        const probe = new Proxy(ctx, {
          set(t, k, v) {
            if (k === "globalCompositeOperation") seen.push(String(v));
            return Reflect.set(t, k, v);
          },
        });
        FACE_FX[id](probe, GEO, CANVAS, 400);
        void rec;
        for (const mode of seen) {
          expect(mode, `${id} set ${mode}, which erases the video frame`).toBe("source-over");
        }
      });
    });
  }

  it("animates the lenses that should, and only those", () => {
    // A lens whose output depends on the clock is alive; one that does not is
    // a sticker. Both are legitimate — this pins WHICH is which, so a lens
    // does not lose its animation in a refactor without the test noticing.
    const drawAt = (id: string, t: number) => {
      const { ctx, rec } = fakeCtx();
      const args: string[] = [];
      const probe = new Proxy(ctx, {
        get(target, k) {
          const v = Reflect.get(target, k);
          if (typeof v === "function") {
            return (...a: unknown[]) => {
              args.push(
                `${String(k)}(${a.map((n) => (typeof n === "number" ? n.toFixed(2) : "")).join(",")})`,
              );
              return (v as (...x: unknown[]) => unknown).apply(target, a);
            };
          }
          return v;
        },
      });
      FACE_FX[id](probe, GEO, CANVAS, t);
      void rec;
      return args.join("|");
    };
    for (const id of ["hearts", "tears"]) {
      expect(drawAt(id, 0), `${id} ignores the clock — it is a sticker`).not.toBe(drawAt(id, 700));
    }
    for (const id of ["dog", "crown", "shades", "mask"]) {
      expect(drawAt(id, 0), `${id} moves on its own — it should be still`).toBe(drawAt(id, 700));
    }
  });
});

describe("geometryFrom", () => {
  it("refuses a landmark array that is not a face mesh", () => {
    // Short arrays reach here when a detection half-fails; indexing 454 on one
    // would read undefined and paint a lens at NaN, which draws nothing and
    // looks like the filter is broken.
    expect(geometryFrom([], 100, 100)).toBeNull();
    expect(geometryFrom(new Array(200).fill({ x: 0.5, y: 0.5 }), 100, 100)).toBeNull();
  });

  it("measures a mouth open as a fraction of the face, not in pixels", () => {
    // Same expression at two distances from the camera must read the same,
    // or every reactive lens fires when somebody leans in.
    const mesh = (scale: number) =>
      Array.from({ length: 478 }, (_, i) => {
        const at: Record<number, { x: number; y: number }> = {
          234: { x: 0.5 - 0.15 * scale, y: 0.5 },
          454: { x: 0.5 + 0.15 * scale, y: 0.5 },
          13: { x: 0.5, y: 0.5 + 0.02 * scale },
          14: { x: 0.5, y: 0.5 + 0.05 * scale },
        };
        return at[i] ?? { x: 0.5, y: 0.5 };
      });
    const near = geometryFrom(mesh(2), 400, 400);
    const far = geometryFrom(mesh(1), 400, 400);
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    expect(near!.mouthOpen).toBeCloseTo(far!.mouthOpen, 6);
    // And the raw pixel gap really did differ, or the check above is vacuous.
    expect(near!.faceWidth).toBeGreaterThan(far!.faceWidth * 1.9);
  });
});
