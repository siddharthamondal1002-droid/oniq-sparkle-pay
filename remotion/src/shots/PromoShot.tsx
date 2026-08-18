/**
 * One promo shot: Backdrop + a template, both scale-aware.
 *
 * Every size in here is written in `u` — 1/1080 of the FRAME'S SHORTER side —
 * so the same template composes correctly at 1080x1920, 1080x1080 and
 * 1920x1080 without three layouts. The backdrop is a self-contained copy of
 * the promo's (same maths, same colours) rather than an import, because the
 * promo's components pull theme.ts and theme.ts pulls Google Fonts at module
 * scope — the proxy trap the episodes' entry point exists to dodge.
 */
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { C, body, display } from './theme';
import { WORLDS, type Shot } from './library';

const useU = () => {
  const { width, height } = useVideoConfig();
  return Math.min(width, height) / 1080;
};

const Backdrop: React.FC<{ accent?: string }> = ({ accent = C.teal }) => {
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
          background: `radial-gradient(58% 40% at ${x}% ${y}%, ${accent}33, transparent 70%),
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

const Rise: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  delay = 0,
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 28 });
  return (
    <div
      style={{
        opacity: s,
        transform: `translateY(${interpolate(s, [0, 1], [56, 0])}px)`,
        filter: `blur(${interpolate(s, [0, 1], [14, 0])}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Shots close with a quick brand stamp so every clip signs itself. */
const BrandStamp: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const u = useU();
  const s = spring({
    frame: frame - (durationInFrames - Math.round(fps * 1.1)),
    fps,
    config: { damping: 200 },
    durationInFrames: 18,
  });
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 64 * u,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        opacity: s,
        transform: `translateY(${interpolate(s, [0, 1], [24, 0])}px)`,
      }}
    >
      <div
        style={{
          fontFamily: display,
          fontWeight: 700,
          fontSize: 40 * u,
          letterSpacing: 8 * u,
          color: C.text,
        }}
      >
        ONIQ
      </div>
    </div>
  );
};

const Eyebrow: React.FC<{ children: React.ReactNode; accent: string }> = ({ children, accent }) => {
  const u = useU();
  return (
    <div
      style={{
        fontFamily: body,
        fontWeight: 500,
        fontSize: 30 * u,
        letterSpacing: 6 * u,
        textTransform: 'uppercase',
        color: accent,
      }}
    >
      {children}
    </div>
  );
};

const Head: React.FC<{ lines: string[]; size?: number }> = ({ lines, size = 104 }) => {
  const u = useU();
  return (
    <div
      style={{
        fontFamily: display,
        fontWeight: 700,
        fontSize: size * u,
        lineHeight: 1.04,
        letterSpacing: -2.5 * u,
        color: C.text,
      }}
    >
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
};

const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const u = useU();
  return (
    <div style={{ fontFamily: body, fontWeight: 400, fontSize: 38 * u, color: C.muted }}>
      {children}
    </div>
  );
};

/* ------------------------------- templates ------------------------------- */

const Wordmark: React.FC<{ shot: Shot }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = useU();
  const ring = spring({ frame: frame - 4, fps, config: { damping: 18, stiffness: 90 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          position: 'absolute',
          width: 760 * u,
          height: 760 * u,
          borderRadius: '50%',
          border: `2px solid rgba(0,212,184,0.35)`,
          transform: `scale(${interpolate(ring, [0, 1], [0.4, 1])}) rotate(${frame * 0.15}deg)`,
          opacity: ring * 0.9,
        }}
      />
      <div style={{ display: 'flex', gap: 8 * u }}>
        {['O', 'N', 'I', 'Q'].map((l, i) => {
          const s = spring({
            frame: frame - 8 - i * 5,
            fps,
            config: { damping: 14, stiffness: 140 },
          });
          return (
            <div
              key={l}
              style={{
                fontFamily: display,
                fontWeight: 700,
                fontSize: 220 * u,
                color: C.text,
                opacity: s,
                transform: `translateY(${interpolate(s, [0, 1], [90, 0])}px)`,
              }}
            >
              {l}
            </div>
          );
        })}
      </div>
      <Rise delay={32}>
        <div
          style={{
            fontFamily: body,
            fontWeight: 500,
            fontSize: 42 * u,
            letterSpacing: 3 * u,
            color: C.teal,
            marginTop: 24 * u,
            textAlign: 'center',
          }}
        >
          {shot.sub}
        </div>
      </Rise>
    </AbsoluteFill>
  );
};

