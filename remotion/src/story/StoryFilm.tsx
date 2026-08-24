// A whole Story, rendered from a plan.
//
// The worker's picture stage. Everything above it — Ting's plot, the Gemini
// stills, the narration — arrives as a plan object; this turns it into frames.
//
// SHOT STRUCTURE IS EPISODE 3's, because that is the arrangement that survived
// a seven-minute film and five render passes:
//   - Hard cuts BETWEEN shots, so sum(shot frames) === total frames exactly and
//     there is no transition arithmetic to get wrong.
//   - Ken Burns per shot, easing to identity at the cut so the artificial
//     camera comes to rest exactly where the next shot picks up.
//   - Narration is the clock. Shot length comes from the measured audio, never
//     from a word-count estimate, because an estimate drifts further out of
//     sync with every shot.
//
// PROPS, NOT IMPORTS. The plan arrives through inputProps rather than a
// committed manifest, because every Story is different and there is nothing to
// commit. That makes this the one composition in the project whose duration is
// not knowable at bundle time, which is why calculateMetadata exists below.
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Freeze,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { KEN_BURNS_SCALE } from "../../../src/lib/episodeTimeline";
import {
  REST,
  buildMouthCues,
  cuesFromRhubarb,
  segmentsFromSpans,
  visemeAtFrame,
  type MouthCue,
  type RhubarbCue,
} from "../../../src/lib/visemes";
import { PARALLAX } from "../../../src/lib/parallaxPlanes";
import { ambientVolumeAt, scoreVolumeAt } from "../../../src/lib/soundStage";
import { TITLE_SECONDS, endFadeAt, titleOpacityAt } from "../../../src/lib/filmChrome";
import { type VfxKind, vfxSeed } from "../../../src/lib/particleField";
import { livingSubjectMotion } from "../../../src/lib/livingMotion";
import type { PuppetPerformance } from "../../../src/lib/puppetPerformance";
import type { Emotion } from "../../../src/lib/expressionGrammar";
import { Character } from "../rig/Character";
import { CHARACTER_RIGS } from "../rig/characterRig";
import { EXPRESSION_HEADS } from "../rig/expressionHeads";
import { ParticleOverlay } from "./ParticleOverlay";

