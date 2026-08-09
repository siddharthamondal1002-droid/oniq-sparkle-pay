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

export type CharacterView = {
  /** The character's bounding box on the sheet. */
  crop: Rect;
  mouth: MouthAnchor;
};

export type CharacterRig = {
  /** Path under remotion/public, for staticFile(). */
  sheet: string;
  sheetWidth: number;
  sheetHeight: number;
  front: CharacterView;
};

/**
 * MEASURED CHARACTERS ONLY.
 *
 * Ten of the eleven sheets are not in here yet, and that absence is deliberate
 * rather than an oversight: an unmeasured character would need guessed
 * coordinates, and a guessed mouth anchor is worse than no rig at all because
 * it looks like it works until the mouth opens somewhere near the chin. Each
 * one is ten minutes with the crop command above.
 *
 * `aladdin` is first because he is the lead of Episode 3, and because his sheet
 * is the 3D one — a clean two-view render on a plain ground, which is the
 * easiest possible case to prove the mechanism against before taking on the
 * painted sheets with their titles, palettes and callout arrows.
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
