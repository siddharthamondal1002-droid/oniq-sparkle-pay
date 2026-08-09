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
// It does NOT prove placement. The mouth sits in a panel at the bottom of the
// frame rather than on the character's face, because nothing here knows where
// the face IS — these are flat generated paintings with no landmark data.
// Registering a mouth to a painted face is the next problem and it is a real
// one; putting the mouth in a corner and calling the rig finished would be
// exactly the kind of "it renders, therefore it works" that the episode-one
// silent slideshow already cost this project once.
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
import { Mouth } from './Mouth';

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
      <Img
        src={staticFile(`ep3/shots/${PROOF_SCENE}a.jpg`)}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <Audio src={staticFile(`ep3/${PROOF_SCENE}.mp3`)} />

      {/* The rig panel. Sized generously because the point is to judge the
          timing at a glance, not to sit convincingly on a face. */}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingBottom: 160,
        }}
      >
        <div
          style={{
            backgroundColor: 'rgba(10, 8, 6, 0.72)',
            borderRadius: 48,
            padding: '64px 96px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Mouth viseme={viseme} width={520} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