export type StoryShotInput = {
  /** Path under remotion/public, or an absolute URL. */
  still: string;
  /** Narration audio for this shot, same addressing as `still`. */
  audio?: string;
  /** Measured length. The worker fills this from ffprobe, never from words. */
  seconds: number;
  /**
   * Camera travel for this shot as a fraction of frame, 0 for a locked shot.
   *
   * MEASURED FROM THE REAL CLIPS, not a house constant: end-to-end drift across
   * six ep3 clips ran 0.0%, 0.0%, 0.0%, 1.7%, 3.3%, 5.1% and 19.2% — half of
   * them locked off. A uniform Ken Burns on everything is what the STILLS
   * pipeline did, where the move is a substitute for motion rather than a
   * description of it.
   */
  travel?: number;
  /** Which way it drifts. Ignored when travel is 0. */
  pan?: "left" | "right" | "up" | "down" | "in";
  /**
   * Figure height as a fraction of frame, from the shot size.
   *
   * A character framed the same in an establisher and a close-up is the thing
   * that makes a rig read as a sticker rather than a performance. shotGrammar
   * derives this from the size word Ting wrote.
   */
  figureHeight?: number;
  /**
   * The 2.5D near plane: the same still with depth-derived alpha, cut by the
   * worker's MiDaS stage. When present it rides ABOVE the base at
   * PARALLAX.nearRate of the camera move — near things moving more than far
   * things is the entire difference between "the camera moved through the
   * scene" and "the image was zoomed". Absent (depth failed, coverage gate
   * refused, model unreachable) the shot is pixel-identical to the shipped
   * Ken Burns: the base layer below carries EXACTLY the old transform.
   */
  parallax?: {
    /** Path under remotion/public, same addressing as `still`. */
    near?: string;
    /**
     * Rung 1, movie grade only: the band between midThreshold and threshold,
     * riding between base and near at PARALLAX.midRate. Three depths of
     * motion instead of two — the worker only cuts it for movie jobs, so a
     * classic film stays pixel-identical to the shipped two-plane look.
     */
    mid?: string;
  };
  /**
   * REAL MOTION — a Veo clip generated from this shot's still as its starting
   * frame (movie grade). When present it replaces the whole simulated stack:
   * no Ken Burns, no parallax plane, no rig puppet, because the video model
   * animated the frame itself and a second performance on top would disagree
   * with it.
   *
   * MUTED ALWAYS. Veo generates its own soundtrack and mixing it under the
   * narration is the same class of failure as the two audio bugs already
   * shipped (ep3 ingest trap #1). Narration stays the clock.
   *
   * `frames` is MEASURED by the worker (ffprobe, minus a two-frame safety
   * margin) — never derived from the seconds Veo was asked for, because what
   * it returns is what it returns. When the shot outlasts the clip, the last
   * decodable frame holds under a barely-perceptible push — the same
   * steal-the-tail-from-the-clip-itself lesson ep3 ended on, done in the
   * composition instead of ffmpeg.
   */
  clip?: {
    /** Path under remotion/public, same addressing as `still`. */
    src: string;
    /** Usable clip length in composition frames, measured by the worker. */
    frames: number;
    /**
     * KEEP THE PROVIDER'S OWN SOUNDTRACK ON THIS SHOT.
     *
     * Absent or false = muted, which stays the default for a very concrete
     * reason: ONIQ Stories are narration-as-clock, and the shot's TTS dialogue
     * is already concatenated into that narration wav. Unmuting a narrated
     * shot does not enrich it — it lays a second, unsynchronised voice reading
     * different words over the first.
     *
     * The worker sets this true only for a shot the audio router put in
     * VEO_NATIVE_AUDIO: no ONIQ narration, no ONIQ dialogue, and sound the
     * scene genuinely needs frame-locked to the picture (speech, an explosion,
     * footsteps). On that shot the native track is the whole point, and Veo
     * generated it whether ONIQ used it or not — on the Gemini Developer API
     * there is no parameter to decline it — so discarding it is pure waste.
     */
    preserveAudio?: boolean;
    /** Gain for the preserved native track, under any ONIQ bed. Default 1. */
    audioVolume?: number;
  };
  /**
   * A rigged character standing in this shot, breathing and speaking.
   *
   * OPTIONAL BECAUSE MOST SHOTS DO NOT HAVE ONE. Episode 3 measured 34 of 60
   * shots with no face in them — a hand on a spindle, a wide of the city, a
   * lamp on a shelf. Putting a puppet in every shot would be worse than
   * putting one in none.
   */
  character?: {
    /** Key into CHARACTER_RIGS. Only measured characters are in there. */
    rig: string;
    /** What they say in this shot. Drives the mouth shapes. */
    text: string;
    /**
     * Measured [start, end) frames of actual voice, from measure-speech.mjs.
     *
     * Without this the mouth has nowhere to rest: pause CENTRES tile a scene
     * end to end, which measured 0% rest across all sixteen ep3 scenes — a
     * character talking continuously for seven minutes through every pause.
     */
    speech: [number, number][];
    /**
     * A LISTENED mouth, when the worker managed to hear one.
     *
     * Rhubarb ran a phone recognizer over the shot's actual audio and said
     * which shape the mouth makes when — against that, the text heuristic
     * below is a guess that merely looks like talking. Shipped RAW, in
     * Rhubarb's own seconds, because the frames conversion needs fps and
     * lives in cuesFromRhubarb — which this file can import and the worker
     * cannot (visemes.ts's extensionless internal imports defeat Node's
     * type-stripping outside a bundler). Absent means the Rhubarb pass
     * failed and the guess carries the shot — the same graceful step-down
     * the dialogue path takes.
     */
    heard?: RhubarbCue[];
    /**
     * Rung 4, movie grade only: the body language. The worker computes the
     * eyeline over the whole plan (conversationFacings), reads the gait off
     * the shot's own words (walkFor), and seeds the phases from the shot's
     * identity. Absent — every classic film — the puppet renders exactly
     * the rung-2 markup, pixel-identical.
     */
    performance?: PuppetPerformance;
    /**
     * Rung 5, movie grade only: the emotional register the shot's words
     * earned (emotionFor). The composition resolves it against
     * EXPRESSION_HEADS — a character with no drawn face for the feeling
     * silently keeps the base head, so the worker never needs to know
     * which sheets carry which busts.
     */
    expression?: Emotion;
  };
  /**
   * Rung 6, movie grade only: the SECOND figure of a two-shot. When the
   * shot's words put two rigged cast members in the same frame (and the
   * framing is full or wider — two figures cannot share a close-up), the
   * worker stages the conversation in one frame instead of cutting
   * between singles: primary on one third, companion answering from the
   * other. `speaks` routes the shot's mouth cues — true and the companion
   * mouths them while the primary listens at rest; false and the mouth
   * stays on the primary exactly as in every single. Absent — every
   * classic film and every solitary shot — nothing changes.
   */
  companion?: {
    /** Key into CHARACTER_RIGS, same contract as character.rig. */
    rig: string;
    /** The dialogue names this figure as the shot's speaker. */
    speaks?: boolean;
    /** Same speech spans as the primary — pose gestures gate on speaking. */
    speech?: [number, number][];
    performance?: PuppetPerformance;
    expression?: Emotion;
  };
  /**
   * Rung 8, movie grade only: the scene's ambient bed — wind, rain, surf,
   * fire, cave air or night crickets, chosen from the shot's own words
   * (ambienceFor) and synthesized deterministically by the worker. Plays
   * UNDER the narration at AMBIENT_GAIN with faded edges; absent for
   * scenes whose words earn no air, and for every classic film. Unlike
   * the particle overlay this DOES ride under clips — a clip is muted unless
   * its shot was routed to VEO_NATIVE_AUDIO, so on most clips the bed is the
   * only sound the shot has.
   */
  ambience?: {
    /** Path under remotion/public, same addressing as `still`. */
    src: string;
    /** Which bed, for logs and tests. */
    kind: string;
  };
  /**
   * Rung 3, movie grade only: a procedural particle atmosphere over the
   * shot — embers, dust, rain, snow or fireflies, chosen by the worker from
   * the shot's own words (vfxKindFor). Deterministic from the seed; absent
   * for scenes whose text earns no effect, and for every classic film.
   */
  vfx?: {
    kind: VfxKind;
    seed: number;
  };
};

