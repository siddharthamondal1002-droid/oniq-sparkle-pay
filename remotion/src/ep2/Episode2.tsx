import React from 'react';
import { AbsoluteFill, Audio, Img, Loop, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import {
  BED_LOOP_FRAMES,
  EP2_FRAMES,
  EP2_SCENES,
  EP2_TOTAL,
  TRANSITION_FRAMES,
  type Ep2Scene,
} from './manifest';
import bedGain from './bedGain.json';

/** Ken Burns travel, ~6% — deliberately subtle (src/lib/episodeTimeline.ts). */
const SCALE = 0.06;
const PAN = 0.06;

const KenBurns: React.FC<{ scene: Ep2Scene; durationInFrames: number }> = ({
  scene,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Always render oversized so a pan never exposes an edge.
  const base = 1 + SCALE + PAN;
  const scale =
    scene.zoom === 'in' ? base + SCALE * t : scene.zoom === 'out' ? base + SCALE * (1 - t) : base;

  const travel = PAN * 100 * t;
  const x = scene.pan === 'left' ? -travel : scene.pan === 'right' ? travel : 0;
  const y = scene.pan === 'up' ? -travel : scene.pan === 'down' ? travel : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: '#0E0F13', overflow: 'hidden' }}>
      <Img
        src={staticFile(`ep2/${scene.id}.jpg`)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${x / scale}%, ${y / scale}%)`,
          transformOrigin: 'center center',
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * The music bed.
 *
 * Mounted at the ROOT, outside TransitionSeries, deliberately. A bed inside
 * the series would be restarted and cross-faded at every scene boundary —
 * fifteen audible seams, and the pumping that goes with them. One continuous
 * piece across the episode has none.
 *
 * LOOPED WITH <Loop>, NOT WITH THE `loop` ATTRIBUTE. This cost a full render
 * to find. `<Audio loop />` type-checks, because RemotionAudioProps extends
 * React's native audio attributes and `loop` is one of them — but the RENDERER
 * does not honour it. The bed played once for its 166 seconds and the last 169
 * seconds of the episode, more than half, came out with no music at all. There
 * is no warning; an A/B render either side of the 166s mark is what showed it.
 *
 * `loopVolumeCurveBehavior="extend"` is the other half. Inside a Loop the
 * volume callback is handed the frame relative to the current iteration, so
 * the default would replay the first 166 seconds of the duck curve over the
 * second half — ducking against a narration that is no longer there. "extend"
 * keeps the frame counting through, which is what an episode-indexed curve
 * needs.
 *
 * The gain curve is precomputed by scripts/build-bed-envelope.mjs, which
 * measures the real narration and runs it through src/lib/audioDuck.ts. It is
 * a plain array of one gain per frame, so nothing has to be analysed at render
 * time and the mix is inspectable as data rather than as a side effect.
 */
const BED_GAIN: number[] = bedGain.gain;

const MusicBed: React.FC = () => (
  <Loop durationInFrames={BED_LOOP_FRAMES}>
    <Audio
      src={staticFile('ep2/bed.mp3')}
      loopVolumeCurveBehavior="extend"
      // Clamped rather than defaulted to 1: an index past the end of the curve
      // would otherwise play the bed at FULL volume over the closing line,
      // which is the single worst frame in the episode to get wrong.
      volume={(f) => BED_GAIN[Math.min(f, BED_GAIN.length - 1)] ?? 0}
    />
  </Loop>
);

export const Episode2: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#0E0F13' }}>
    <MusicBed />
    <TransitionSeries>
      {EP2_SCENES.map((scene, i) => (
        <React.Fragment key={scene.id}>
          {i > 0 ? (
            <TransitionSeries.Transition
              presentation={fade()}
              timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
            />
          ) : null}
          <TransitionSeries.Sequence durationInFrames={EP2_FRAMES[i]}>
            <KenBurns scene={scene} durationInFrames={EP2_FRAMES[i]} />
            {/* The narration. Without this the episode renders as a silent
                slideshow — on episode 1 the mp3s were generated and then never
                mounted, which is invisible in a still-frame check and only
                shows up when someone plays the finished file.

                Inside the Sequence on purpose: TransitionSeries overlaps
                neighbours by TRANSITION_FRAMES, so the tail of one line
                cross-fades into the head of the next instead of cutting. */}
            <Audio src={staticFile(`ep2/${scene.id}.mp3`)} />
          </TransitionSeries.Sequence>
        </React.Fragment>
      ))}
    </TransitionSeries>
  </AbsoluteFill>
);

/** Exported so the renderer and the envelope builder cannot disagree. */
export const EPISODE2_DURATION = EP2_TOTAL;
