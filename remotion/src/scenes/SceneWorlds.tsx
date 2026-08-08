import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, body, display } from '../theme';
import { Eyebrow, Headline, Rise } from '../components/Kit';

const TILES: { label: string; glyph: string; accent?: boolean }[] = [
  { label: 'Study', glyph: '📚', accent: true },
  { label: 'Pay', glyph: '₹' },
  { label: 'Chat', glyph: '💬' },
  { label: 'Jobs', glyph: '💼' },
  { label: 'Vanderlust', glyph: '✈' },
  { label: 'Vitals', glyph: '✚' },
  { label: 'Rides', glyph: '🚗' },
  { label: 'Faith', glyph: '🪷' },
  { label: 'Moments', glyph: '✦' },
];

export const SceneWorlds: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ padding: '150px 96px', justifyContent: 'center' }}>
      <Rise delay={2}>
        <Eyebrow>nine worlds, one login</Eyebrow>
      </Rise>
      <Rise delay={10} style={{ marginTop: 20 }}>
        <Headline size={96}>
          Everything
          <br />
          <span style={{ color: C.teal }}>in one place.</span>
        </Headline>
      </Rise>

      <div
        style={{
          marginTop: 76,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 26,
        }}
      >
        {TILES.map((t, i) => {
          const s = spring({
            frame: frame - 24 - i * 4,
            fps,
            config: { damping: 16, stiffness: 170 },
          });
          const float = Math.sin((frame + i * 20) / 34) * 5;
          return (
            <div
              key={t.label}
              style={{
                background: t.accent ? 'rgba(0,212,184,0.12)' : C.surface,
                border: `1px solid ${t.accent ? 'rgba(0,212,184,0.45)' : C.line}`,
                borderRadius: 30,
                height: 250,
                padding: 26,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                opacity: s,
                transform: `translateY(${interpolate(s, [0, 1], [70, float])}px) scale(${interpolate(
                  s,
                  [0, 1],
                  [0.86, 1],
                )})`,
              }}
            >
              <div style={{ fontSize: 62, fontFamily: display, color: C.text }}>{t.glyph}</div>
              <div
                style={{
                  fontFamily: body,
                  fontSize: 32,
                  fontWeight: 500,
                  color: t.accent ? C.teal : C.muted,
                }}
              >
                {t.label}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
