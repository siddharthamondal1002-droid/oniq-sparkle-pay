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
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { particlesAt, type VfxKind } from "../../../src/lib/particleField";

/** Per-kind paint: colour, glow, and whether the particle is a streak. */
const PAINT: Record<VfxKind, { color: string; glow: string; streak: boolean }> = {
  embers: { color: "#ffb45e", glow: "rgba(255,140,50,0.55)", streak: false },
  dust: { color: "#f2e4c8", glow: "rgba(242,228,200,0.25)", streak: false },
  rain: { color: "#b9c9d9", glow: "rgba(185,201,217,0)", streak: true },
  snow: { color: "#f4f7fb", glow: "rgba(244,247,251,0.35)", streak: false },
  fireflies: { color: "#d8f27a", glow: "rgba(196,240,90,0.7)", streak: false },
};

/**
 * A STREAK IS MOTION BLUR, SO ITS LENGTH IS THE DISTANCE TRAVELLED IN ONE
 * FRAME — not a multiple of the drop's radius.
 *
 * The first version drew the streak fourteen diameters tall, giving a 43–75px
 * streak while rain falls 58–90px per frame at 30fps and 1080x1920. A length
 * taken from the radius knows nothing about the fall speed. Every drop
 * cleared its own length between frames and left a gap of up to 44px, so the
 * layer played as a field of dashes flickering in place — visible noise
 * rather than falling water. Rendering two consecutive frames in different
 * colours shows the successive streaks sitting apart with dark between them.
 *
 * At exactly 1.0 the streaks abut and rounding can still open a hairline
 * seam, so they are drawn slightly long: consecutive frames overlap by ~7%
 * at each end and the fall reads continuous.
 */
const STREAK_OVERLAP = 1.15;

export const ParticleOverlay: React.FC<{ kind: VfxKind; seed: number }> = ({ kind, seed }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const paint = PAINT[kind];
  const particles = particlesAt(kind, seed, frame, fps);

  return (
    /* overflow hidden: sway rides outside the wrap (see particleField.ts),
       so a particle may overhang the frame edge by its sway amplitude and
       must clip, not paint outside the shot. */
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {particles.map((p, i) => {
        const r = p.r * height;
        const d = Math.max(1, r * 2);
        /* translate(-50%,-50%): Particle.x/y are the CENTRE. Anchoring the
           div's top-left corner there instead shifts everything down-right
           by a radius and makes edge particles pop in whole. */
        if (paint.streak) {
          /* One frame of travel, in pixels. The slant comes out of the same
             two numbers rather than a hand-derived constant — atan2(dx, dy)
             is the lean off vertical, NEGATED because CSS rotates clockwise
             in a y-down space and a drop blown right must put its BOTTOM to
             the right. The review's math pass caught a hardcoded slant
             leaning every streak against its own motion; derived, it cannot
             disagree with the physics again. */
          const dx = (p.vx * width) / fps;
          const dy = (p.vy * height) / fps;
          const deg = (-Math.atan2(dx, dy) * 180) / Math.PI;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: p.x * width,
                top: p.y * height,
                width: Math.max(1, r),
                height: Math.max(d, Math.hypot(dx, dy) * STREAK_OVERLAP),
                opacity: p.opacity,
                backgroundColor: paint.color,
                borderRadius: r,
                transform: `translate(-50%, -50%) rotate(${deg}deg)`,
              }}
            />
          );
        }
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p.x * width,
              top: p.y * height,
              width: d,
              height: d,
              opacity: p.opacity,
              backgroundColor: paint.color,
              borderRadius: "50%",
              transform: "translate(-50%, -50%)",
              boxShadow: `0 0 ${Math.max(2, r * 3)}px ${paint.glow}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
