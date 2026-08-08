import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, display, body } from '../theme';

/** Default entrance: rise + blur-to-sharp. One system, used everywhere. */
export const Rise: React.FC<{
  delay?: number;
  distance?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ delay = 0, distance = 56, children, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 28 });
  return (
    <div
      style={{
        opacity: s,
        transform: `translateY(${interpolate(s, [0, 1], [distance, 0])}px)`,
        filter: `blur(${interpolate(s, [0, 1], [14, 0])}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = C.teal,
}) => (
  <div
    style={{
      fontFamily: body,
      fontSize: 30,
      letterSpacing: 6,
      textTransform: 'uppercase',
      color,
      fontWeight: 500,
    }}
  >
    {children}
  </div>
);

export const Headline: React.FC<{
  children: React.ReactNode;
  size?: number;
  color?: string;
}> = ({ children, size = 108, color = C.text }) => (
  <div
    style={{
      fontFamily: display,
      fontWeight: 700,
      fontSize: size,
      lineHeight: 1.02,
      letterSpacing: -3,
      color,
    }}
  >
    {children}
  </div>
);

export const Card: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => (
  <div
    style={{
      background: C.surface,
      border: `1px solid ${C.line}`,
      borderRadius: 32,
      padding: 34,
      ...style,
    }}
  >
    {children}
  </div>
);
