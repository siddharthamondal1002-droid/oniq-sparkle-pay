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
  buildMouthCues,
  cuesFromRhubarb,
  segmentsFromSpans,
  visemeAtFrame,
  type MouthCue,
  type RhubarbCue,
} from "../../../src/lib/visemes";
import { PARALLAX } from "../../../src/lib/parallaxPlanes";
import { Character } from "../rig/Character";
import { CHARACTER_RIGS } from "../rig/characterRig";

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
            {/* MUTED, unconditionally — Veo writes its own soundtrack and the
                narration below is the film's only voice. */}
            <OffthreadVideo
              muted
              src={src(shot.clip.src)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </Sequence>
          {tailSpan > 0 ? (
            <Sequence from={clipFrames}>
              <AbsoluteFill style={{ transform: `scale(${tailZoom})` }}>
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
            transform: `scale(${zoom + travel * PARALLAX.midCoverGain}) translate(${
              x * PARALLAX.midRate
            }%, ${y * PARALLAX.midRate}%)`,
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
            transform: `scale(${zoom + travel * PARALLAX.nearCoverGain}) translate(${
              x * PARALLAX.nearRate
            }%, ${y * PARALLAX.nearRate}%)`,
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
          viseme={visemeAtFrame(cues, frame)}
          heightRatio={shot.figureHeight}
        />
      ) : null}

      {/* Mounted INSIDE the shot so it starts with it. Episode 1 shipped as a
          4:47 silent slideshow with every mp3 generated and none referenced,
          and no still-frame check would have caught it. */}
      {shot.audio ? <Audio src={src(shot.audio)} /> : null}
    </AbsoluteFill>
  );
};

export const StoryFilm: React.FC<StoryFilmProps> = ({ shots, fps, watermark }) => {
  const { fps: configFps } = useVideoConfig();
  const perShot = storyFrames(shots, fps ?? configFps);

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
