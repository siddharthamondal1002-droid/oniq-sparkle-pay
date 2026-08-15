/**
 * Face-tracked call filters — the landmark half.
 *
 * SEPARATE FILE ON PURPOSE. CallOverlay is already the largest component in
 * the app and owns signalling, media, peers and the draw loop; face tracking
 * is a self-contained "here are some points, here is how to paint on them"
 * problem that does not need any of that context. It also means the MediaPipe
 * import lives behind one dynamic import in one place, which is what keeps it
 * out of the main bundle.
 *
 * NOTHING HERE IS LOADED UNTIL A FACE FILTER IS CHOSEN. The runtime is ~11 MB
 * of WebAssembly and the model is another 3.7 MB. Every user of every video
 * call must not pay for that, so the import, the fileset and the model are all
 * fetched on first use and cached for the rest of the session.
 *
 * SELF-HOSTED, NOT CDN. The wasm and the .task model are served from our own
 * origin (public/mediapipe, public/face_landmarker.task). A third-party CDN in
 * the middle of a live call is a dependency that can be slow, blocked or
 * offline exactly when someone is mid-conversation, and it would hand a
 * request log of who is on a call to someone else.
 */

/** One landmark, normalised 0..1 against the frame. */
export type Pt = { x: number; y: number };

/** What the draw code actually needs, resolved to canvas pixels. */
export type FaceGeometry = {
  leftEye: Pt;
  rightEye: Pt;
  eyeWidth: number;
  noseTip: Pt;
  headTop: Pt;
  faceWidth: number;
  /** Roll of the head in radians, from the line between the eyes. */
  tilt: number;
};

/**
 * MediaPipe's 478-point mesh, by the handful of indices this file uses.
 * Named because `lm[263]` in the middle of a draw call is unreadable and
 * unverifiable — these are the documented canonical positions.
 */
const IDX = {
  leftEyeOuter: 33,
  leftEyeInner: 133,
  rightEyeInner: 362,
  rightEyeOuter: 263,
  noseTip: 1,
  headTop: 10,
  faceLeft: 234,
  faceRight: 454,
} as const;

type Landmarker = {
  detectForVideo(video: HTMLVideoElement, ts: number): { faceLandmarks: Pt[][] };
  close(): void;
};

let landmarkerPromise: Promise<Landmarker | null> | null = null;

/**
 * Load the face landmarker once per session.
 *
 * Returns null rather than throwing when anything in the chain fails — an old
 * WebView with no WebAssembly, a blocked fetch, a model that did not deploy.
 * A face filter that cannot run must degrade to an unfiltered call, never to a
 * broken one: the person is in a conversation.
 */
export async function loadFaceLandmarker(): Promise<Landmarker | null> {
  if (landmarkerPromise) return landmarkerPromise;
  landmarkerPromise = (async () => {
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks("/mediapipe");
      const lm = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/face_landmarker.task", delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        // The iris points cost accuracy we do not need — the eye CORNERS are
        // what size and place these effects, and they are in the base mesh.
        outputFaceBlendshapes: false,
      });
      return lm as unknown as Landmarker;
    } catch (e) {
      console.warn("[faceFx] landmarker unavailable", e);
      return null;
    }
  })();
  return landmarkerPromise;
}

/** True once a load has been attempted and failed — the UI can say so. */
export function faceFxFailed(): Promise<boolean> {
  return (landmarkerPromise ?? Promise.resolve(null)).then((l) => l === null);
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Turn a raw landmark array into the handful of measurements the art needs. */
export function geometryFrom(lm: Pt[], w: number, h: number): FaceGeometry | null {
  if (!lm || lm.length < 468) return null;
  const px = (p: Pt): Pt => ({ x: p.x * w, y: p.y * h });
  const lOut = px(lm[IDX.leftEyeOuter]);
  const lIn = px(lm[IDX.leftEyeInner]);
  const rIn = px(lm[IDX.rightEyeInner]);
  const rOut = px(lm[IDX.rightEyeOuter]);
  const leftEye = mid(lOut, lIn);
  const rightEye = mid(rIn, rOut);
  return {
    leftEye,
    rightEye,
    eyeWidth: Math.max(8, dist(lOut, lIn)),
    noseTip: px(lm[IDX.noseTip]),
    headTop: px(lm[IDX.headTop]),
    faceWidth: Math.max(24, dist(px(lm[IDX.faceLeft]), px(lm[IDX.faceRight]))),
    tilt: Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x),
  };
}

