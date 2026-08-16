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
  /** Centre of the mouth, between the inner lips. */
  mouth: Pt;
  mouthLeft: Pt;
  mouthRight: Pt;
  mouthWidth: number;
  /**
   * How far the mouth is open, as a fraction of face width. Roughly 0 closed,
   * ~0.12 mid-speech, ~0.3 on a yawn. Lenses that REACT — flames from an open
   * mouth, a dropped jaw — key off this, and it is the one measurement that
   * makes a lens feel alive rather than stuck on.
   */
  mouthOpen: number;
  chin: Pt;
  browLeft: Pt;
  browRight: Pt;
  cheekLeft: Pt;
  cheekRight: Pt;
  /** Crown to chin, in pixels. */
  faceHeight: number;
};

/**
 * MediaPipe's 478-point mesh, by the handful of indices this file uses.
 * Named because `lm[263]` in the middle of a draw call is unreadable and
 * unverifiable — these are the documented canonical positions.
 *
 * LEFT AND RIGHT ARE THE IMAGE'S, not the subject's. The mesh numbers them
 * from the face's own point of view, so the subject's left eye appears on the
 * right of an unmirrored frame. Every name here follows what the DRAW CODE
 * sees, because that code is placing art on a picture; a lens that paints the
 * left cheek needs the cheek on the left of the canvas. The two conventions
 * disagree by a mirror, and mixing them is how a lens ends up subtly, and then
 * inexplicably, backwards.
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
  mouthLeft: 61,
  mouthRight: 291,
  lipUpperInner: 13,
  lipLowerInner: 14,
  chin: 152,
  browLeft: 105,
  browRight: 334,
  cheekLeft: 50,
  cheekRight: 280,
} as const;

type Landmarker = {
  detectForVideo(video: HTMLVideoElement, ts: number): { faceLandmarks: Pt[][] };
  close(): void;
};

/** The still-image counterpart — one shot, no timestamp. */
type StillLandmarker = {
  detect(image: CanvasImageSource): { faceLandmarks: Pt[][] };
  close(): void;
};

let landmarkerPromise: Promise<Landmarker | null> | null = null;
let stillPromise: Promise<StillLandmarker | null> | null = null;
/**
 * The resolved wasm fileset, shared by both landmarkers.
 *
 * This is the ~11 MB half. The live-call detector and the photo-editor
 * detector are separate instances because MediaPipe fixes runningMode at
 * construction and a call must never have its mode changed out from under it
 * by someone opening the photo editor — but there is no reason for them to
 * fetch and compile the runtime twice.
 */
let filesetPromise: Promise<unknown> | null = null;

async function visionFileset() {
  const vision = await import("@mediapipe/tasks-vision");
  if (!filesetPromise) filesetPromise = vision.FilesetResolver.forVisionTasks("/mediapipe");
  return { vision, fileset: await filesetPromise };
}

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
      const { vision, fileset } = await visionFileset();
      const lm = await vision.FaceLandmarker.createFromOptions(
        fileset as Parameters<typeof vision.FaceLandmarker.createFromOptions>[0],
        {
          baseOptions: { modelAssetPath: "/face_landmarker.task", delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          // The iris points cost accuracy we do not need — the eye CORNERS are
          // what size and place these effects, and they are in the base mesh.
          outputFaceBlendshapes: false,
        },
      );
      return lm as unknown as Landmarker;
    } catch (e) {
      console.warn("[faceFx] landmarker unavailable", e);
      return null;
    }
  })();
  return landmarkerPromise;
}

/**
 * Measure the face in a STILL image, once.
 *
 * Photos get a different instance from calls, in IMAGE mode: `detectForVideo`
 * demands a forward-moving timestamp and rejects the same frame twice, which
 * is exactly what a photo editor does every time a slider moves.
 *
 * Returns null when there is no face, when the model would not load, or when
 * the picture is of a landscape. Every caller treats that the same way — no
 * lens, say so, carry on — because a photo editor that refuses to open
 * because it could not find a chin is worse than one that just cannot do ears.
 */
