// Where a character is on their sheet, and where their mouth is on their face.
//
// THE SHEETS ARE THE ART DIRECTION. ONIQ's cast comes from the owner's own
// Adobe Firefly sheets and every one of them is drawn the same way: a clean
// FRONT view and SIDE view at consistent framing, several with expression heads
// already drawn. That is not a coincidence of style, it is a puppet rig waiting
// to be cut out — canonical poses, known views, a face in a known place. The
// answer to "how do we place a mouth" was already in the art.
//
// THIS INVERTS A RULE IN THE SKILL, and the inversion is the point.
// `references/assembling-generated-clips.md` says: attach the 3D sheets to a
// generation, never the 2D ones, because a flat-2D reference drags the whole
// generation toward flat 2D. On ep3 exactly one of eleven sheets qualified.
//
// That rule is about GENERATION. Here there is no generation — the sheet is not
// a reference handed to a model, it is the source image the frame is cut from.
// The medium cannot be dragged anywhere because nothing is being redrawn. So
// all eleven sheets are usable, including the ten that were useless for
// `starting_frame`, and they are already sitting in `remotion/public/sheets/`
// inside the bundle.
//
// HOW TO MEASURE A NEW CHARACTER. Crop the head out at 3x and read the numbers
// off the enlargement — do not eyeball a downscaled sheet, the mouth is forty
// pixels wide at sheet scale and being ten pixels out is visible once it moves:
//
//   ffmpeg -i public/sheets/NAME.jpg -vf "crop=400:320:X:Y,scale=1200:960" head.png
//
// All coordinates below are in SHEET pixels, including the mouth — measuring
// the mouth relative to the crop box means re-measuring it every time the crop
// changes, and the crop is the thing most likely to be adjusted.

export type Rect = { x: number; y: number; width: number; height: number };

export type MouthAnchor = {
  /** Centre of the lip line, in sheet pixels. */
  x: number;
  y: number;
  /** Corner-to-corner width of the mouth AT REST, in sheet pixels. */
  width: number;
};

/**
 * Rung 7: where the eyes are and what a closed lid looks like. Optional
 * on both the base view and the expression busts — a face without
 * measured eyes simply never blinks, the same honest absence as every
 * other rung. `lid` is the paint the descending lid shows, sampled from
 * the figure's own upper-lid/skin by the measurer, because a wrong-colour
 * lid flickering at blink rate is worse than no blink at all.
 */
export type EyeGeometry = {
  /** Pupil (or aperture) centres, sheet pixels. */
  left: { x: number; y: number };
  right: { x: number; y: number };
  /** Painted aperture width of ONE eye, sheet pixels — sizes the lid. */
  width: number;
  /** CSS colour of the closed lid. */
  lid: string;
};

export type CharacterView = {
  /** The character's bounding box on the sheet. */
  crop: Rect;
  mouth: MouthAnchor;
  /**
   * Pupil-to-pupil distance in sheet pixels. Measured in rung 2 and carried
   * in the comments below since; promoted to data for rung 5, because it is
   * the scale key that sizes an expression-head swap to the figure's face.
   */
  interocular: number;
  /** Rung 7, when measured: the blink geometry. Absent = never blinks. */
  eyes?: EyeGeometry;
};

export type CharacterRig = {
  /** Path under remotion/public, for staticFile(). */
  sheet: string;
  sheetWidth: number;
  sheetHeight: number;
  front: CharacterView;
};

/**
 * MEASURED CHARACTERS ONLY — and since 2026-08-13, that is ALL ELEVEN.
 *
 * Rung 2 of the in-house ladder measured the remaining ten sheets: every crop
 * and mouth anchor below was read off a 3x enlargement by one measurer and
 * then independently re-derived by a second, adversarial pass (verdicts
 * CONFIRMED, jarJinni CORRECTED) before landing here. A guessed mouth anchor
 * is worse than no rig at all because it looks like it works until the mouth
 * opens somewhere near the chin — nothing in this table is guessed.
 *
 * `aladdin` is first because he is the lead of Episode 3, and because his
 * sheet is the 3D one (1600x1244); the painted repertory sheets are all
 * 1600x894. The painted grounds needed per-sheet cutter knobs (warm tan on
 * lampJinni, near-black on ringJinni — the key went saturation-only there);
 * the knobs used are recorded in the rung 2 workflow notes, and the cut PNGs
 * are the committed artifacts.
 *
 * KNOWN BLEMISH, accepted: ringJinni's crop keeps three title letters in its
 * top-left corner — excluding them would amputate the tail or the flame hair.
 * At composition scale over a scene they read as background sparkle; revisit
 * only if a shot shows otherwise.
 */
