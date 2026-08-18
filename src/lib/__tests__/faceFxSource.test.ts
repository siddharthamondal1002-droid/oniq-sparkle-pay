/**
 * THE FACE LENSES RAN AND SAW NOBODY, AND NOTHING ACTED ON IT.
 *
 * Five reports on 2026-08-17, one per lens tried (bigeyes, bighead, disguise,
 * tears), every one identical: delegate GPU, fifty consecutive faceless
 * detections, no error thrown, video at readyState 4 with real dimensions.
 * A detector that loads, runs, throws nothing and finds no face on any frame
 * of a call where somebody is plainly sitting in front of the camera.
 *
 * Two things were wrong, and both are guarded here.
 *
 * 1. THE FRAME CAME FROM THE <video>. That put the WebView's video-to-GPU
 *    texture upload inside the pipeline, a step that can hand the model a
 *    black or garbage texture without failing. The draw loop has already
 *    painted that same frame onto a 2D canvas the user can see, so the canvas
 *    is the honest source and the upload step disappears with it.
 *
 * 2. THE GPU DELEGATE HAD NO POST-CONSTRUCTION FALLBACK. faceFx's loader says
 *    in its own comment that an Android WebView "can advertise a context that
 *    then fails — sometimes at construction, sometimes only once inference
 *    runs" and then guards only construction, with a try/catch around
 *    createFromOptions. A delegate that builds fine and thereafter sees
 *    nothing never throws, so it never reaches that catch. The dry counter
 *    existed precisely to make this visible and then no code read it.
 *
 * The dry report also could not distinguish "nobody was in frame" from "the
 * frame was black", which is why five of them yielded no fix — so it now
 * carries what was actually in the pixels.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frameLook } from "@/lib/faceFx";

const ROOT = process.cwd();
const CALL = readFileSync(join(ROOT, "src/components/chat/CallOverlay.tsx"), "utf8");
const FACE = readFileSync(join(ROOT, "src/lib/faceFx.ts"), "utf8");

/** Code only — the notes in both files quote the bug in order to explain it. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const CALL_CODE = strip(CALL);
const FACE_CODE = strip(FACE);

describe("the detector is given the frame the user can see", () => {
  it("detects on the canvas, never on the video element", () => {
    expect(CALL_CODE, "the live detect no longer reads the drawn canvas").toContain(
      "detectForVideo(cur.canvas",
    );
    expect(
      CALL_CODE,
      "the <video> is back as the detect source — the WebView texture upload is in the pipeline again",
    ).not.toContain("detectForVideo(cur.video");
  });

  it("the canvas is still drawn before it is detected on", () => {
    // Detecting on the canvas is only honest if the frame is painted first.
    // If these ever swap, the model reads the PREVIOUS frame every time.
    const drawAt = CALL_CODE.indexOf("ctx.drawImage(cur.video");
    const detectAt = CALL_CODE.indexOf("detectForVideo(cur.canvas");
    expect(drawAt, "the per-frame drawImage is gone").toBeGreaterThan(-1);
    expect(detectAt).toBeGreaterThan(-1);
    expect(detectAt, "detection now runs before the frame is drawn").toBeGreaterThan(drawAt);
  });

  it("face lenses still carry no css, so the detected canvas is untinted", () => {
    // The colour filters set ctx.filter before drawImage. If a face lens ever
    // gains a `css`, the model would be handed a hue-rotated face.
    const lensIds = [...FACE_CODE.matchAll(/^\s{2}(\w+):\s*\(ctx/gm)].map((m) => m[1]);
    expect(lensIds.length, "no face lenses were found to check").toBeGreaterThan(0);
    for (const id of lensIds) {
      const entry = new RegExp(`id:\\s*"${id}"[\\s\\S]{0,200}?\\n\\s{2}\\}`).exec(CALL_CODE)?.[0];
      if (!entry) continue;
      expect(
        entry,
        `face lens ${id} gained a css filter — the model now sees a tinted face`,
      ).not.toContain("css:");
    }
  });
});

describe("a GPU delegate that sees nothing is replaced, once", () => {
  it("the dry counter is acted on, not merely reported", () => {
    expect(
      CALL_CODE,
      "nothing reacts to the dry counter — it is a report with no consequence",
    ).toContain("retryFaceLandmarkerOnCpu()");
    expect(CALL_CODE, "the retry is not gated on the GPU delegate").toContain('delegate === "GPU"');
    expect(CALL_CODE, "the retry is not gated on having not already retried").toContain(
      "!faceCpuRetried()",
    );
  });

  it("the retry builds on CPU in VIDEO mode and swaps the live detector in", () => {
    const fn = /export async function retryFaceLandmarkerOnCpu[\s\S]*?\n\}/.exec(FACE_CODE)?.[0];
    expect(fn, "retryFaceLandmarkerOnCpu is gone").toBeTruthy();
    expect(fn, "the retry is not on the CPU delegate").toContain('delegate: "CPU"');
    expect(fn, "the retry changed running mode out from under a live call").toContain(
      'runningMode: "VIDEO"',
    );
    expect(CALL_CODE, "the rebuilt detector is never installed").toContain(
      "faceRef.current.lm = lm",
    );
  });

  it("retries exactly once per session", () => {
    // A CPU detector that also sees nobody means there was no face. Retrying
    // that on a loop would rebuild a 15 MB runtime every five seconds of call.
    expect(FACE_CODE).toContain("if (cpuRetried) return");
    expect(FACE_CODE).toContain("cpuRetried = true");
  });

  it("clears the counters so the second attempt can speak too", () => {
    // Without this the CPU attempt is silent, and "we tried CPU and it also
    // saw nothing" — the answer that says the camera was pointed at a wall —
    // never reaches the table.
    expect(CALL_CODE).toContain("faceRef.current.dry = 0");
    expect(CALL_CODE).toContain("faceRef.current.said = null");
  });
});

describe("the dry report says what was in the frame", () => {
  it("carries the pixels alongside the counters", () => {
    const report = /"landmarker runs but finds no face",\s*\{[\s\S]*?\}\);/.exec(CALL_CODE)?.[0];
    expect(report, "the dry report is gone").toBeTruthy();
    expect(report, "the report cannot tell a black frame from an empty room").toContain(
      "frameLook(cur.canvas)",
    );
    expect(report, "the report no longer says whether CPU was already tried").toContain("retried");
  });

  /** A canvas stub: getImageData over a caller-supplied RGBA buffer. */
  const fakeCanvas = (w: number, h: number, fill: (i: number) => [number, number, number]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p += 1) {
      const [r, g, b] = fill(p);
      data[p * 4] = r;
      data[p * 4 + 1] = g;
      data[p * 4 + 2] = b;
      data[p * 4 + 3] = 255;
    }
    return {
      width: w,
      height: h,
      getContext: () => ({ getImageData: () => ({ data }) }),
    } as unknown as HTMLCanvasElement;
  };

  it("reads a dead frame as black and flat", () => {
    // The signature of the texture-upload failure: nothing there at all.
    const look = frameLook(fakeCanvas(64, 64, () => [0, 0, 0]));
    expect(look.luma).toBe(0);
    expect(look.spread).toBe(0);
  });

  it("reads a real picture as neither", () => {
    // A frame with actual content: the answer is "there was no face in a
    // perfectly good picture", which is a user pointing the camera elsewhere.
    const look = frameLook(fakeCanvas(64, 64, (i) => [i % 256, (i * 3) % 256, (i * 7) % 256]));
    expect(look.luma).toBeGreaterThan(10);
    expect(look.spread, "a varied frame reported as flat").toBeGreaterThan(50);
  });

  it("never throws on a canvas it cannot read", () => {
    // A diagnostic must not be the thing that ends a call.
    const hostile = {
      width: 8,
      height: 8,
      getContext: () => {
        throw new Error("tainted");
      },
    } as unknown as HTMLCanvasElement;
    expect(() => frameLook(hostile)).not.toThrow();
    expect(frameLook(hostile)).toEqual({ luma: null, spread: null });
  });

  it("returns nulls rather than NaN for a zero-sized canvas", () => {
    expect(frameLook(fakeCanvas(0, 0, () => [0, 0, 0]))).toEqual({ luma: null, spread: null });
  });
});
