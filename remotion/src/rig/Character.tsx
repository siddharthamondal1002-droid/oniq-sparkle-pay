// A character cut out of their sheet, standing in a frame, breathing, talking —
// and, since rung 4, performing: leaning into their lines, bobbing on the
// emphasis, walking in when the words say they arrive.
//
// THE MOTION IS THE POINT. A still with a moving mouth is a puppet with rigor
// mortis — the note on the first rig pass was that the character was not
// moving, and it was correct. What moves here, and why each one:
//
//   BREATH.  A slow vertical rise and fall, ~0.9% of the figure's height on a
//            4.5s cycle. It is the smallest motion that stops a figure reading
//            as a photograph, and it is the one every 2D rig has.
//   SWAY.    A lateral drift a third of the breath amplitude on a longer,
//            non-commensurate period, so the two never phase-lock into a bounce.
//   POSE.    Rung 4, movie grade only: puppetPoseAt's gesture/walk/eyeline
//            output, applied around the FEET (origin bottom-centre) so a lean
//            reads as weight shift rather than a hover. Absent a performance,
//            the pose path is not rendered at all and the markup below is
//            byte-identical to what rung 2 shipped — a classic film must stay
//            pixel-identical.
//   CAMERA.  Ken Burns on the whole plate at KEN_BURNS_SCALE — the SAME 6% the
//            episodes use, imported rather than re-typed, because a rig that
//            drifted to its own number would read as a different show.
//
// Everything is a function of `frame`. No springs seeded off mount time, no CSS
// transitions, no Math.random. Remotion renders frames out of order and in
// parallel processes; anything that is not a pure function of the frame number
// produces a different film every pass.
import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Viseme } from '../../../src/lib/visemes';
import { KEN_BURNS_SCALE } from '../../../src/lib/episodeTimeline';
import {
  beatFrames,
  puppetPoseAt,
  type CueLike,
  type PuppetPerformance,
  type SpeechSpan,
} from '../../../src/lib/puppetPerformance';
import { Mouth } from './Mouth';
import { MOUTH_VIEWBOX } from './mouthShapes';
import { mouthOnScreen, type CharacterRig } from './characterRig';
import type { ExpressionHead } from './expressionHeads';

/** Breath cycle in seconds, and its amplitude as a fraction of figure height. */
const BREATH_SECONDS = 4.5;
const BREATH_AMPLITUDE = 0.009;
/** Sway is slower and shallower, and deliberately not a multiple of the breath. */
const SWAY_SECONDS = 7.3;
const SWAY_RATIO = 0.34;

export type CharacterProps = {
  rig: CharacterRig;
  viseme: Viseme;
  /** Figure height as a fraction of the composition height. */
  heightRatio?: number;
  /** Horizontal centre as a fraction of the composition width. */
  centerRatio?: number;
  /** Distance from the bottom of the frame, as a fraction of composition height. */
  baselineRatio?: number;
  /**
   * Rung 4's body language, when the worker attached one (movie grade only).
   * The mouth cues and speech spans feed the gesture beats; the shot length
   * bounds the walk. Absent — every classic film, and every movie shot
   * before rung 4 — the component renders the rung-2 markup unchanged.
   */
  performance?: PuppetPerformance;
  cues?: ReadonlyArray<CueLike>;
  speech?: ReadonlyArray<SpeechSpan>;
  durationInFrames?: number;
  /**
   * Rung 5: a measured expression bust to wear instead of the base head,
   * resolved by StoryFilm from EXPRESSION_HEADS (so this component stays
   * data-driven and never indexes by rig key). Placed mouth-to-mouth at
   * interocular scale — see expressionHeads.ts for why that means the
   * viseme overlay's position never changes. Only honoured alongside a
   * performance: both ride the same movie-grade gate in the worker, and
   * the legacy branch below must stay byte-identical for classic films.
   */
  expressionHead?: ExpressionHead;
};