export async function faceGeometryOf(
  image: CanvasImageSource,
  w: number,
  h: number,
): Promise<FaceGeometry | null> {
  if (!stillPromise) {
    stillPromise = (async () => {
      try {
        const { vision, fileset } = await visionFileset();
        const lm = await vision.FaceLandmarker.createFromOptions(
          fileset as Parameters<typeof vision.FaceLandmarker.createFromOptions>[0],
          {
            baseOptions: { modelAssetPath: "/face_landmarker.task", delegate: "GPU" },
            runningMode: "IMAGE",
            numFaces: 1,
            outputFaceBlendshapes: false,
          },
        );
        return lm as unknown as StillLandmarker;
      } catch (e) {
        console.warn("[faceFx] still landmarker unavailable", e);
        return null;
      }
    })();
  }
  const lm = await stillPromise;
  if (!lm) return null;
  try {
    const res = lm.detect(image);
    const pts = res?.faceLandmarks?.[0];
    return pts ? geometryFrom(pts, w, h) : null;
  } catch (e) {
    console.warn("[faceFx] still detect failed", e);
    return null;
  }
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
  const mouthLeft = px(lm[IDX.mouthLeft]);
  const mouthRight = px(lm[IDX.mouthRight]);
  const lipUpper = px(lm[IDX.lipUpperInner]);
  const lipLower = px(lm[IDX.lipLowerInner]);
  const headTop = px(lm[IDX.headTop]);
  const chin = px(lm[IDX.chin]);
  const faceWidth = Math.max(24, dist(px(lm[IDX.faceLeft]), px(lm[IDX.faceRight])));
  return {
    leftEye,
    rightEye,
    eyeWidth: Math.max(8, dist(lOut, lIn)),
    noseTip: px(lm[IDX.noseTip]),
    headTop,
    faceWidth,
    tilt: Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x),
    mouth: mid(lipUpper, lipLower),
    mouthLeft,
    mouthRight,
    mouthWidth: Math.max(8, dist(mouthLeft, mouthRight)),
    // Normalised by face width so it means the same thing close up and far
    // away. An absolute pixel gap would read as "open" whenever someone
    // leaned toward the phone.
    mouthOpen: Math.min(1, dist(lipUpper, lipLower) / faceWidth),
    chin,
    browLeft: px(lm[IDX.browLeft]),
    browRight: px(lm[IDX.browRight]),
    cheekLeft: px(lm[IDX.cheekLeft]),
    cheekRight: px(lm[IDX.cheekRight]),
    faceHeight: Math.max(32, dist(headTop, chin)),
  };
}

/**
 * Draw inside a frame translated to `p` and rolled with the head.
 *
 * Every lens below needs this and the save/translate/rotate/restore dance is
 * four lines of noise around one line of art. It also guarantees the restore:
 * a lens that returns early having left a transform on the context corrupts
 * every lens drawn after it, and that failure appears as "some OTHER filter is
 * broken", which is the worst kind of bug to chase.
 */
function atPoint(ctx: CanvasRenderingContext2D, p: Pt, tilt: number, draw: () => void): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(tilt);
  try {
    draw();
  } finally {
    ctx.restore();
  }
}

/** A heart, centred on the origin, `r` from centre to the widest point. */
function heartPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, r * 0.42);
  ctx.bezierCurveTo(r * 1.15, -r * 0.45, r * 0.5, -r * 1.15, 0, -r * 0.4);
  ctx.bezierCurveTo(-r * 0.5, -r * 1.15, -r * 1.15, -r * 0.45, 0, r * 0.42);
  ctx.closePath();
}

/**
 * A soft radial blob — blush, glow, the light inside a halo.
 *
 * A flat fill on skin reads as a sticker; the whole point of makeup and glow
 * is that they have no edge. createRadialGradient is one object per call and
 * the compositor does the rest.
 */
