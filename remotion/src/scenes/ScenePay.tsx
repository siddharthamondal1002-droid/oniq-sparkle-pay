import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, body, display } from '../theme';
import { Card, Eyebrow, Headline, Rise } from '../components/Kit';

export const ScenePay: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const s = spring({ frame: frame - 26, fps, config: { damping: 18, stiffness: 120 } });
  const amount = Math.round(interpolate(s, [0, 1], [0, 2450]));
  const tick = spring({ frame: frame - 62, fps, config: { damping: 12, stiffness: 200 } });

  return (
    <AbsoluteFill style={{ padding: '190px 96px', justifyContent: 'center' }}>
      <Rise delay={0}>
        <Eyebrow>the bag 💰</Eyebrow>
      </Rise>
      <Rise delay={8} style={{ marginTop: 20 }}>
        <Headline size={100}>
          Send. Split.
          <br />
          <span style={{ color: C.teal }}>Scan &amp; pay.</span>
        </Headline>
      </Rise>

      <Card
        style={{
          marginTop: 70,
          padding: 46,
          opacity: s,
          transform: `translateY(${interpolate(s, [0, 1], [70, 0])}px)`,
          boxShadow: '0 40px 90px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{ fontFamily: body, fontSize: 30, color: C.muted }}>Sending to Meera</div>
        <div
          style={{
            fontFamily: display,
            fontWeight: 700,
            fontSize: 132,
            letterSpacing: -5,
            color: C.text,
            marginTop: 8,
          }}
        >
          ₹{amount.toLocaleString('en-IN')}
        </div>
        <div
          style={{
            marginTop: 26,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            opacity: tick,
            transform: `scale(${interpolate(tick, [0, 1], [0.7, 1])})`,
          }}
        >
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: '50%',
              background: C.teal,
              color: C.bg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 34,
              fontFamily: display,
              fontWeight: 700,
            }}
          >
            ✓
          </div>
          <span style={{ fontFamily: body, fontSize: 34, color: C.teal }}>Paid in a second</span>
        </div>
      </Card>

      <Rise delay={84} style={{ marginTop: 40 }}>
        <span style={{ fontFamily: body, fontSize: 30, color: C.muted }}>
          UPI · red packets · requests · linked banks
        </span>
      </Rise>
    </AbsoluteFill>
  );
};
