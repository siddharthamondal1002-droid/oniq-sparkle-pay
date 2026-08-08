import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, staticFile } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { EP3_FRAMES, EP3_SCENES, EP3_TOTAL, TRANSITION_FRAMES } from './manifest';
import { EP3_SCENE_SHOTS, SHOT_DISSOLVE_FRAMES, type Ep3ShotPlan } from './shots';

/**
 * Episode 3 — the first ONIQ original made of moving video rather than stills.
 *
 * Episodes 1 and 2 are one painting per scene under a Ken Burns move. There is
 * NO KEN BURNS HERE and there must not be: the motion is inside the clip, and
 * adding a camera move on top of a shot that already has one gives you two
 * cameras fighting. That absence is the single biggest structural difference
 * from Episode1.tsx / Episode2.tsx, and it is deliberate.
 *
 * Two levels of series, and the difference between them is the whole design:
 *
 *   OUTER — one Sequence per SCENE, cross-faded into its neighbour. A dissolve
 *           between scenes means "new part of the story", which is true.
 *
 *   INNER — one Sequence per SHOT, HARD CUT. A cross-dissolve between two
 *           independently generated clips of the same subject is a morph: you
 *           watch one face slide into a slightly different face over twelve
 *           frames. A cut is far better — the eye accepts it instantly and
 *           cannot compare across it.
 *
 * The three exceptions are in S11, where the script itself jumps in time ("A
 * house. Then a better house. Then a palace."), and they are opt-in per shot.
 *
 * See .claude/skills/oniq-video/references/assembling-generated-clips.md.
 */

/**
 * One generated clip.
 *
 * MUTED, and this is not optional. Veo returns clips with their own invented
 * soundtrack on them — wind, crowd, music. The ingest script strips the audio
 * stream on the way in; this is the second lock, because a single clip that
 * slipped through ingest would play its own score underneath the narration and
 * the only way to notice is to listen to all seven minutes.
 *
 * OffthreadVideo rather than Video: it extracts frames with ffmpeg instead of
 * driving an HTML video element, which is what you want when the timeline has
 * to be frame-accurate across fifty-seven separate files.
 */
const Shot: React.FC<{ shot: Ep3ShotPlan }> = ({ shot }) => (
  <AbsoluteFill style={{ backgroundColor: '#0E0F13' }}>
    <OffthreadVideo
      src={staticFile(`ep3/clips/${shot.id}.mp4`)}
      muted
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  </AbsoluteFill>
);

/** The shots of one scene, cut together. */
const SceneShots: React.FC<{ shots: Ep3ShotPlan[] }> = ({ shots }) => (
  <TransitionSeries>
    {shots.map((shot, i) => (
      <React.Fragment key={shot.id}>
        {/* No Transition element between two shots IS the hard cut. Only the
            explicit opt-in gets a dissolve, and never on the first shot —
            that boundary already belongs to the outer scene transition. */}
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

export const Episode3: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#0E0F13' }}>
    <TransitionSeries>
      {EP3_SCENES.map((scene, i) => (
        <React.Fragment key={scene.id}>
          {i > 0 ? (
            <TransitionSeries.Transition
              presentation={fade()}
              timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
            />
          ) : null}
          <TransitionSeries.Sequence durationInFrames={EP3_FRAMES[i]}>
            <SceneShots shots={EP3_SCENE_SHOTS[i]} />
            {/* THE NARRATION. Without this the episode renders as a silent
                film — on episode 1 the mp3s were generated and then never
                mounted, which no still-frame check would ever have caught.
                It sits at SCENE level, not shot level: the voice runs
                continuously across the cuts inside a scene, which is what
                makes a run of shots read as one paragraph rather than as
                seven unrelated pictures. */}
            <Audio src={staticFile(`ep3/${scene.id}.mp3`)} />
          </TransitionSeries.Sequence>
        </React.Fragment>
      ))}
    </TransitionSeries>
  </AbsoluteFill>
);

/** Exported so the renderer and the envelope builder cannot disagree. */
export const EPISODE3_DURATION = EP3_TOTAL;