function blob(ctx: CanvasRenderingContext2D, p: Pt, r: number, color: string, alpha: number): void {
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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

/** Pointed ears, whiskers and a small pink nose. */
function catFace(ctx: CanvasRenderingContext2D, g: FaceGeometry): void {
  const w = g.faceWidth;
  atPoint(ctx, g.headTop, g.tilt, () => {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * w * 0.36, w * 0.04);
      ctx.rotate(side * 0.18);
      ctx.beginPath();
      ctx.moveTo(-w * 0.16, w * 0.1);
      ctx.lineTo(0, -w * 0.36);
      ctx.lineTo(w * 0.16, w * 0.1);
      ctx.closePath();
      ctx.fillStyle = "#3a3a42";
      ctx.fill();
      // Inner ear, inset so the dark rim still reads at small sizes.
      ctx.beginPath();
      ctx.moveTo(-w * 0.08, w * 0.06);
      ctx.lineTo(0, -w * 0.22);
      ctx.lineTo(w * 0.08, w * 0.06);
      ctx.closePath();
      ctx.fillStyle = "#f2a0b4";
      ctx.fill();
      ctx.restore();
    }
  });

  atPoint(ctx, g.noseTip, g.tilt, () => {
    // Nose: a rounded triangle, the cat shorthand.
    ctx.beginPath();
    ctx.moveTo(-w * 0.055, -w * 0.025);
    ctx.lineTo(w * 0.055, -w * 0.025);
    ctx.lineTo(0, w * 0.045);
    ctx.closePath();
    ctx.fillStyle = "#f2879f";
    ctx.fill();
    // Whiskers: three a side, fanned. Drawn from the nose so they track it.
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = Math.max(1.5, w * 0.012);
    ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      for (const [i, angle] of [-0.22, 0.02, 0.26].entries()) {
        ctx.beginPath();
        ctx.moveTo(side * w * 0.09, w * 0.01);
        const len = w * (0.34 - Math.abs(i - 1) * 0.04);
        ctx.lineTo(side * (w * 0.09 + len * Math.cos(angle)), w * 0.01 + len * Math.sin(angle));
        ctx.stroke();
      }
    }
  });
}

/** Long ears, a nose and two front teeth. */
function bunnyFace(ctx: CanvasRenderingContext2D, g: FaceGeometry): void {
  const w = g.faceWidth;
  atPoint(ctx, g.headTop, g.tilt, () => {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * w * 0.22, 0);
      ctx.rotate(side * 0.22);
      ctx.beginPath();
      ctx.ellipse(0, -w * 0.38, w * 0.11, w * 0.44, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#f5f0ee";
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -w * 0.38, w * 0.055, w * 0.34, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#f2a8bb";
      ctx.fill();
      ctx.restore();
    }
  });

  atPoint(ctx, g.noseTip, g.tilt, () => {
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.05, w * 0.038, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#f2879f";
    ctx.fill();
  });

  // Teeth hang off the MOUTH, not the nose, so they stay put when the jaw
  // moves — a bunny whose teeth ride up its lip on every word is uncanny.
  atPoint(ctx, g.mouth, g.tilt, () => {
    const tw = g.mouthWidth * 0.19;
    const th = tw * 1.5;
    ctx.fillStyle = "#fffdf8";
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = Math.max(1, w * 0.006);
    for (const side of [-1, 1]) {
      const x = side * tw * 0.55 - tw / 2;
      const y = -th * 0.15;
      const r = tw * 0.22;
      // Hand-rolled rather than ctx.roundRect: that method is Chrome 99 /
      // Safari 16.4 and this runs inside whatever WebView the phone shipped
      // with. The draw loop swallows exceptions, so an old device would not
      // crash — it would silently lose the lens, which is worse to diagnose.
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + tw - r, y);
      ctx.quadraticCurveTo(x + tw, y, x + tw, y + r);
      ctx.lineTo(x + tw, y + th - r);
      ctx.quadraticCurveTo(x + tw, y + th, x + tw - r, y + th);
      ctx.lineTo(x + r, y + th);
      ctx.quadraticCurveTo(x, y + th, x, y + th - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  });
}

