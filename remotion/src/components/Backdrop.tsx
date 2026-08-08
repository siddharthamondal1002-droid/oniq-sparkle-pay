import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { C } from '../theme';

// Persistent layer: a slow drifting teal bloom + fine grid. Never static.
export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / durationInFrames;

  const x = 50 + Math.sin(frame / 90) * 18;
  const y = 30 + Math.cos(frame / 130) * 22;
  const emberY = 80 + Math.sin(frame / 110 + 2) * 14;
  const gridShift = interpolate(t, [0, 1], [0, -120]);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(58% 40% at ${x}% ${y}%, rgba(0,212,184,0.20), transparent 70%),
                       radial-gradient(46% 34% at 22% ${emberY}%, rgba(255,138,61,0.13), transparent 72%)`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.35,
          transform: `translateY(${gridShift}px)`,
          backgroundImage: `linear-gradient(${C.line} 1px, transparent 1px),
                            linear-gradient(90deg, ${C.line} 1px, transparent 1px)`,
          backgroundSize: '120px 120px',
          maskImage: 'radial-gradient(70% 60% at 50% 45%, black, transparent 85%)',
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(14,15,19,0.75) 0%, transparent 22%, transparent 78%, rgba(14,15,19,0.85) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};
