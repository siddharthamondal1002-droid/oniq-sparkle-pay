// A character cut out of their sheet, standing in a frame, breathing, talking.
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
import { Mouth } from './Mouth';
import { MOUTH_VIEWBOX } from './mouthShapes';
import { mouthOnScreen, type CharacterRig } from './characterRig';

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
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const view = rig.front;
  const drawnHeight = height * heightRatio;
  const scale = drawnHeight / view.crop.height;
  const drawnWidth = view.crop.width * scale;

  const breath = Math.sin((frame / (BREATH_SECONDS * fps)) * Math.PI * 2);
  const sway = Math.sin((frame / (SWAY_SECONDS * fps)) * Math.PI * 2);
  const dy = breath * drawnHeight * BREATH_AMPLITUDE;
  const dx = sway * drawnHeight * BREATH_AMPLITUDE * SWAY_RATIO;

  const left = width * centerRatio - drawnWidth / 2 + dx;
  const top = height * (1 - baselineRatio) - drawnHeight + dy;

  const mouth = mouthOnScreen(view, scale, left, top);
  const mouthHeight = (mouth.width * MOUTH_VIEWBOX.height) / MOUTH_VIEWBOX.width;

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