/** A five-point crown resting on the crown of the head. */
function crown(ctx: CanvasRenderingContext2D, g: FaceGeometry): void {
  const w = g.faceWidth;
  atPoint(ctx, g.headTop, g.tilt, () => {
    const half = w * 0.42;
    const base = -w * 0.02;
    const peak = -w * 0.34;
    const dip = -w * 0.12;
    ctx.beginPath();
    ctx.moveTo(-half, base);
    ctx.lineTo(-half, dip);
    for (const [i, x] of [-half, -half / 2, 0, half / 2, half].entries()) {
      if (i % 2 === 0) ctx.lineTo(x, peak);
      else ctx.lineTo(x, dip);
    }
    ctx.lineTo(half, base);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, peak, 0, base);
    grad.addColorStop(0, "#ffe9a3");
    grad.addColorStop(0.5, "#f5c542");
    grad.addColorStop(1, "#c99206");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(120,80,0,0.5)";
    ctx.lineWidth = Math.max(1, w * 0.008);
    ctx.stroke();
    // Jewels on the band.
    for (const [i, x] of [-half * 0.55, 0, half * 0.55].entries()) {
      ctx.beginPath();
      ctx.arc(x, base - w * 0.055, w * 0.035, 0, Math.PI * 2);
      ctx.fillStyle = ["#e0466b", "#4fc3f7", "#66bb6a"][i];
      ctx.fill();
    }
  });
}

/** A glowing ring floating above the head. */
function halo(ctx: CanvasRenderingContext2D, g: FaceGeometry): void {
  const w = g.faceWidth;
  atPoint(ctx, g.headTop, g.tilt, () => {
    const ry = w * 0.09;
    const rx = w * 0.34;
    const y = -w * 0.36;
    ctx.save();
    // The glow first, underneath, or the ring's own stroke sits on top of it.
    ctx.shadowColor = "rgba(255,236,150,0.95)";
    ctx.shadowBlur = w * 0.16;
    ctx.strokeStyle = "#ffe98a";
    ctx.lineWidth = Math.max(3, w * 0.045);
    ctx.beginPath();
    ctx.ellipse(0, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
}

/** Two horns, and a warm red wash over the face to sell them. */
function devilFace(ctx: CanvasRenderingContext2D, g: FaceGeometry): void {
  const w = g.faceWidth;
  blob(ctx, g.noseTip, g.faceWidth * 0.85, "#ff2d2d", 0.16);
  atPoint(ctx, g.headTop, g.tilt, () => {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * w * 0.3, w * 0.02);
      ctx.beginPath();
      ctx.moveTo(-w * 0.075, w * 0.04);
      // Curved back and outward, so they read as horns rather than spikes.
      ctx.quadraticCurveTo(side * w * 0.02, -w * 0.2, side * w * 0.13, -w * 0.3);
      ctx.quadraticCurveTo(side * w * 0.01, -w * 0.14, w * 0.075, w * 0.04);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, -w * 0.3, 0, w * 0.04);
      grad.addColorStop(0, "#8c1111");
      grad.addColorStop(1, "#d93030");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    }
  });
}

