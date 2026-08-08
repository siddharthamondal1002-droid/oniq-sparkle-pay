import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, body, display } from '../theme';

export const SceneClose: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const mark = spring({ frame, fps, config: { damping: 15, stiffness: 120 } });
  const line = spring({ frame: frame - 22, fps, config: { damping: 200 }, durationInFrames: 34 });
  const url = spring({ frame: frame - 44, fps, config: { damping: 200 }, durationInFrames: 26 });
  const breathe = 1 + Math.sin(frame / 32) * 0.012;

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          fontFamily: display,
          fontWeight: 700,
          fontSize: 210,
          letterSpacing: -12,
          color: C.text,
          opacity: mark,
          transform: `scale(${interpolate(mark, [0, 1], [0.7, breathe])})`,
        }}
      >
        ONI<span style={{ color: C.teal }}>Q</span>
      </div>

      <div
        style={{
          width: interpolate(line, [0, 1], [0, 520]),
          height: 2,
          background: `linear-gradient(90deg, transparent, ${C.teal}, transparent)`,
          marginTop: 12,
        }}
      />

      <div
        style={{
          marginTop: 34,
          fontFamily: body,
          fontSize: 42,
          letterSpacing: 8,
          textTransform: 'uppercase',
          color: C.muted,
          opacity: line,
          transform: `translateY(${interpolate(line, [0, 1], [24, 0])}px)`,
        }}
      >
        One app. Every world.
      </div>

      <div
        style={{
          marginTop: 60,
          fontFamily: display,
          fontSize: 38,
          color: C.teal,
          opacity: url,
        }}
      >
        oniqhub.com
      </div>
    </AbsoluteFill>
  );
};