export type StoryFilmProps = {
  title: string;
  shots: StoryShotInput[];
  fps?: number;
  /**
   * The ONIQ mark, burned into the frames. DEFAULTS ON — absence of the flag
   * means watermarked, so an old worker or a missing column can never ship a
   * clean film by accident. Removal is a paid addon (story_addons,
   * 'watermark_removal'); the worker passes false only when the job row says
   * no_watermark.
   */
  watermark?: boolean;
  /**
   * Rung 9: the job's grade, straight off the job row. Movie films open
   * with a title card over the first shot and close on a fade to black —
   * neither adds a frame, because Story seconds are paid seconds. Absent
   * or 'classic' renders exactly the shipped film, chrome-free.
   */
  grade?: "classic" | "movie";
  /**
   * Rung 11, movie grade only: the film-level drone — one chord in the
   * film's aggregated register (scoreFor), held under everything at
   * SCORE_GAIN with SCORE_FADE_SECONDS edges. Below the ambient beds,
   * which are below the voice. Absent when the shots earned no register,
   * and for every classic film.
   */
  score?: {
    /** Path under remotion/public, same addressing as shot stills. */
    src: string;
    /** The register, for logs and tests. */
    kind: string;
  };
};

export const STORY_FPS = 30;

/** Frames per shot, and the total. One place, so the two cannot disagree. */
export function storyFrames(shots: StoryShotInput[], fps = STORY_FPS): number[] {
  return shots.map((s) => Math.max(1, Math.round(s.seconds * fps)));
}

/**
 * Remotion asks this for the duration before rendering a frame.
 *
 * It THROWS on an empty plan rather than returning zero. A zero-frame
 * composition renders "successfully" to a file with no video stream, which
 * passes any check that only looks at the exit code — the same shape of silent
 * failure as episode one's unmounted narration.
 */
export const calculateStoryMetadata = ({ props }: { props: StoryFilmProps }) => {
  const fps = props.fps ?? STORY_FPS;
  if (!props.shots || props.shots.length === 0) {
    throw new Error("StoryFilm: a plan with no shots cannot be rendered");
  }
  const total = storyFrames(props.shots, fps).reduce((a, b) => a + b, 0);
  return { durationInFrames: total, fps };
};

/** Resolve a plan path: absolute URLs pass through, everything else is static. */
function src(path: string): string {
  return /^https?:\/\//.test(path) ? path : staticFile(path);
}