/** Hearts over both eyes, beating on a shared clock. */
function heartEyes(ctx: CanvasRenderingContext2D, g: FaceGeometry, tMs: number): void {
  // One beat for both eyes: two hearts pulsing out of phase looks like a
  // glitch, not a heartbeat.
  const beat = 1 + 0.09 * Math.sin((tMs / 1000) * Math.PI * 2 * 1.6);
  const r = g.eyeWidth * 1.15 * beat;
  for (const eye of [g.leftEye, g.rightEye]) {
    atPoint(ctx, eye, g.tilt, () => {
      ctx.save();
      ctx.shadowColor = "rgba(255,40,90,0.6)";
      ctx.shadowBlur = r * 0.5;
      heartPath(ctx, r);
      const grad = ctx.createLinearGradient(0, -r, 0, r);
      grad.addColorStop(0, "#ff5c8a");
      grad.addColorStop(1, "#d5163f");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
      // A highlight, so it reads as glossy rather than as a flat sticker.
      ctx.beginPath();
      ctx.ellipse(-r * 0.3, -r * 0.42, r * 0.18, r * 0.12, -0.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fill();
    });
  }
}

/** Cartoon tears, falling on a loop from under each eye. */
function tears(ctx: CanvasRenderingContext2D, g: FaceGeometry, tMs: number): void {
  const fall = g.faceHeight * 0.55;
  for (const [i, eye] of [g.leftEye, g.rightEye].entries()) {
    // Offset the two sides so the drops alternate rather than fall in step.
    for (const phase of [0, 0.5]) {
      const p = (((tMs / 1400 + phase + i * 0.25) % 1) + 1) % 1;
      const r = g.eyeWidth * 0.3 * (1 - p * 0.35);
      atPoint(ctx, { x: eye.x, y: eye.y + g.eyeWidth * 0.55 + fall * p }, g.tilt, () => {
        ctx.beginPath();
        // Teardrop: a point on top, a bowl underneath.
        ctx.moveTo(0, -r * 1.5);
        ctx.quadraticCurveTo(r, 0, 0, r);
        ctx.quadraticCurveTo(-r, 0, 0, -r * 1.5);
        ctx.closePath();
        ctx.globalAlpha = 1 - p * 0.7;
        ctx.fillStyle = "#8fd4ff";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = Math.max(1, r * 0.18);
        ctx.stroke();
      });
    }
  }
}

/** Red nose and two hair puffs. */
function clownFace(ctx: CanvasRenderingContext2D, g: FaceGeometry): void {
  const w = g.faceWidth;
  atPoint(ctx, g.headTop, g.tilt, () => {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * w * 0.46, w * 0.06);
      // Three overlapping circles per side read as a puff of hair; one
      // circle reads as a ball stuck to the head.
      for (const [dx, dy, r] of [
        [0, 0, w * 0.17],
        [side * w * 0.09, -w * 0.09, w * 0.13],
        [side * -w * 0.02, w * 0.12, w * 0.12],
      ]) {
        ctx.beginPath();
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.fillStyle = "#ff4d3d";
        ctx.fill();
      }
      ctx.restore();
    }
  });
  atPoint(ctx, g.noseTip, g.tilt, () => {
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.1, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(-w * 0.03, -w * 0.03, w * 0.01, 0, 0, w * 0.1);
    grad.addColorStop(0, "#ff8a7a");
    grad.addColorStop(1, "#d61f0f");
    ctx.fillStyle = grad;
    ctx.fill();
  });
}