export const CHARACTER_RIGS: Readonly<Record<string, CharacterRig>> = {
  aladdin: {
    // The CUT sheet, not the jpg. A crop box is a rectangle, so drawing the
    // raw sheet puts a hard panel of its own ground behind the character and
    // the whole thing reads as a sticker. scripts/cutout_sheet.py derives this.
    sheet: 'sheets/cut/aladdin.png',
    sheetWidth: 1600,
    sheetHeight: 1244,
    front: {
      // Verified by cropping and looking: the box holds the whole figure from
      // hair to sandals with a small margin, and no part of the side panel.
      crop: { x: 120, y: 30, width: 520, height: 1214 },
      // Read off a 3x enlargement of the head. Interocular distance measures
      // ~68px on this sheet, for anyone re-deriving the scale.
      mouth: { x: 340, y: 283, width: 95 },
      interocular: 68,
      // Rung 7. The 3D render's eyes splay a little: measured span 74.
      eyes: {
        left: { x: 295, y: 223 },
        right: { x: 369, y: 221 },
        width: 46,
        lid: '#bd6a3c',
      },
    },
  },
  magician: {
    sheet: 'sheets/cut/magician.png',
    sheetWidth: 1600,
    sheetHeight: 894,
    front: {
      // Right edge sits ~5px off the side view — do not widen.
      crop: { x: 541, y: 105, width: 345, height: 742 },
      // A thin closed smirk; interocular 29.6px.
      mouth: { x: 715.5, y: 218.5, width: 27 },
      interocular: 29.6,
      // Rung 7: deep-set slits. The lid is the mauve socket shadow, not
      // skin — closed, they read as shut hollow sockets, which is how the
      // painting already treats his eye zone.
      eyes: {
        left: { x: 701, y: 187 },
        right: { x: 730, y: 187 },
        width: 14,
        lid: '#4a3432',
      },
    },
  },
  lampJinni: {
    sheet: 'sheets/cut/lampJinni.png',
    sheetWidth: 1600,
    sheetHeight: 894,
    front: {
      // Includes the lamp at the figure's base — it is part of the front view.
      crop: { x: 52, y: 20, width: 720, height: 804 },
      // Solemn pressed line framed by the moustache; interocular 38.6px.
      mouth: { x: 413.3, y: 194.7, width: 32.7 },
      interocular: 38.6,
      // Rung 7: narrow white slits under heavy brows. Lid is his blue
      // socket/cheek skin — the strip above the slit is brow shadow.
      eyes: {
        left: { x: 392, y: 155 },
        right: { x: 429, y: 155.5 },
        width: 16,
        lid: '#454f7b',
      },
    },
  },
  ringJinni: {
    sheet: 'sheets/cut/ringJinni.png',
    sheetWidth: 1600,
    sheetHeight: 894,
    front: {
      // Keeps the ring prop under the floating figure; title letters survive
      // top-left (see the header note). Interocular 60px.
      crop: { x: 478, y: 38, width: 424, height: 784 },
      mouth: { x: 717.5, y: 263.5, width: 32 },
      interocular: 60,
      // Rung 7: white almond apertures, no pupils — aperture centres.
      // Measured span 51 runs ~15% under the recorded interocular; the
      // lid was brightened one step to sit in the luminous gold skin.
      eyes: {
        left: { x: 694, y: 233 },
        right: { x: 745, y: 237 },
        width: 26,
        lid: '#d6a87c',
      },
    },
  },
  princess: {
    sheet: 'sheets/cut/princess.png',
    sheetWidth: 1600,
    sheetHeight: 894,
    front: {
      crop: { x: 228, y: 58, width: 300, height: 817 },
      // Interocular 43.8px.
      mouth: { x: 379, y: 181.7, width: 36 },
      interocular: 43.8,
      // Rung 7: centres sit on the aperture midline (y 148), not the lid
      // crease — 1.5px higher leaked her painted lower liner.
      eyes: {
        left: { x: 356.5, y: 148 },
        right: { x: 400, y: 148 },
        width: 30,
        lid: '#ab6240',
      },
    },
  },
  mother: {
    sheet: 'sheets/cut/mother.png',
    sheetWidth: 1600,
    sheetHeight: 894,
    front: {
      crop: { x: 674, y: 78, width: 285, height: 777 },
      // Interocular 40px.
      mouth: { x: 817, y: 198, width: 37 },
      interocular: 40,
      // Rung 7. Measured span 40 — exact against the recorded interocular.
      eyes: {
        left: { x: 796, y: 162 },
        right: { x: 836, y: 162 },
        width: 21,
        lid: '#b76f53',
      },
    },
  },
  aliBaba: {
    sheet: 'sheets/cut/aliBaba.png',
    sheetWidth: 1600,
    sheetHeight: 894,
    front: {
      crop: { x: 602, y: 58, width: 398, height: 829 },
      // Smile inside the beard; interocular 32.4px.
      mouth: { x: 808.5, y: 169, width: 41 },
      interocular: 32.4,
      // Rung 7. Lid is his mid lid/under-eye skin — the strip above the
      // eye is brow-crease shadow and read as goggles in the proof.
      eyes: {
        left: { x: 790, y: 134 },
        right: { x: 823, y: 133 },
        width: 18,
        lid: '#a85832',
      },
    },
  },
  morgiana: {
    sheet: 'sheets/cut/morgiana.png',
    sheetWidth: 1600,
    sheetHeight: 894,
    front: {
      crop: { x: 186, y: 46, width: 320, height: 799 },
      // Interocular 44.3px.
      mouth: { x: 342.3, y: 178.7, width: 25.3 },
      interocular: 44.3,
      // Rung 7. Span 44 against recorded 44.3.
      eyes: {
        left: { x: 321, y: 140 },
        right: { x: 365, y: 140 },
        width: 26,
        lid: '#75402e',
      },
    },
  },
  captain: {
    sheet: 'sheets/cut/captain.png',
    sheetWidth: 1600,
    sheetHeight: 894,
    front: {
      crop: { x: 175, y: 62, width: 490, height: 810 },
      // The lip line hides at the moustache part; interocular 32px.
      mouth: { x: 425, y: 179, width: 34 },
      interocular: 32,
      // Rung 7: deep-set slits resolved by a brightness-boosted 16x read
      // (glint-iris-glint). NOTE the measured span is 40 — the rung-2
      // interocular above looks understated; kept as-is pending the
      // verify pass, and it scales nothing today (captain has no busts).
      eyes: {
        left: { x: 403, y: 141 },
        right: { x: 443, y: 141 },
        width: 16,
        lid: '#7c4833',
      },
    },
  },
  fisherman: {
    sheet: 'sheets/cut/fisherman.png',
    sheetWidth: 1600,
    sheetHeight: 894,
    front: {
      crop: { x: 592, y: 72, width: 320, height: 786 },
      // The widest smile of the cast; interocular 38.5px.
      mouth: { x: 750, y: 179, width: 51 },
      interocular: 38.5,
      // Rung 7. Span 37 against recorded 38.5.
      eyes: {
        left: { x: 730, y: 141 },
        right: { x: 767, y: 141 },
        width: 21,
        lid: '#8a4a32',
      },
    },
  },
  jarJinni: {
    sheet: 'sheets/cut/jarJinni.png',
    sheetWidth: 1600,
    sheetHeight: 894,
    front: {
      // The one CORRECTED entry: the verify pass re-derived these numbers.
      crop: { x: 358, y: 63, width: 490, height: 798 },
      // Interocular 35px.
      mouth: { x: 597, y: 164, width: 32 },
      interocular: 35,
      // Rung 7: NO eyes, deliberately. Molten glowing slits with bloom —
      // no whites, no painted lids, dark cracked sockets. A skin-lid
      // blink cannot close a fire; he alone in the cast never blinks.
    },
  },
};

/** Where the mouth lands on screen once the character is drawn at `scale`. */
export function mouthOnScreen(
  view: CharacterView,
  scale: number,
  charLeft: number,
  charTop: number,
): { x: number; y: number; width: number } {
  return {
    x: charLeft + (view.mouth.x - view.crop.x) * scale,
    y: charTop + (view.mouth.y - view.crop.y) * scale,
    width: view.mouth.width * scale,
  };
}
