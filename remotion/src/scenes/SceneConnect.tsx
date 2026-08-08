import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, body, display } from '../theme';
import { Eyebrow, Headline, Rise } from '../components/Kit';

const LANGS = ['हिन्दी', 'বাংলা', 'தமிழ்', 'العربية', 'ગુજરાતી', 'English', 'मराठी', 'ಕನ್ನಡ'];

export const SceneConnect: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ padding: '200px 96px', justifyContent: 'center' }}>
      <Rise delay={0}>
        <Eyebrow>no cap</Eyebrow>
      </Rise>
      <Rise delay={8} style={{ marginTop: 20 }}>
        <Headline size={98}>
          Chat, call and
          <br />
          be understood
          <br />
          <span style={{ color: C.teal }}>in your language.</span>
        </Headline>
      </Rise>

      <div
        style={{
          marginTop: 76,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 18,
        }}
      >
        {LANGS.map((l, i) => {
          const s = spring({
            frame: frame - 26 - i * 5,
            fps,
            config: { damping: 13, stiffness: 190 },
          });
          const float = Math.sin((frame + i * 26) / 30) * 4;
          return (
            <div
              key={l}
              style={{
                fontFamily: body,
                fontSize: 40,
                color: i % 3 === 0 ? C.teal : C.text,
                border: `1px solid ${i % 3 === 0 ? 'rgba(0,212,184,0.45)' : C.line}`,
                background: C.surface,
                borderRadius: 999,
                padding: '16px 34px',
                opacity: s,
                transform: `translateY(${interpolate(s, [0, 1], [40, float])}px) scale(${interpolate(
                  s,
                  [0, 1],
                  [0.8, 1],
                )})`,
              }}
            >
              {l}
            </div>
          );
        })}
      </div>

      <Rise delay={80} style={{ marginTop: 54 }}>
        <span style={{ fontFamily: display, fontSize: 34, color: C.muted, letterSpacing: -0.5 }}>
          56 languages · voice &amp; video calls · Moments
        </span>
      </Rise>
    </AbsoluteFill>
  );
};
