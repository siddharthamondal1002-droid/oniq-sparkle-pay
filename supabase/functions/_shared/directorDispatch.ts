/**
 * Director -> engines: what to ask, and of whom.
 *
 * Owner directive 2026-08-27: reuse the image engine, LTX, Piper, concat,
 * billing and storage — do not duplicate them. So this module builds
 * REQUESTS and nothing else. It opens no socket, holds no key, and knows
 * no provider; the existing clients take these descriptors and do the
 * work they already did.
 *
 * The value it adds is context: a shot on its own says "she turns toward
 * the camera", which is not enough to draw anyone. The Director resolves
 * the character bible and the world bible into every request, so shot 40
 * draws the same person as shot 1 instead of inventing a new one.
 */

import type { GraphJob } from "./directorGraph.ts";
import type { IrCharacter, IrShot, IrWorld, StoryIr } from "./storyIr.ts";

export type ImageRequest = {
  kind: "image";
  shotId: string;
  /** The full prompt: the frame, plus who and where it is. */
  prompt: string;
};

export type VideoRequest = {
  kind: "video";
  shotId: string;
  /** The still this animates — written by the image job, read by LTX. */
  inputKey: string;
  /** Motion only. Never a re-description of the frame. */
  prompt: string;
  /** Server-derived entitlement; the worker defaults to marked without it. */
  noWatermark: boolean;
};

export type AudioRequest = {
  kind: "audio";
  shotId: string;
  inputKey: string;
  narration: string;
  /** Which voice speaks — the character's own, or the narrator. */
  voiceId: string;
};

export type ConcatRequest = {
  kind: "concat";
  segmentKeys: string[];
};

export type EngineRequest = ImageRequest | VideoRequest | AudioRequest | ConcatRequest;

export const NARRATOR_VOICE = "narrator";

function characterLine(c: IrCharacter): string {
  return [c.name, c.appearance, c.clothing].filter(Boolean).join(", ");
}

function locationLine(world: IrWorld, locationId: string): string {
  const loc = world.locations.find((l) => l.id === locationId);
  return loc ? `${loc.name}: ${loc.description}` : "";
}

/**
 * The still's prompt: the frame, the people in it, and the place.
 *
 * Character descriptions come from the BIBLE, resolved by id — that is
 * what keeps a face the same face across forty shots, and it is why a
 * shot referencing an unknown character is a validation error rather
 * than a silently anonymous frame.
 */
export function imagePromptFor(ir: StoryIr, shot: IrShot): string {
  const cast = shot.characters
    .map((id) => ir.characters.find((c) => c.id === id))
    .filter((c): c is IrCharacter => Boolean(c))
    .map(characterLine);
  return [
    shot.visualDescription,
    cast.length ? `In frame: ${cast.join("; ")}.` : "",
    locationLine(ir.world, shot.locationId),
    ir.world.visualStyle,
    ir.world.timePeriod ?? "",
  ]
    .filter((part) => part && part.trim())
    .join(" ")
    .trim();
}

/**
 * The motion prompt: what MOVES, and the camera. Deliberately not the
 * frame again — the still already established that, and re-describing it
 * is how a video model ends up fighting its own input.
 */
export function motionPromptFor(shot: IrShot, repairSuffix?: string): string {
  return [shot.motionDescription, shot.cameraDescription, repairSuffix]
    .filter((part) => part && part.trim())
    .join(" ")
    .trim();
}

/** Which voice a line is spoken in: the character's own, or the narrator. */
export function voiceForShot(ir: StoryIr, shot: IrShot): string {
  if (!shot.dialogue) return NARRATOR_VOICE;
  const speaker = ir.characters.find(
    (c) => c.id === shot.dialogue!.speaker || c.name === shot.dialogue!.speaker,
  );
  return speaker?.voiceId ?? speaker?.id ?? NARRATOR_VOICE;
}

/** Narration then dialogue — the narrator sets the scene, then they speak. */
export function spokenTextFor(shot: IrShot): string {
  return [shot.narration, shot.dialogue?.line].filter(Boolean).join(" ").trim();
}

export type DispatchContext = {
  ir: StoryIr;
  /** Keys of artifacts already produced, by job id. */
  outputs: Record<string, string>;
  noWatermark: boolean;
  /** Set when this dispatch is a repair, so the prompt changes. */
  repairSuffix?: string;
};

export class DispatchBlocked extends Error {}

/**
 * Turn one ready job into one engine request.
 *
 * A job whose input is not on disk yet is BLOCKED rather than dispatched
 * with a guessed key — the graph should never have offered it, and a
 * guessed key would be a paid job producing an artifact from the wrong
 * source frame.
 */
export function requestFor(job: GraphJob, ctx: DispatchContext): EngineRequest {
  const shot = job.shotId
    ? ctx.ir.scenes.flatMap((s) => s.shots).find((s) => s.id === job.shotId)
    : undefined;

  if (job.kind === "assembly") {
    const segments = ctx.ir.scenes
      .flatMap((s) => s.shots)
      .map(
        (s) =>
          ctx.outputs[`${job.id.split(":")[0]}:${s.id}:video`] ??
          ctx.outputs[`${job.id.split(":")[0]}:${s.id}:audio`],
      )
      .filter((k): k is string => Boolean(k));
    if (segments.length < 2) {
      throw new DispatchBlocked("assembly needs at least two finished shots");
    }
    return { kind: "concat", segmentKeys: segments };
  }

  if (!shot) throw new DispatchBlocked(`job ${job.id} names no shot in the story`);

  if (job.kind === "image") {
    return { kind: "image", shotId: shot.id, prompt: imagePromptFor(ctx.ir, shot) };
  }

  const need = job.needs[0];
  const inputKey = need ? ctx.outputs[need] : undefined;
  if (!inputKey) {
    throw new DispatchBlocked(`job ${job.id} has no finished input to work from`);
  }

  if (job.kind === "video") {
    return {
      kind: "video",
      shotId: shot.id,
      inputKey,
      prompt: motionPromptFor(shot, ctx.repairSuffix),
      noWatermark: ctx.noWatermark,
    };
  }

  return {
    kind: "audio",
    shotId: shot.id,
    inputKey,
    narration: spokenTextFor(shot),
    voiceId: voiceForShot(ctx.ir, shot),
  };
}
