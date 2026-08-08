import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, body } from '../theme';
import { Card, Eyebrow, Headline, Rise } from '../components/Kit';

const LINES = [
  'Explain Newton’s third law like I’m 12.',
  'Give me a 30-mark practice paper.',
  'Grade my written answer.',
];

export const SceneStudy: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ padding: '170px 96px', justifyContent: 'center' }}>
      <Rise delay={0}>
        <Eyebrow color={C.ember}>study 📚</Eyebrow>
      </Rise>
      <Rise delay={8} style={{ marginTop: 20 }}>
        <Headline size={98}>
          A tutor that
          <br />
          knows your
          <br />
          <span style={{ color: C.ember }}>syllabus.</span>
        </Headline>
      </Rise>

      <div style={{ marginTop: 66, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {LINES.map((l, i) => {
          const s = spring({
            frame: frame - 30 - i * 12,
            fps,
            config: { damping: 20, stiffness: 130 },
          });
          return (
            <Card
              key={l}
              style={{
                alignSelf: i % 2 ? 'flex-start' : 'flex-end',
                maxWidth: 720,
                borderColor: i % 2 ? C.line : 'rgba(0,212,184,0.4)',
                background: i % 2 ? C.surface : 'rgba(0,212,184,0.1)',
                opacity: s,
                transform: `translateX(${interpolate(s, [0, 1], [i % 2 ? -60 : 60, 0])}px)`,
              }}
            >
              <span style={{ fontFamily: body, fontSize: 36, color: C.text, lineHeight: 1.35 }}>
                {l}
              </span>
            </Card>
          );
        })}
      </div>

      <Rise delay={78} style={{ marginTop: 44 }}>
        <span style={{ fontFamily: body, fontSize: 30, color: C.muted }}>
          CBSE · ICSE · State boards · JEE · NEET · CLAT
        </span>
      </Rise>
    </AbsoluteFill>
  );
};
