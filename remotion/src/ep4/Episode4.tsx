import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, staticFile } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { EP4_FRAMES, EP4_SCENES, EP4_TOTAL, TRANSITION_FRAMES } from './manifest';
import { EP4_SCENE_SHOTS, SHOT_DISSOLVE_FRAMES, type Ep4ShotPlan } from './shots';

/**
 * Episode 4 — "Aladdin and the Ember King". The second all-video original,
 * cut exactly like Episode3.tsx: outer TransitionSeries cross-fades SCENES,
 * inner series HARD CUTS the shots inside each scene, NO Ken Burns anywhere
 * (the motion is inside the clips; a camera move on top is two cameras
 * fighting). The two dissolve exceptions are S6's time jumps — the dust
 * settling on the shelf. See ep3/Episode3.tsx for the full reasoning; this
 * file changes the data, not the design.
 */

/** One generated clip. MUTED always — narration stays the clock. */
const Shot: React.FC<{ shot: Ep4ShotPlan }> = ({ shot }) => (
  <AbsoluteFill style={{ backgroundColor: '#0E0F13' }}>
    <OffthreadVideo
      src={staticFile(`ep4/clips/${shot.id}.mp4`)}
      muted
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  </AbsoluteFill>
);

/** The shots of one scene, cut together. */
const SceneShots: React.FC<{ shots: Ep4ShotPlan[] }> = ({ shots }) => (
  <TransitionSeries>
    {shots.map((shot, i) => (
      <React.Fragment key={shot.id}>
        {i > 0 && shot.transitionIn === 'dissolve' ? (
          <TransitionSeries.Transition
            presentation={fade()}
            timing={linearTiming({ durationInFrames: SHOT_DISSOLVE_FRAMES })}
          />
        ) : null}
        <TransitionSeries.Sequence durationInFrames={shot.frames}>
          <Shot shot={shot} />
        </TransitionSeries.Sequence>
      </React.Fragment>
    ))}
  </TransitionSeries>
);

export const Episode4: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#0E0F13' }}>
    <TransitionSeries>
      {EP4_SCENES.map((scene, i) => (
        <React.Fragment key={scene.id}>
          {i > 0 ? (
            <TransitionSeries.Transition
              presentation={fade()}
              timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
            />
          ) : null}
          <TransitionSeries.Sequence durationInFrames={EP4_FRAMES[i]}>
            <SceneShots shots={EP4_SCENE_SHOTS[i]} />
            {/* The narration, at SCENE level — the voice runs continuously
                across the cuts, which is what makes a run of shots read as
                one paragraph. Without this the episode renders silent. */}
            <Audio src={staticFile(`ep4/${scene.id}.mp3`)} />
          </TransitionSeries.Sequence>
        </React.Fragment>
      ))}
    </TransitionSeries>
  </AbsoluteFill>
);

/** Exported so the renderer and the envelope builder cannot disagree. */
export const EPISODE4_DURATION = EP4_TOTAL;