/** A superhero domino mask across the eye line. */
function heroMask(ctx: CanvasRenderingContext2D, g: FaceGeometry): void {
  const centre = mid(g.leftEye, g.rightEye);
  const gap = dist(g.leftEye, g.rightEye) / 2;
  atPoint(ctx, centre, g.tilt, () => {
    const rx = g.eyeWidth * 1.25;
    const ry = g.eyeWidth * 0.9;
    const W = gap + rx * 1.1;

    /**
     * ONE closed outline, then the eye holes wound the OTHER WAY.
     *
     * The obvious version — fill the mask, then erase the eyes with
     * `destination-out` — is wrong on this canvas, and wrong in a way that
     * looks like a rendering bug rather than a mistake: destination-out
     * erases the DESTINATION, which here is the composited video frame. It
     * would punch two transparent holes clean through the picture and show
     * black where the person's eyes are.
     *
     * Winding costs nothing and touches nothing underneath. The outer path
     * runs clockwise; each hole is an ellipse with `counterclockwise: true`,
     * so the default nonzero fill rule leaves them empty.
     */
    ctx.beginPath();
    ctx.moveTo(-W, -ry * 0.7);
    ctx.quadraticCurveTo(0, -ry * 1.35, W, -ry * 0.7);
    ctx.quadraticCurveTo(W * 1.05, ry * 0.35, W * 0.82, ry * 1.0);
    ctx.quadraticCurveTo(gap * 0.85, ry * 0.6, 0, ry * 0.34);
    ctx.quadraticCurveTo(-gap * 0.85, ry * 0.6, -W * 0.82, ry * 1.0);
    ctx.quadraticCurveTo(-W * 1.05, ry * 0.35, -W, -ry * 0.7);
    ctx.closePath();
    // The holes must be BIGGER than the eyes, not the same size. Matched to
    // the eye, the mask's edge lands on the eyelid and the whole thing reads
    // as swim goggles instead of a mask worn over the face.
    for (const side of [-1, 1]) {
      ctx.ellipse(side * gap, 0, rx * 0.72, ry * 0.62, 0, 0, Math.PI * 2, true);
    }
    const grad = ctx.createLinearGradient(0, -ry * 1.5, 0, ry);
    grad.addColorStop(0, "#3a3f8f");
    grad.addColorStop(1, "#12142f");
    ctx.fillStyle = grad;
    ctx.fill();
  });
}

/** The novelty disguise: brows, round glasses and a moustache. */
function disguise(ctx: CanvasRenderingContext2D, g: FaceGeometry): void {
  const w = g.faceWidth;
  const centre = mid(g.leftEye, g.rightEye);
  const gap = dist(g.leftEye, g.rightEye) / 2;
  atPoint(ctx, centre, g.tilt, () => {
    const r = g.eyeWidth * 0.95;
    ctx.strokeStyle = "#241a12";
    ctx.lineWidth = Math.max(2, w * 0.022);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * gap, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(210,225,235,0.28)";
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-gap + r, 0);
    ctx.lineTo(gap - r, 0);
    ctx.stroke();
    // Bushy brows sitting on the rims.
    ctx.fillStyle = "#241a12";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * gap, -r * 1.05, r * 1.05, r * 0.32, side * -0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Moustache under the nose, sized off the MOUTH so it stays in proportion.
  atPoint(ctx, { x: g.noseTip.x, y: (g.noseTip.y + g.mouth.y) / 2 }, g.tilt, () => {
    const mw = g.mouthWidth * 0.72;
    ctx.fillStyle = "#241a12";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, -mw * 0.1);
      ctx.quadraticCurveTo(side * mw * 0.55, -mw * 0.42, side * mw, -mw * 0.02);
      ctx.quadraticCurveTo(side * mw * 0.5, mw * 0.3, 0, mw * 0.16);
      ctx.closePath();
      ctx.fill();
    }
  });
}

