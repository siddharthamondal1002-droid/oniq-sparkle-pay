import React from 'react';
import { AbsoluteFill, Audio, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { EP1_FRAMES, EP1_SCENES, TRANSITION_FRAMES, type Ep1Scene } from './manifest';

/** Ken Burns travel, ~6% — deliberately subtle (src/lib/episodeTimeline.ts). */
const SCALE = 0.06;
const PAN = 0.06;

const KenBurns: React.FC<{ scene: Ep1Scene; durationInFrames: number }> = ({
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
        src={staticFile(`ep1/${scene.id}.jpg`)}
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

export const Episode1: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#0E0F13' }}>
    <TransitionSeries>
      {EP1_SCENES.map((scene, i) => (
        <React.Fragment key={scene.id}>
          {i > 0 ? (
            <TransitionSeries.Transition
              presentation={fade()}
              timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
            />
          ) : null}
          <TransitionSeries.Sequence durationInFrames={EP1_FRAMES[i]}>
            <KenBurns scene={scene} durationInFrames={EP1_FRAMES[i]} />
            {/* The narration. Without this the episode renders as a silent
                slideshow — the mp3s were generated and then never mounted,
                which is invisible in a still-frame check and only shows up
                when someone plays the finished file.

                Inside the Sequence on purpose: TransitionSeries overlaps
                neighbours by TRANSITION_FRAMES, so the tail of one line
                cross-fades into the head of the next instead of cutting. */}
            <Audio src={staticFile(`ep1/${scene.id}.mp3`)} />
          </TransitionSeries.Sequence>
        </React.Fragment>
      ))}
    </TransitionSeries>
  </AbsoluteFill>
);
