// One scene, rendered by the in-house rig, so the timing can be WATCHED.
//
// Episode 3's opening: its real still, its real narration, and a mouth driven
// by the measured speech spans. No video model anywhere in this composition.
//
// WHAT THIS PROVES AND WHAT IT DOES NOT. It proves the chain end to end —
// measured spans, cue track, per-frame shape, encode — and it produces a file
// somebody can look at, which is the only way lip sync is ever judged. The
// numbers said 9.03 shapes/sec and 24-44% rest; those are necessary and not
// sufficient, and a contact sheet cannot show timing. That is the whole reason
// this renders rather than asserting.
//
// PLACEMENT IS SOLVED, and it was solved by the art rather than by code. The
// first pass put the mouth in a panel at the bottom of frame because nothing
// knew where a face was in a generated painting. It does not have to: ONIQ's
// cast comes from character sheets with canonical front and side views, so the
// mouth is at a KNOWN point on a KNOWN crop. See characterRig.ts.
//
// THE CHARACTER MOVES. Breath, sway and a Ken Burns at the episodes' own 6%.
// A still with a moving mouth is a puppet with rigor mortis, and that was the
// correct note on the first pass.
//
// What this still does NOT do: the character stands in front of the scene
// rather than in it. There is no shadow contact, no colour match to the plate's
// light, and the sheet's own plain ground is cut away hard. It reads as a
// cut-out because it is one.
import React from 'react';
import { AbsoluteFill, Audio, Img, staticFile, useCurrentFrame } from 'remotion';
import {
  buildMouthCues,
  segmentsFromSpans,
  visemeAtFrame,
} from '../../../src/lib/visemes';
import { SEASON_SCRIPT } from '../../../src/data/originalsScript';
import { EP3_SPEECH } from '../ep3/speech';
import { EP3_SCENES, FPS } from '../ep3/manifest';
import { Character, RigCamera } from './Character';
import { CHARACTER_RIGS } from './characterRig';

/** The scene this proof renders. Episode 3's opening — short, and it talks. */
export const PROOF_SCENE = 'ep3_s01';
export const PROOF_FRAMES = Math.round(
  (EP3_SCENES.find((s) => s.id === PROOF_SCENE)?.seconds ?? 0) * FPS,
);

/**
 * The cue track, built ONCE at module scope rather than per frame.
 *
 * Remotion evaluates the component for every frame, and buildMouthCues walks
 * the whole scene each call — at 486 frames that is 486 full rebuilds of the
 * same immutable answer. It is also the only way the track is guaranteed
 * identical on every frame: a per-frame rebuild that ever disagreed with itself
 * would show as a mouth flickering between two readings of the same audio.
 */
const NARRATION =
  SEASON_SCRIPT.find((l) => l.sceneId === PROOF_SCENE)?.narration ?? '';
const CUES = buildMouthCues(
  NARRATION,
  segmentsFromSpans(EP3_SPEECH[PROOF_SCENE] ?? [], PROOF_FRAMES),
  PROOF_FRAMES,
);

export const RigProof: React.FC = () => {
  const frame = useCurrentFrame();
  const viseme = visemeAtFrame(CUES, frame);

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0806' }}>
      <RigCamera durationInFrames={PROOF_FRAMES}>
        {/*
          The plate is pushed down in brightness and contrast. Not decoration:
          the sheet was rendered on a bright plain ground and the ep3 stills are
          lit warm and busy, so a character cut straight onto one at full
          strength reads as a sticker. Darkening the plate is the cheapest
          version of matching them and it is not a substitute for a real grade.
        */}
        <Img
          src={staticFile(`ep3/shots/${PROOF_SCENE}a.jpg`)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'brightness(0.62) saturate(0.9)',
          }}
        />

        <Character rig={CHARACTER_RIGS.aladdin} viseme={viseme} />

        {/*
          Contact shadow, drawn OVER the feet rather than behind them. Two jobs,
          and the second is why it is on top.

          It grounds the figure — a character with nothing under their feet
          floats, and that reads as wrong long before anyone can say why.

          It also covers the last of the cut. A ~20px band of the sheet's own
          warm ground survives between the soles, and no threshold removes it:
          it measures saturation 49 against foot skin at saturation 49, so any
          key that takes the residue takes the toes with it. Compositing solves
          what keying cannot, which is what a real 2D pipeline would do here
          anyway.
        */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '4.4%',
            transform: 'translateX(-50%)',
            width: 560,
            height: 120,
            borderRadius: '50%',
            background:
              'radial-gradient(ellipse at center, rgba(12,8,4,0.95) 0%, ' +
              'rgba(12,8,4,0.72) 38%, rgba(12,8,4,0) 72%)',
          }}
        />
      </RigCamera>

      <Audio src={staticFile(`ep3/${PROOF_SCENE}.mp3`)} />
    </AbsoluteFill>
  );
};