const Feature: React.FC<{ shot: Shot; accent: string }> = ({ shot, accent }) => {
  const frame = useCurrentFrame();
  const u = useU();
  const drift = Math.sin(frame / 45) * 10 * u;
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 96 * u }}>
      {shot.glyph && (
        <Rise delay={4}>
          <div
            style={{
              fontSize: 150 * u,
              lineHeight: 1,
              marginBottom: 34 * u,
              transform: `translateY(${drift}px)`,
            }}
          >
            {shot.glyph}
          </div>
        </Rise>
      )}
      {shot.eyebrow && (
        <Rise delay={10}>
          <div style={{ marginBottom: 18 * u }}>
            <Eyebrow accent={accent}>{shot.eyebrow}</Eyebrow>
          </div>
        </Rise>
      )}
      <Rise delay={16}>
        <Head lines={shot.head ?? []} />
      </Rise>
      {shot.sub && (
        <Rise delay={26}>
          <div style={{ marginTop: 26 * u }}>
            <Sub>{shot.sub}</Sub>
          </div>
        </Rise>
      )}
    </AbsoluteFill>
  );
};

const Stat: React.FC<{ shot: Shot; accent: string }> = ({ shot, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = useU();
  const pop = spring({ frame: frame - 6, fps, config: { damping: 13, stiffness: 120 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <div
        style={{
          fontFamily: display,
          fontWeight: 700,
          fontSize: 340 * u,
          lineHeight: 1,
          color: accent,
          transform: `scale(${interpolate(pop, [0, 1], [0.5, 1])})`,
          opacity: pop,
        }}
      >
        {shot.stat}
      </div>
      <Rise delay={16}>
        <div
          style={{
            fontFamily: display,
            fontWeight: 500,
            fontSize: 56 * u,
            color: C.text,
            marginTop: 8 * u,
          }}
        >
          {shot.statLabel}
        </div>
      </Rise>
      {shot.sub && (
        <Rise delay={26}>
          <div style={{ marginTop: 22 * u, maxWidth: 820 * u }}>
            <Sub>{shot.sub}</Sub>
          </div>
        </Rise>
      )}
    </AbsoluteFill>
  );
};

const ChatDemo: React.FC<{ shot: Shot; accent: string }> = ({ shot, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = useU();
  const bubbles = shot.bubbles ?? [];
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 96 * u }}>
      {shot.eyebrow && (
        <Rise delay={4}>
          <div style={{ marginBottom: 16 * u }}>
            <Eyebrow accent={accent}>{shot.eyebrow}</Eyebrow>
          </div>
        </Rise>
      )}
      <Rise delay={10}>
        <Head lines={shot.head ?? []} size={92} />
      </Rise>
      <div style={{ marginTop: 44 * u, display: 'flex', flexDirection: 'column', gap: 16 * u }}>
        {bubbles.map((b, i) => {
          const s = spring({
            frame: frame - 34 - i * 16,
            fps,
            config: { damping: 15, stiffness: 130 },
          });
          return (
            <div
              key={`${b.text}-${i}`}
              style={{
                alignSelf: b.mine ? 'flex-end' : 'flex-start',
                maxWidth: '78%',
                background: b.mine ? '#0d6e58' : C.surface,
                border: `1px solid ${b.mine ? 'rgba(255,255,255,0.12)' : C.line}`,
                borderRadius: 24 * u,
                borderTopLeftRadius: b.mine ? 24 * u : 8 * u,
                borderTopRightRadius: b.mine ? 8 * u : 24 * u,
                padding: `${18 * u}px ${26 * u}px`,
                fontFamily: body,
                fontWeight: 400,
                fontSize: 36 * u,
                color: C.text,
                opacity: s,
                transform: `translateY(${interpolate(s, [0, 1], [40, 0])}px) scale(${interpolate(
                  s,
                  [0, 1],
                  [0.9, 1],
                )})`,
              }}
            >
              {b.text}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const CallDemo: React.FC<{ shot: Shot; accent: string }> = ({ shot, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = useU();
  const FACES = ['🧑🏽', '👩🏻', '🧔🏾', '👧🏼'];
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 96 * u }}>
      {shot.eyebrow && (
        <Rise delay={4}>
          <div style={{ marginBottom: 16 * u }}>
            <Eyebrow accent={accent}>{shot.eyebrow}</Eyebrow>
          </div>
        </Rise>
      )}
      <Rise delay={10}>
        <Head lines={shot.head ?? []} size={92} />
      </Rise>
      <div
        style={{
          marginTop: 44 * u,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 18 * u,
          maxWidth: 700 * u,
        }}
      >
        {FACES.map((f, i) => {
          const s = spring({
            frame: frame - 30 - i * 8,
            fps,
            config: { damping: 15, stiffness: 120 },
          });
          const pulse = 1 + Math.sin(frame / 12 + i) * 0.012;
          return (
            <div
              key={f}
              style={{
                aspectRatio: '1',
                borderRadius: 28 * u,
                background: C.surface,
                border: `2px solid ${i === 0 ? accent : C.line}`,
                display: 'grid',
                placeItems: 'center',
                fontSize: 110 * u,
                opacity: s,
                transform: `scale(${s * pulse})`,
              }}
            >
              {f}
            </div>
          );
        })}
      </div>
      {shot.sub && (
        <Rise delay={40}>
          <div style={{ marginTop: 30 * u }}>
            <Sub>{shot.sub}</Sub>
          </div>
        </Rise>
      )}
    </AbsoluteFill>
  );
};

const Worlds: React.FC<{ shot: Shot; accent: string }> = ({ shot, accent }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const u = useU();
  // Each world gets its beat, then the roster settles into a grid read.
  const per = Math.max(6, Math.floor((durationInFrames - 60) / WORLDS.length));
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 90 * u }}>
      <Rise delay={2}>
        <div style={{ marginBottom: 22 * u }}>
          <Eyebrow accent={accent}>{shot.eyebrow}</Eyebrow>
        </div>
      </Rise>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 * u, maxWidth: 1100 * u }}>
        {WORLDS.map((w, i) => {
          const s = spring({
            frame: frame - 18 - i * per * 0.45,
            fps,
            config: { damping: 16, stiffness: 140 },
          });
          return (
            <div
              key={w}
              style={{
                fontFamily: display,
                fontWeight: 500,
                fontSize: 48 * u,
                color: i % 4 === 0 ? accent : C.text,
                background: C.surface,
                border: `1px solid ${C.line}`,
                borderRadius: 999,
                padding: `${12 * u}px ${30 * u}px`,
                opacity: s,
                transform: `translateY(${interpolate(s, [0, 1], [30, 0])}px)`,
              }}
            >
              {w}
            </div>
          );
        })}
      </div>
      <Rise delay={WORLDS.length * per * 0.45 + 8}>
        <div style={{ marginTop: 34 * u }}>
          <Head lines={['One login.']} size={96} />
        </div>
      </Rise>
    </AbsoluteFill>
  );
};