/**
 * Enlarge both eyes by re-drawing each eye region scaled up over itself.
 *
 * A PIXEL WARP WOULD COST THE CALL. Displacing every pixel through
 * getImageData/putImageData is hundreds of thousands of operations per frame
 * on the main thread, at 20fps, while WebRTC is encoding — the phone would
 * drop frames on the video that matters to keep up with the joke. Two extra
 * drawImage calls of a small square are done by the compositor instead, and
 * the result reads the same at call resolution.
 */
function bigEyes(ctx: CanvasRenderingContext2D, g: FaceGeometry, canvas: HTMLCanvasElement): void {
  const r = g.eyeWidth * 0.95;
  const scale = 1.7;
  for (const eye of [g.leftEye, g.rightEye]) {
    const sx = eye.x - r;
    const sy = eye.y - r;
    const size = r * 2;
    if (sx < 0 || sy < 0 || sx + size > canvas.width || sy + size > canvas.height) continue;
    const out = size * scale;
    ctx.save();
    // Circular clip, or the square edges of the copied patch show as a box.
    ctx.beginPath();
    ctx.arc(eye.x, eye.y, (out / 2) * 0.92, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(canvas, sx, sy, size, size, eye.x - out / 2, eye.y - out / 2, out, out);
    ctx.restore();
  }
}

/** Ears, nose and tongue, hung off the landmarks and rolled with the head. */
function dogFace(ctx: CanvasRenderingContext2D, g: FaceGeometry): void {
  const w = g.faceWidth;
  ctx.save();
  ctx.translate(g.headTop.x, g.headTop.y);
  ctx.rotate(g.tilt);

  // Ears: rounded triangles either side of the crown.
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * w * 0.42, w * 0.02);
    ctx.rotate(side * 0.35);
    ctx.beginPath();
    ctx.moveTo(0, -w * 0.34);
    ctx.quadraticCurveTo(side * w * 0.2, 0, 0, w * 0.28);
    ctx.quadraticCurveTo(-side * w * 0.14, 0, 0, -w * 0.34);
    ctx.fillStyle = "#6b4423";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -w * 0.2);
    ctx.quadraticCurveTo(side * w * 0.1, 0, 0, w * 0.16);
    ctx.quadraticCurveTo(-side * w * 0.06, 0, 0, -w * 0.2);
    ctx.fillStyle = "#c98a5b";
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // Nose: an ellipse on the nose tip, rolled the same way.
  ctx.save();
  ctx.translate(g.noseTip.x, g.noseTip.y);
  ctx.rotate(g.tilt);
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.1, w * 0.075, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#1a1a1a";
  ctx.fill();
  // A highlight, because a flat black blob reads as a smudge on the lens.
  ctx.beginPath();
  ctx.ellipse(-w * 0.03, -w * 0.025, w * 0.025, w * 0.018, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fill();
  ctx.restore();
}

/** Sunglasses across the eye line, sized and rolled from the geometry. */
function shades(ctx: CanvasRenderingContext2D, g: FaceGeometry): void {
  const w = g.faceWidth;
  const centre = mid(g.leftEye, g.rightEye);
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(g.tilt);
  const lensR = g.eyeWidth * 0.85;
  const gap = dist(g.leftEye, g.rightEye) / 2;
  ctx.fillStyle = "rgba(10,10,14,0.92)";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * gap, 0, lensR, lensR * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(10,10,14,0.92)";
  ctx.lineWidth = Math.max(2, w * 0.02);
  ctx.beginPath();
  ctx.moveTo(-gap + lensR, 0);
  ctx.lineTo(gap - lensR, 0);
  ctx.stroke();
  ctx.restore();
}

/** The face-tracked filters, by id. Ids are shared with CALL_FILTERS. */
export const FACE_FX: Record<
  string,
  (ctx: CanvasRenderingContext2D, g: FaceGeometry, canvas: HTMLCanvasElement) => void
> = {
  bigeyes: (ctx, g, canvas) => bigEyes(ctx, g, canvas),
  dog: (ctx, g, canvas) => {
    void canvas;
    dogFace(ctx, g);
  },
  shades: (ctx, g, canvas) => {
    void canvas;
    shades(ctx, g);
  },
};

/** Whether an id needs the landmarker running at all. */
export function isFaceFilter(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(FACE_FX, id);
}