export const Character: React.FC<CharacterProps> = ({
  rig,
  viseme,
  // Undefined means "not specified", which must fall back rather than render a
  // NaN-sized figure — a Story plan written before shotGrammar existed has no
  // figureHeight on its shots.
  heightRatio = 0.62,
  centerRatio = 0.5,
  baselineRatio = 0.06,
  performance,
  cues,
  speech,
  durationInFrames,
  expressionHead,
}) => {
  // EVERY HOOK ABOVE EVERY EARLY RETURN. rules-of-hooks is a release blocker
  // in this repo; both render branches below share every hook here.
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const beats = React.useMemo(
    () => (performance && cues ? beatFrames(cues) : []),
    [performance, cues],
  );

  const view = rig.front;
  const drawnHeight = height * heightRatio;
  const scale = drawnHeight / view.crop.height;
  const drawnWidth = view.crop.width * scale;

  const breath = Math.sin((frame / (BREATH_SECONDS * fps)) * Math.PI * 2);
  const sway = Math.sin((frame / (SWAY_SECONDS * fps)) * Math.PI * 2);
  const dy = breath * drawnHeight * BREATH_AMPLITUDE;
  const dx = sway * drawnHeight * BREATH_AMPLITUDE * SWAY_RATIO;

  // The performance decides where the figure STANDS as well as how it moves:
  // a facing character plays from the third, looking across the frame.
  const effectiveCenter = performance?.center ?? centerRatio;

  const left = width * effectiveCenter - drawnWidth / 2 + dx;
  const top = height * (1 - baselineRatio) - drawnHeight + dy;

  const mouth = mouthOnScreen(view, scale, left, top);
  const mouthHeight = (mouth.width * MOUTH_VIEWBOX.height) / MOUTH_VIEWBOX.width;

  if (performance) {
    // Rung 4: one container carries figure AND mouth, so the pose transform
    // moves them as a single body — a mouth that stayed behind while the
    // figure leaned would be rung 2's rigor mortis inverted. The origin is
    // the feet: people pivot where they stand.
    const pose = puppetPoseAt(frame, {
      durationInFrames: durationInFrames ?? 1,
      fps,
      speech: speech ?? [],
      beats,
      facing: performance.facing ?? null,
      walk: performance.walk ?? null,
      speaking: performance.speaking ?? false,
      seed: performance.seed,
    });
    const baseLeft = width * effectiveCenter - drawnWidth / 2;
    const baseTop = height * (1 - baselineRatio) - drawnHeight;
    const mouthRelX = (view.mouth.x - view.crop.x) * scale;
    const mouthRelY = (view.mouth.y - view.crop.y) * scale;
    // Rung 5: the expression bust, placed mouth-to-mouth at interocular
    // scale. Its mouth centre lands exactly on the base mouth anchor, so
    // the viseme overlay below needs no new position — only a wider mouth
    // when the bust's painted mouth outsizes the base one (a grin's teeth
    // must not ghost out from behind a narrower rest shape).
    const exprScale = expressionHead
      ? (view.interocular / expressionHead.interocular) * scale
      : 0;
    const exprLeft = expressionHead
      ? mouthRelX - (expressionHead.mouth.x - expressionHead.crop.x) * exprScale
      : 0;
    const exprTop = expressionHead
      ? mouthRelY - (expressionHead.mouth.y - expressionHead.crop.y) * exprScale
      : 0;
    const mouthWidth = expressionHead
      ? Math.max(mouth.width, expressionHead.mouth.width * exprScale)
      : mouth.width;
    const mouthHeightNow = (mouthWidth * MOUTH_VIEWBOX.height) / MOUTH_VIEWBOX.width;
    return (
      <div
        style={{
          position: 'absolute',
          left: baseLeft,
          top: baseTop,
          width: drawnWidth,
          height: drawnHeight,
          transform: `translate(${dx + pose.dx * drawnHeight}px, ${
            dy + pose.dy * drawnHeight
          }px) rotate(${pose.rotDeg}deg)`,
          transformOrigin: '50% 100%',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
          }}
        >
          <Img
            src={staticFile(rig.sheet)}
            style={{
              position: 'absolute',
              left: -view.crop.x * scale,
              top: -view.crop.y * scale,
              width: rig.sheetWidth * scale,
              height: rig.sheetHeight * scale,
              maxWidth: 'none',
            }}
          />
        </div>
        {expressionHead ? (
          /* The bust rides ABOVE the figure and UNDER the mouth: it must
             cover the base head entirely (the measurement composites prove
             each entry does), and the viseme overlay must keep drawing on
             whatever face is showing. Same windowed-sheet technique as the
             figure itself — one Img, cropped by an overflow-hidden div. */
          <div
            style={{
              position: 'absolute',
              left: exprLeft,
              top: exprTop,
              width: expressionHead.crop.width * exprScale,
              height: expressionHead.crop.height * exprScale,
              overflow: 'hidden',
            }}
          >
            <Img
              src={staticFile(rig.sheet)}
              style={{
                position: 'absolute',
                left: -expressionHead.crop.x * exprScale,
                top: -expressionHead.crop.y * exprScale,
                width: rig.sheetWidth * exprScale,
                height: rig.sheetHeight * exprScale,
                maxWidth: 'none',
              }}
            />
          </div>
        ) : null}
        <div
          style={{
            position: 'absolute',
            left: mouthRelX - mouthWidth / 2,
            // The viewBox puts the lip line at its vertical centre, so the
            // anchor is the middle of the box rather than its top.
            top: mouthRelY - mouthHeightNow / 2,
          }}
        >
          <Mouth viseme={viseme} width={mouthWidth} />
        </div>
      </div>
    );
  }

  return (
    <>
      {/*
        The sheet is drawn as one big <Img> inside a window the size of the crop,
        offset so only the character shows. A CSS background-image would do the
        same, but Remotion cannot tell it has finished loading — and a plate that
        is still decoding when the frame is captured renders as a blank figure,
        which is the same class of silent failure as an unmounted <Audio>.
      */}
      <div
        style={{
          position: 'absolute',
          left,
          top,
          width: drawnWidth,
          height: drawnHeight,
          overflow: 'hidden',
        }}
      >
        <Img
          src={staticFile(rig.sheet)}
          style={{
            position: 'absolute',
            left: -view.crop.x * scale,
            top: -view.crop.y * scale,
            width: rig.sheetWidth * scale,
            height: rig.sheetHeight * scale,
            maxWidth: 'none',
          }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          left: mouth.x - mouth.width / 2,
          // The viewBox puts the lip line at its vertical centre, so the anchor
          // is the middle of the box rather than its top.
          top: mouth.y - mouthHeight / 2,
        }}
      >
        <Mouth viseme={viseme} width={mouth.width} />
      </div>
    </>
  );
};

/** Ken Burns on the whole plate, at the episodes' own travel. */
export const RigCamera: React.FC<{ children: React.ReactNode; durationInFrames: number }> = ({
  children,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const t = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
  const scale = 1 + KEN_BURNS_SCALE * t;

  return (
    <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: '50% 60%' }}>
      {children}
    </AbsoluteFill>
  );
};
