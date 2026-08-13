// The particle atmosphere, drawn — rung 3's composition half.
//
// All the physics lives in src/lib/particleField.ts as a pure function of
// (seed, frame); this component only turns normalised particles into
// absolutely-positioned divs. No state, no springs, no Math.random — the
// same frame renders the same air in both render halves, which is the whole
// contract with Remotion's out-of-order rendering.
//
// The layer sits ABOVE the character and the parallax stack: embers and
// rain pass in front of people, which is what puts the person IN the
// weather instead of behind a screensaver. Colour is presentation and so
// lives here, not in the math.
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { particlesAt, type VfxKind } from '../../../src/lib/particleField';

/** Per-kind paint: colour, glow, and whether the particle is a streak. */
const PAINT: Record<VfxKind, { color: string; glow: string; streak: boolean }> = {
  embers: { color: '#ffb45e', glow: 'rgba(255,140,50,0.55)', streak: false },
  dust: { color: '#f2e4c8', glow: 'rgba(242,228,200,0.25)', streak: false },
  rain: { color: '#b9c9d9', glow: 'rgba(185,201,217,0)', streak: true },
  snow: { color: '#f4f7fb', glow: 'rgba(244,247,251,0.35)', streak: false },
  fireflies: { color: '#d8f27a', glow: 'rgba(196,240,90,0.7)', streak: false },
};

/** Rain's fixed slant, degrees from vertical. One wind for the whole shot. */
const RAIN_SLANT_DEG = 5;

export const ParticleOverlay: React.FC<{ kind: VfxKind; seed: number }> = ({ kind, seed }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const paint = PAINT[kind];
  const particles = particlesAt(kind, seed, frame, fps);

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {particles.map((p, i) => {
        const r = p.r * height;
        const d = Math.max(1, r * 2);
        return paint.streak ? (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: p.x * width,
              top: p.y * height,
              width: Math.max(1, r),
              height: d * 14,
              opacity: p.opacity,
              backgroundColor: paint.color,
              borderRadius: r,
              transform: `rotate(${RAIN_SLANT_DEG}deg)`,
            }}
          />
        ) : (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: p.x * width,
              top: p.y * height,
              width: d,
              height: d,
              opacity: p.opacity,
              backgroundColor: paint.color,
              borderRadius: '50%',
              boxShadow: `0 0 ${Math.max(2, r * 3)}px ${paint.glow}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