/** Blush on the cheeks and colour on the lips. */
function makeup(ctx: CanvasRenderingContext2D, g: FaceGeometry): void {
  blob(ctx, g.cheekLeft, g.faceWidth * 0.2, "#ff6f91", 0.42);
  blob(ctx, g.cheekRight, g.faceWidth * 0.2, "#ff6f91", 0.42);
  atPoint(ctx, g.mouth, g.tilt, () => {
    // Two lips around the gap, so an open mouth stays open rather than being
    // painted shut — the single ellipse version looked like a sticker over
    // the mouth the moment anybody spoke.
    const half = g.mouthWidth / 2;
    const open = g.mouthOpen * g.faceWidth;
    const lip = Math.max(g.mouthWidth * 0.12, open * 0.35);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#c2185b";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(0, (side * (open + lip)) / 2, half, lip, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // A soft highlight down the nose, the way a contour reads on camera.
  blob(ctx, g.noseTip, g.faceWidth * 0.1, "#ffffff", 0.2);
}

/**
 * Scale the whole face up over itself — the big-head lens.
 *
 * Same compositor trick as bigEyes and for the same reason: warping pixels by
 * hand at call resolution costs the frame rate of the call itself. The circular
 * clip is what hides the seam; without it the copied square's edges cut a
 * visible box out of the shoulders.
 */
function bigHead(ctx: CanvasRenderingContext2D, g: FaceGeometry, canvas: HTMLCanvasElement): void {
  const centre = { x: g.noseTip.x, y: (g.headTop.y + g.chin.y) / 2 };
  const r = Math.max(g.faceWidth, g.faceHeight) * 0.72;
  const sx = centre.x - r;
  const sy = centre.y - r;
  const size = r * 2;
  if (sx < 0 || sy < 0 || sx + size > canvas.width || sy + size > canvas.height) return;
  const scale = 1.38;
  const out = size * scale;
  ctx.save();
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, (out / 2) * 0.9, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(canvas, sx, sy, size, size, centre.x - out / 2, centre.y - out / 2, out, out);
  ctx.restore();
}

/**
 * The face-tracked filters, by id. Ids are shared with CALL_FILTERS.
 *
 * `tMs` is passed in rather than read from performance.now() inside so that
 * the animated lenses are a pure function of their inputs — the same clock
 * gives the same frame, which is what makes them testable at all.
 */
export const FACE_FX: Record<
  string,
  (ctx: CanvasRenderingContext2D, g: FaceGeometry, canvas: HTMLCanvasElement, tMs: number) => void
> = {
  bigeyes: (ctx, g, canvas) => bigEyes(ctx, g, canvas),
  bighead: (ctx, g, canvas) => bigHead(ctx, g, canvas),
  dog: (ctx, g) => dogFace(ctx, g),
  shades: (ctx, g) => shades(ctx, g),
  cat: (ctx, g) => catFace(ctx, g),
  bunny: (ctx, g) => bunnyFace(ctx, g),
  crown: (ctx, g) => crown(ctx, g),
  halo: (ctx, g) => halo(ctx, g),
  devil: (ctx, g) => devilFace(ctx, g),
  clown: (ctx, g) => clownFace(ctx, g),
  mask: (ctx, g) => heroMask(ctx, g),
  disguise: (ctx, g) => disguise(ctx, g),
  makeup: (ctx, g) => makeup(ctx, g),
  hearts: (ctx, g, canvas, t) => heartEyes(ctx, g, t),
  tears: (ctx, g, canvas, t) => tears(ctx, g, t),
};

/**
 * The rack as the UI shows it — id, label and display order, in ONE place.
 *
 * Both surfaces that offer lenses (the call overlay and the photo editor)
 * read this list rather than keeping their own copy. Two copies is how a
 * lens ends up in calls and not in photos, or labelled differently in each,
 * and neither mistake is visible from the file you are editing at the time.
 */
export const FACE_LENSES: readonly { id: string; label: string }[] = [
  { id: "dog", label: "Dog 🐶" },
  { id: "cat", label: "Cat 🐱" },
  { id: "bunny", label: "Bunny 🐰" },
  { id: "bigeyes", label: "Big eyes 👀" },
  { id: "bighead", label: "Big head 🗿" },
  { id: "shades", label: "Shades 😎" },
  { id: "mask", label: "Hero 🦸" },
  { id: "disguise", label: "Disguise 🥸" },
  { id: "crown", label: "Crown 👑" },
  { id: "halo", label: "Angel 😇" },
  { id: "devil", label: "Devil 😈" },
  { id: "hearts", label: "Hearts 😍" },
  { id: "tears", label: "Tears 😭" },
  { id: "clown", label: "Clown 🤡" },
  { id: "makeup", label: "Makeup 💄" },
];

/** Whether an id needs the landmarker running at all. */
export function isFaceFilter(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(FACE_FX, id);
}