const Cta: React.FC<{ shot: Shot; accent: string }> = ({ shot, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = useU();
  const pulse = 1 + Math.sin(frame / 14) * 0.015;
  const btn = spring({ frame: frame - 34, fps, config: { damping: 14, stiffness: 110 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <Rise delay={4}>
        <Head lines={['One app.', 'Every world.']} size={120} />
      </Rise>
      <div
        style={{
          marginTop: 52 * u,
          background: accent,
          color: '#06231e',
          fontFamily: display,
          fontWeight: 700,
          fontSize: 46 * u,
          padding: `${24 * u}px ${64 * u}px`,
          borderRadius: 999,
          opacity: btn,
          transform: `scale(${btn * pulse})`,
          boxShadow: `0 0 ${60 * u}px rgba(0,212,184,0.35)`,
        }}
      >
        Get ONIQ
      </div>
      <Rise delay={48}>
        <div
          style={{
            marginTop: 26 * u,
            fontFamily: body,
            fontWeight: 500,
            fontSize: 36 * u,
            color: C.muted,
            letterSpacing: 2 * u,
          }}
        >
          {shot.sub}
        </div>
      </Rise>
    </AbsoluteFill>
  );
};

/* -------------------------------- dispatch -------------------------------- */

export const PromoShot: React.FC<{ shot: Shot }> = ({ shot }) => {
  const accent = shot.accent ?? C.teal;
  return (
    <AbsoluteFill>
      <Backdrop accent={accent} />
      {shot.template === 'wordmark' && <Wordmark shot={shot} />}
      {shot.template === 'feature' && <Feature shot={shot} accent={accent} />}
      {shot.template === 'stat' && <Stat shot={shot} accent={accent} />}
      {shot.template === 'chat' && <ChatDemo shot={shot} accent={accent} />}
      {shot.template === 'call' && <CallDemo shot={shot} accent={accent} />}
      {shot.template === 'worlds' && <Worlds shot={shot} accent={accent} />}
      {shot.template === 'cta' && <Cta shot={shot} accent={accent} />}
      {shot.template !== 'wordmark' && shot.template !== 'cta' && <BrandStamp />}
    </AbsoluteFill>
  );
};
