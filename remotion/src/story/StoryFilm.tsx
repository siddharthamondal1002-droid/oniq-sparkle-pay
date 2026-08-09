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
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { KEN_BURNS_SCALE } from "../../../src/lib/episodeTimeline";

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
};

export type StoryFilmProps = {
  title: string;
  shots: StoryShotInput[];
  fps?: number;
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
  const frame = useCurrentFrame();
  const travel = shot.travel ?? 0;

  // Eased to identity at the END of the shot. The cut then lands on a frame
  // where the camera is at rest, which is what stops a hard cut reading as a
  // jolt — the ep3 lesson about easing to identity at a seam.
  const t = durationInFrames > 1 ? frame / (durationInFrames - 1) : 1;
  const eased = interpolate(t, [0, 1], [1, 0], { extrapolateRight: "clamp" });
  const amount = travel * eased;

  const zoom = shot.pan === "in" ? 1 + KEN_BURNS_SCALE * eased : 1 + travel * 0.15;
  const x = shot.pan === "left" ? -amount * 100 : shot.pan === "right" ? amount * 100 : 0;
  const y = shot.pan === "up" ? -amount * 100 : shot.pan === "down" ? amount * 100 : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#05040a", overflow: "hidden" }}>
      <Img
        src={src(shot.still)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${zoom}) translate(${x}%, ${y}%)`,
        }}
      />
      {/* Mounted INSIDE the shot so it starts with it. Episode 1 shipped as a
          4:47 silent slideshow with every mp3 generated and none referenced,
          and no still-frame check would have caught it. */}
      {shot.audio ? <Audio src={src(shot.audio)} /> : null}
    </AbsoluteFill>
  );
};

export const StoryFilm: React.FC<StoryFilmProps> = ({ shots, fps }) => {
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
    </AbsoluteFill>
  );
};
