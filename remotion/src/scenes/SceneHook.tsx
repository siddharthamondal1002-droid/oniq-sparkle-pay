import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, display } from '../theme';
import { Eyebrow, Rise } from '../components/Kit';

const LETTERS = ['O', 'N', 'I', 'Q'];

export const SceneHook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // A teal ring that snaps open behind the wordmark.
  const ring = spring({ frame: frame - 4, fps, config: { damping: 18, stiffness: 90 } });
  const drift = Math.sin(frame / 40) * 8;

  return (
    <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: 96, paddingRight: 96 }}>
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 560,
          width: 840,
          height: 840,
          borderRadius: '50%',
          border: `2px solid rgba(0,212,184,0.35)`,
          transform: `scale(${interpolate(ring, [0, 1], [0.4, 1])}) rotate(${frame * 0.15}deg)`,
          opacity: ring * 0.9,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 250,
          top: 690,
          width: 580,
          height: 580,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,212,184,0.18), transparent 65%)',
          filter: 'blur(20px)',
          opacity: ring,
        }}
      />

      <div style={{ transform: `translateY(${drift}px)` }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {LETTERS.map((l, i) => {
            const s = spring({
              frame: frame - 8 - i * 5,
              fps,
              config: { damping: 14, stiffness: 140 },
            });
            return (
              <span
                key={l}
                style={{
                  fontFamily: display,
                  fontWeight: 700,
                  fontSize: 250,
                  letterSpacing: -14,
                  color: i === 3 ? C.teal : C.text,
                  display: 'inline-block',
                  opacity: s,
                  transform: `translateY(${interpolate(s, [0, 1], [140, 0])}px) rotate(${interpolate(
                    s,
                    [0, 1],
                    [i % 2 ? 8 : -8, 0],
                  )}deg)`,
                }}
              >
                {l}
              </span>
            );
          })}
        </div>

        <Rise delay={34} style={{ marginTop: 18 }}>
          <Eyebrow>One app · every world</Eyebrow>
        </Rise>
      </div>
    </AbsoluteFill>
  );
};