const StoryShot: React.FC<{ shot: StoryShotInput; durationInFrames: number }> = ({
  shot,
  durationInFrames,
}) => {
  // EVERY HOOK ABOVE EVERY EARLY RETURN. rules-of-hooks is a release blocker
  // in this repo and there are no early returns below.
  const frame = useCurrentFrame();

  // Built once per shot rather than per frame: buildMouthCues walks the whole
  // shot on every call, and a per-frame rebuild is both wasteful and the only
  // way the track could ever disagree with itself between two frames.
  const { fps } = useVideoConfig();
  const cues = React.useMemo<MouthCue[]>(() => {
    if (!shot.character) return [];
    // The LISTENED mouth wins when the worker delivered one; the spelled
    // guess is the fallback, not a second opinion.
    if (shot.character.heard && shot.character.heard.length > 0) {
      return cuesFromRhubarb(shot.character.heard, fps, durationInFrames);
    }
    return buildMouthCues(
      shot.character.text,
      segmentsFromSpans(shot.character.speech, durationInFrames),
      durationInFrames,
    );
  }, [shot.character, fps, durationInFrames]);

  const travel = shot.travel ?? 0;

  // Eased to identity at the END of the shot. The cut then lands on a frame
  // where the camera is at rest, which is what stops a hard cut reading as a
  // jolt — the ep3 lesson about easing to identity at a seam.
  const t = durationInFrames > 1 ? frame / (durationInFrames - 1) : 1;
  const eased = interpolate(t, [0, 1], [1, 0], { extrapolateRight: "clamp" });
  const amount = travel * eased;

  // A PUSH IS PROPORTIONAL TO TRAVEL, not a house constant. Three sizes push
  // in now — full, medium and close — and giving them all the same
  // KEN_BURNS_SCALE would throw away the measured proportionality that makes a
  // close-up hold while an establisher sweeps. PUSH_GAIN is set so `full`
  // (travel 0.033) lands on the 0.06 the episodes used, which is the one value
  // here with a look anybody has actually watched and approved.
  const PUSH_GAIN = KEN_BURNS_SCALE / 0.033;
  const zoom = shot.pan === "in" ? 1 + travel * PUSH_GAIN * eased : 1 + travel * 0.15;
  const x = shot.pan === "left" ? -amount * 100 : shot.pan === "right" ? amount * 100 : 0;
  const y = shot.pan === "up" ? -amount * 100 : shot.pan === "down" ? amount * 100 : 0;

  // LIVING-SUBJECT MOTION — the fix for "nobody moves". The depth-cut near
  // plane (the foreground / subject) breathes and sways on its own seeded
  // rhythm, INDEPENDENT of the camera, so the person in the frame is alive
  // rather than a static plate. The mid plane follows at half amplitude; the
  // base stays put (it is the background). Only where a near plane exists —
  // movie grade — so classic films are pixel-identical. Never over a clip: a
  // Veo scene already moves.
  const livingSeed = vfxSeed(shot.still);
  const near = livingSubjectMotion(frame, fps, livingSeed, 1);
  const mid = livingSubjectMotion(frame, fps, livingSeed, 0.5);

  // The clip's usable length inside THIS shot — its own tail is the one trim
  // site, exactly ep3's rule. Whatever narration outlasts it is carried by
  // the last live frame under a smoothstepped push: at rest when the freeze
  // begins (no jolt where the real motion stops) and at rest again at the
  // cut (the ease-to-identity seam rule).
  const clipFrames = shot.clip ? Math.min(shot.clip.frames, durationInFrames) : 0;
  const tailSpan = durationInFrames - clipFrames;
  const tailT = tailSpan > 1 ? Math.min(1, Math.max(0, (frame - clipFrames) / (tailSpan - 1))) : 1;
  const tailZoom = 1 + 0.04 * tailT * tailT * (3 - 2 * tailT);

  return (
    <AbsoluteFill style={{ backgroundColor: "#05040a", overflow: "hidden" }}>
      {shot.clip ? (
        <>
          <Sequence durationInFrames={clipFrames}>
            {/* Muted by DEFAULT, not unconditionally. See `preserveAudio`:
                a narrated shot cannot carry a second voice, but a shot the
                audio router put in VEO_NATIVE_AUDIO exists precisely so its
                generated sound reaches the film. */}
            <OffthreadVideo
              muted={!shot.clip.preserveAudio}
              volume={shot.clip.preserveAudio ? (shot.clip.audioVolume ?? 1) : undefined}
              src={src(shot.clip.src)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </Sequence>
          {tailSpan > 0 ? (
            <Sequence from={clipFrames}>
              <AbsoluteFill style={{ transform: `scale(${tailZoom})` }}>
                {/* The tail is ONE HELD FRAME. Always muted, whatever the
                    shot's audio mode: a frozen frame with a running audio
                    track would replay the clip's sound under a still image. */}
                <Freeze frame={Math.max(0, clipFrames - 1)}>
                  <OffthreadVideo
                    muted
                    src={src(shot.clip.src)}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </Freeze>
              </AbsoluteFill>
            </Sequence>
          ) : null}
        </>
      ) : (
        <Img
          src={src(shot.still)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${zoom}) translate(${x}%, ${y}%)`,
          }}
        />
      )}
      {!shot.clip && shot.parallax?.mid ? (
        /* The mid plane rides UNDER the near plane and OVER the base, at its
           own gentler rate — three depths of motion. Same cover-gain trick as
           the near plane, scaled to its smaller excursion. */
        <Img
          src={src(shot.parallax.mid)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${zoom + travel * PARALLAX.midCoverGain + mid.scale}) translate(${
              x * PARALLAX.midRate + mid.dx
            }%, ${y * PARALLAX.midRate + mid.dy}%)`,
          }}
        />
      ) : null}
      {!shot.clip && shot.parallax?.near ? (
        /* The near plane: same eased move, amplified by nearRate, with extra
           zoom proportional to travel so its faster excursion never reveals
           its own edge. The full-frame base behind it backs every pixel the
           cutout's edge uncovers, which is why no inpainting is needed at
           these move sizes. */
        <Img
          src={src(shot.parallax.near)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${zoom + travel * PARALLAX.nearCoverGain + near.scale}) translate(${
              x * PARALLAX.nearRate + near.dx
            }%, ${y * PARALLAX.nearRate + near.dy}%)`,
          }}
        />
      ) : null}
      {/* The character stands OUTSIDE the camera transform above, because the
          still is the plate and the puppet is a layer on it — scaling both by
          the same Ken Burns would slide the figure across the ground it is
          standing on. Never over a clip: Veo already animated whoever is in
          the frame, and a puppet on top is a second, disagreeing performance. */}
      {!shot.clip && shot.character && CHARACTER_RIGS[shot.character.rig] ? (
        <Character
          rig={CHARACTER_RIGS[shot.character.rig]}
          // Rung 6: in a two-shot whose line belongs to the companion, the
          // primary LISTENS — mouth at rest while the cues drive the other
          // figure. Alone, or holding the line, it mouths them as always.
          viseme={shot.companion?.speaks ? REST : visemeAtFrame(cues, frame)}
          heightRatio={shot.figureHeight}
          // Rung 4: the body language, when the worker attached one. The
          // cue track doubles as the gesture's beat source — the same
          // mouth that speaks decides when the body leans on a word.
          performance={shot.character.performance}
          cues={cues}
          speech={shot.character.speech}
          durationInFrames={durationInFrames}
          // Rung 5: the drawn face for the shot's feeling, if this
          // character has one. Undefined for every unmeasured character
          // and every classic film — the base head is the default.
          expressionHead={
            shot.character.expression
              ? EXPRESSION_HEADS[shot.character.rig]?.[shot.character.expression]
              : undefined
          }
        />
      ) : null}
      {!shot.clip && shot.companion && CHARACTER_RIGS[shot.companion.rig] ? (
        // Rung 6: the other half of the two-shot, staged by the worker on
        // the opposite third with the answering eyeline. Same component,
        // same contracts — the only asymmetry is who owns the mouth cues.
        <Character
          rig={CHARACTER_RIGS[shot.companion.rig]}
          viseme={shot.companion.speaks ? visemeAtFrame(cues, frame) : REST}
          heightRatio={shot.figureHeight}
          performance={shot.companion.performance}
          cues={cues}
          speech={shot.companion.speech}
          durationInFrames={durationInFrames}
          expressionHead={
            shot.companion.expression
              ? EXPRESSION_HEADS[shot.companion.rig]?.[shot.companion.expression]
              : undefined
          }
        />
      ) : null}
      {/* The atmosphere rides ABOVE the character and the depth stack:
          embers and rain pass in front of people, which is what puts the
          person IN the weather. Never over a clip — Veo scenes carry their
          own air. */}
      {!shot.clip && shot.vfx ? (
        <ParticleOverlay kind={shot.vfx.kind} seed={shot.vfx.seed} />
      ) : null}

      {/* Mounted INSIDE the shot so it starts with it. Episode 1 shipped as a
          4:47 silent slideshow with every mp3 generated and none referenced,
          and no still-frame check would have caught it. */}
      {shot.audio ? <Audio src={src(shot.audio)} /> : null}
      {/* Rung 8: the scene's air, UNDER the narration at a fixed gain with
          faded edges — one constant and two fades, nothing cleverer, because
          both ep3 audio bugs were mixing surprises. Plays under clips too —
          and on a VEO_NATIVE_AUDIO shot it sits under the clip's own track,
          which is why that track carries its own `audioVolume`. */}
      {shot.ambience ? (
        <Audio
          src={src(shot.ambience.src)}
          volume={(f) => ambientVolumeAt(f, durationInFrames, fps)}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * Rung 9's opening: the film's name over the first shot, serif and
 * letterspaced like a picture that expects to be watched, on a soft
 * radial scrim so it reads over any still. Mounted in a Sequence, so the
 * frame here is title-relative.
 */
const TitleCard: React.FC<{ title: string; fps: number }> = ({ title, fps }) => {
  const frame = useCurrentFrame();
  const opacity = titleOpacityAt(frame, fps);
  if (opacity <= 0) return null;
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity,
        pointerEvents: "none",
        background:
          "radial-gradient(ellipse 60% 42% at 50% 50%, rgba(4,3,10,0.62), rgba(4,3,10,0) 72%)",
      }}
    >
      <div
        style={{
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontWeight: 600,
          fontSize: 76,
          letterSpacing: 10,
          textTransform: "uppercase",
          textAlign: "center",
          maxWidth: "78%",
          lineHeight: 1.25,
          color: "rgba(246,241,230,0.96)",
          textShadow: "0 2px 26px rgba(0,0,0,0.75)",
        }}
      >
        {title}
      </div>
    </AbsoluteFill>
  );
};

/** Rung 9's close: the last seconds easing to black. Root-mounted, so the
    frame here is the film's own clock. */
const EndFade: React.FC<{ totalFrames: number; fps: number }> = ({ totalFrames, fps }) => {
  const frame = useCurrentFrame();
  const opacity = endFadeAt(frame, totalFrames, fps);
  if (opacity <= 0) return null;
  return <AbsoluteFill style={{ backgroundColor: "#05040a", opacity, pointerEvents: "none" }} />;
};

export const StoryFilm: React.FC<StoryFilmProps> = ({
  title,
  shots,
  fps,
  watermark,
  grade,
  score,
}) => {
  const { fps: configFps } = useVideoConfig();
  const usedFps = fps ?? configFps;
  const perShot = storyFrames(shots, usedFps);
  const totalFrames = perShot.reduce((a, b) => a + b, 0);

  let at = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "#05040a" }}>
      {shots.map((shot, i) => {
        const from = at;
        at += perShot[i];
        return (
          <Sequence key={i} from={from} durationInFrames={perShot[i]}>
            <StoryShot shot={shot} durationInFrames={perShot[i]} />
          </Sequence>
        );
      })}
      {/* Rung 9, movie grade only: the opening and the close. Both ride
          OVER the paid shots — a Story second is a paid second, so the
          chrome never appends frames. Classic films skip this entirely
          and stay pixel-identical to the shipped look. */}
      {grade === "movie" && title ? (
        <Sequence from={0} durationInFrames={Math.ceil(TITLE_SECONDS * usedFps)}>
          <TitleCard title={title} fps={usedFps} />
        </Sequence>
      ) : null}
      {grade === "movie" ? <EndFade totalFrames={totalFrames} fps={usedFps} /> : null}
      {/* Rung 11: the drone, film-level — mounted at the root so one Audio
          spans every cut, breathing in with the title and out with the
          closing fade. Under the beds, which are under the voice. */}
      {score ? (
        <Audio src={src(score.src)} volume={(f) => scoreVolumeAt(f, totalFrames, usedFps)} />
      ) : null}
      {/* The ONIQ mark rides ABOVE every shot, outside all camera transforms,
          so it is burned into every frame of the export. Subtle by design:
          the film is the product, the mark is the maker. */}
      {watermark !== false ? (
        <AbsoluteFill
          style={{
            justifyContent: "flex-end",
            alignItems: "flex-end",
            padding: 26,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontFamily:
                "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
              fontWeight: 800,
              fontSize: 30,
              letterSpacing: 7,
              color: "rgba(255,255,255,0.5)",
              textShadow: "0 1px 8px rgba(0,0,0,0.45)",
            }}
          >
            ONIQ
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
