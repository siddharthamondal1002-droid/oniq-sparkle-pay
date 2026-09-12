// inHouseMotion — the film pipeline's LEVEL 4 motion stage, on ONIQ's own GPU.
//
// WHAT WAS MISSING, precisely. src/lib/motionCost.ts declares six motion
// levels; 0-3 are in-house CPU and 5 is PREMIUM (Veo, direct Google). Level 4
// DIFFUSION has always been declared and NEVER executed — nothing in the story
// pipeline calls the in-house GPU, so every film's motion has been Google's.
// Its documented engine was Wan2.1-VACE, which the owner has ruled out.
//
// Meanwhile the in-house GPU path is real and finished: gpuVideoCore validates,
// builds, polls, verifies, watermarks and de-duplicates a single LTX clip on
// the A5000, and gpu_video_jobs accounts for it. It was simply never reachable
// from a film. This module is the bridge, and ONLY the bridge.
//
// THE STILL FENCE IS DERIVE-ONLY, which is stronger than the check it replaced.
// gpuVideoCore.buildWorkerPayload resolves its starting frame through
// STAGED_REFERENCES — a closed set of pre-staged images. That is right for the
// standalone clip tool, where an arbitrary bucket path from a browser would be
// an SSRF-shaped hole. A film's frames cannot be a closed enum: they are
// stills THIS PIPELINE generates, one per shot, per job.
//
// So the property is preserved by construction instead of by validation. This
// module NEVER ACCEPTS A KEY. It accepts identifiers — job, scene, shot — and
// DERIVES the key itself, from a fixed prefix and a character class that
// cannot express a traversal or a scheme. A caller holding an arbitrary bucket
// path has nowhere to put it: there is no parameter for it. Validating a
// supplied key would leave the question "did we validate it correctly?"; not
// having the parameter removes the question.
//
// NO PROVIDER FALLBACK (owner directive, 2026-08-28). A refusal here is a
// refusal. It never silently becomes a Veo call: that would spend Google's
// metered key on a request the owner routed to hardware they already pay for,
// which is exactly the provider-substitution CLAUDE.md exists to prevent.
//
// PURE. No network, no Deno APIs, no clock. Every decision is a function of its
// arguments so the whole stage is testable without a GPU — the planOrchestrator
// discipline, for the same reason: this path spends money when it is wrong.

import { VIDEO_CLOCK_SECONDS, MAX_PROMPT_CHARS } from "./gpuVideoCore.ts";
import { stillKeyFor as oniqStillKeyFor } from "./oniqImage.ts";
import { composeInHouseVideoPrompt, type MovieShot } from "./movieGrammar.ts";
import { deriveSeed } from "./storySeed.ts";
import { negativePromptFor } from "./faceQuality.ts";

/**
 * ONE STILL KEY SCHEME, IMPORTED. oniqImage already names every still the GPU
 * worker draws (`story/still/<id>.png`), and the worker has already written
 * this file there — the film's motion stage does not stage anything, it names
 * a still that exists. Restating the scheme here would be the storygen defect
 * again: two copies, one of them eventually wrong.
 */
export const STILL_PREFIX = "story/still/";

/**
 * The only characters an identifier may contribute to a key. No dot, so `..`
 * is unconstructable; no slash, so a segment cannot open a new path level; no
 * colon, so no scheme. A rejected identifier throws rather than being
 * sanitised — silently rewriting a caller's id would make two different shots
 * share one key, and sharing a key means sharing a clip.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;

export function assertSafeId(kind: string, value: string): string {
  if (!SAFE_ID.test(value)) {
    throw new Error(`inHouseMotion: unsafe ${kind} ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * The still's ID, derived from the shot it belongs to. Deterministic so the
 * motion stage can recompute it instead of being handed a path, and so a
 * redrawn shot overwrites its own still rather than orphaning one.
 */
export function stillIdFor(jobId: string, sceneId: string, shotId: string): string {
  return (
    `${assertSafeId("jobId", jobId)}-` +
    `${assertSafeId("sceneId", sceneId)}-${assertSafeId("shotId", shotId)}`
  );
}

/**
 * The still's key, DERIVED, through oniqImage's own function so the two can
 * never drift. There is deliberately no overload taking a key.
 */
export function stillKeyFor(jobId: string, sceneId: string, shotId: string): string {
  return oniqStillKeyFor(stillIdFor(jobId, sceneId, shotId));
}

/** Where a film's in-house clips live — beside the stills they animate. */
export const CLIP_PREFIX = "story/clip/";

/**
 * The in-house clip is a FIXED 97 frames at 24fps. It cannot be asked for a
 * different length — the worker contract pins it and the owner's standing
 * rule is that clip length does not move to improve economics. So a shot
 * longer than one clip is COVERED BY SEVERAL, and the last one is trimmed at
 * assembly. Rounding down instead would silently shorten the film.
 */
export const CLIP_SECONDS = VIDEO_CLOCK_SECONDS;

/** A shot no longer than this is one clip. Above it, more. */
export function clipsForShot(shotSeconds: number): number {
  if (!Number.isFinite(shotSeconds) || shotSeconds <= 0) return 0;
  return Math.ceil(shotSeconds / CLIP_SECONDS);
}

export type ClipUnit = {
  /** Deterministic logical identity — see unitKey. */
  key: string;
  sceneId: string;
  shotId: string;
  /** 0-based index of this clip WITHIN its shot. */
  index: number;
  /** The R2 key of the still this clip animates. */
  stillKey: string;
  /** Server-owned destination. Derived from key, never supplied. */
  outputKey: string;
  /** Seconds of this clip the film actually uses (the last one is short). */
  usedSeconds: number;
};

/**
 * THE LOGICAL GENERATION UNIT (§7). project + scene + shot + version + index.
 *
 * A retry must not create duplicate GPU work, so identity cannot involve a
 * timestamp, a random id, or anything else that changes between attempts.
 * Bumping `version` is the ONLY way to ask for the same shot again — which is
 * what a deliberate re-generation is, and what an accidental double-submit
 * is not.
 */
export function unitKey(
  projectId: string,
  sceneId: string,
  shotId: string,
  version: number,
  index: number,
): string {
  return `${projectId}/${sceneId}/${shotId}/v${version}/${index}`;
}

export function outputKeyFor(key: string): string {
  return `${CLIP_PREFIX}${key}/ltx-001.mp4`;
}

export type PlanRefusal =
  | "no-shots"
  | "still-not-server-owned"
  | "still-missing"
  | "shot-duration-invalid"
  | "prompt-too-long"
  | "version-invalid";

export type ShotInput = {
  sceneId: string;
  shotId: string;
  /** Seconds this shot occupies in the film — narration is the clock. */
  seconds: number;
  shot: MovieShot;
};

export type MotionPlan =
  | { ok: true; units: ClipUnit[]; gpuJobs: number; gpuSeconds: number }
  | { ok: false; refusal: PlanRefusal; detail: string };

/** Measured on the A5000, 2026-08-27: one in-house clip's billed GPU seconds. */
export const GPU_SECONDS_PER_CLIP = 38.87;

/**
 * Plan every in-house clip a film needs. Refuses rather than guessing.
 *
 * The still key check is the security boundary: only the server's own still
 * namespace is animatable, so a path that arrived from a browser — or a
 * traversal dressed as one — cannot become an input_key on the worker.
 */
export function planMotion(
  projectId: string,
  shots: readonly ShotInput[],
  version: number,
): MotionPlan {
  try {
    assertSafeId("projectId", projectId);
  } catch (err) {
    return { ok: false, refusal: "still-not-server-owned", detail: String(err) };
  }
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, refusal: "version-invalid", detail: `version ${version}` };
  }
  if (!shots.length) {
    return { ok: false, refusal: "no-shots", detail: "a film needs at least one shot" };
  }

  const units: ClipUnit[] = [];
  for (const s of shots) {
    let stillKey: string;
    try {
      stillKey = stillKeyFor(projectId, s.sceneId, s.shotId);
    } catch (err) {
      return { ok: false, refusal: "still-not-server-owned", detail: String(err) };
    }
    const count = clipsForShot(s.seconds);
    if (count < 1) {
      return {
        ok: false,
        refusal: "shot-duration-invalid",
        detail: `${s.sceneId}/${s.shotId} is ${s.seconds}s`,
      };
    }
    if (composeInHouseVideoPrompt(s.shot).length > MAX_PROMPT_CHARS) {
      return {
        ok: false,
        refusal: "prompt-too-long",
        detail: `${s.sceneId}/${s.shotId}`,
      };
    }
    let remaining = s.seconds;
    for (let i = 0; i < count; i++) {
      const key = unitKey(projectId, s.sceneId, s.shotId, version, i);
      units.push({
        key,
        sceneId: s.sceneId,
        shotId: s.shotId,
        index: i,
        stillKey,
        outputKey: outputKeyFor(key),
        usedSeconds: Math.min(CLIP_SECONDS, remaining),
      });
      remaining -= CLIP_SECONDS;
    }
  }

  return {
    ok: true,
    units,
    gpuJobs: units.length,
    gpuSeconds: units.length * GPU_SECONDS_PER_CLIP,
  };
}

/**
 * The worker payload for one unit. Mirrors gpuVideoCore.buildWorkerPayload's
 * shape exactly — same op, same param names — so the worker contract has one
 * meaning, not two. The only difference is where the starting frame comes
 * from, which is the whole reason this module exists.
 *
 * THE ATTEMPT NUMBER IS PART OF THE PAYLOAD, AND THE KEY IS NOT.
 *
 * Those two sentences are the whole of §10 and they pull in opposite
 * directions, so both are stated. `unitKey` above must stay identical across
 * attempts — it is the unit's IDENTITY, and an identity that moved would turn
 * a retry into duplicate paid GPU work. The SEED must move, because a retry
 * that samples the same point returns the same clip: with videogen.py's
 * `SEED = 42` and this function returning a byte-identical payload, the two
 * attempts below were one clip generated twice, and the attempt ceiling the
 * owner raised from 3 to 10 on 2026-08-31 bought exactly nothing.
 *
 * Derived, never rolled. Attempt 2 of a shot is a different draw from attempt
 * 1, and drawing attempt 2 again tomorrow gives the same frames back — which
 * is what anybody wants the moment a clip comes out wrong.
 */
export function buildClipPayload(
  unit: ClipUnit,
  shot: MovieShot,
  noWatermark: boolean,
  attempt = 1,
) {
  return {
    input: {
      op: "video_generate",
      input_key: unit.stillKey,
      output_key: unit.outputKey,
      // THE IN-HOUSE COMPOSER, not the Veo one. Everything downstream of this
      // payload runs on ONIQ's own LTX; the four-part prompt is what that
      // engine's guidance asks for, and the Veo composer's twelve-word
      // motion-only output is what the audit found underneath the soft faces.
      params: {
        prompt: composeInHouseVideoPrompt(shot),
        watermark: !noWatermark,
        seed: clipSeed(unit.key, attempt),
        negative_prompt: negativePromptFor([shot.still, shot.narration, shot.motion]),
      },
    },
  };
}

/**
 * The sampler seed for one attempt at one unit. A pure function of the unit's
 * own identity plus the attempt number — the same derivation storySeed.ts
 * makes for a still, over the key this module already computes.
 */
export function clipSeed(key: string, attempt: number): number {
  const [projectId, sceneId, shotId, version, index] = key.split("/");
  return deriveSeed({
    stage: "clip",
    jobId: projectId ?? key,
    sceneId: sceneId ?? "s",
    shotId: shotId ?? "shot",
    // The unit key's LAST TWO segments, which the shot's identity does not
    // carry. Dropping them (as this did until 2026-08-31) made every clip of
    // a multi-clip shot the same draw, and made a version bump inert.
    unit: `${version ?? "v1"}/${index ?? "0"}`,
    attempt: Number.isInteger(attempt) && attempt > 0 ? attempt - 1 : 0,
  });
}

/**
 * Which units still need GPU work (§7: never blindly regenerate the film).
 *
 * `done` is the set of unit keys whose output is present AND verified. A unit
 * already done is skipped; everything else is retried. Note what this does NOT
 * do: it never widens to "the shot failed so redo the scene".
 */
export function pendingUnits(units: readonly ClipUnit[], done: ReadonlySet<string>): ClipUnit[] {
  return units.filter((u) => !done.has(u.key));
}

/**
 * Progress from COMPLETED LOGICAL WORK, never a timer (§12).
 * Returns 0..1 over the motion stage.
 */
export function motionProgress(units: readonly ClipUnit[], done: ReadonlySet<string>): number {
  if (!units.length) return 0;
  let n = 0;
  for (const u of units) if (done.has(u.key)) n++;
  return n / units.length;
}

/**
 * GPU work vs CPU work (§8). Only the clip generation occupies the single GPU
 * slot; assembly is CPU and must not be counted against GPU capacity, or a
 * long film's concat tree eats the daily cap it never used.
 */
export function gpuJobCount(plan: MotionPlan): number {
  return plan.ok ? plan.gpuJobs : 0;
}

// ---------------------------------------------------------------- routing
/**
 * WHICH ENGINE ANIMATES A FILM, and what happens when it cannot.
 *
 * Owner directive 2026-08-28: the user-facing generator is to run on ONIQ's
 * own LTX/A5000 hardware, with NO cloud fallback. That is a provider-and-
 * payment decision (CLAUDE.md), so it is recorded here next to the code that
 * enforces it rather than left implicit in a call site.
 *
 * DEFAULT OFF. `IN_HOUSE_MOTION=on` in the edge environment is what turns the
 * in-house stage on. Until it is set, films route exactly as they do today
 * and nothing about production changes — the switch exists so the rollout is
 * a deliberate act with a deploy behind it, not a side effect of this merge.
 * §15's rule, applied to the engine instead of the price list.
 *
 * THE REFUSAL IS THE POINT. When in-house is selected and the GPU is not
 * usable, the answer is `blocked`, never `premium`. Falling back would spend
 * the metered Google key on work the owner routed to hardware they already
 * pay for — silently, and at a different price per second. A film that cannot
 * be made in-house today is a film that waits.
 */
export type MotionRoute =
  | { engine: "in-house"; level: 4 }
  | { engine: "premium"; level: 5 }
  | { engine: "blocked"; reason: "gpu-unavailable" | "worker-image-missing" };

export type MotionConditions = {
  /** IN_HOUSE_MOTION === "on". */
  inHouseEnabled: boolean;
  /** The endpoint is reachable, A5000-only, min 0 / max 1. */
  gpuHealthy: boolean;
  /**
   * The RunPod template actually carries a model-bearing image. Measured, never
   * assumed: an endpoint version is not image identity, and an empty template
   * accepts jobs it can never run — which is how one LTX request sat until the
   * 1800s watchdog killed it (job eb1b3f45, 2026-08-28).
   */
  workerImagePresent: boolean;
};

/**
 * OWNER DIRECTIVE, 2026-08-31: "enable video and use in-house motion first."
 *
 * WHAT WAS ACTUALLY WRONG. Motion had never run in production — not once. The
 * ladder was escalating correctly and this router was answering `in-house`
 * correctly; the refusal came from further down, at the spend guard:
 * `provider_budget_config.VIDEO.enabled` was FALSE, so every clip request came
 * back 402 `no-budget-configured` and each shot silently carried as a still.
 * Measured on job 87c2b756 (2026-08-31), a 60s nine-shot film:
 *
 *   MOTION_VALIDATE FAIL: 0/9 shots have a character-motion source,
 *                         9 still-only, 7 FAIL
 *   MOTION_CONTRACT: 8x story-motion: 402 no-budget-configured
 *
 * The film rendered, graded, uploaded and delivered — and was a slideshow. A
 * green pipeline is not a correct artifact, which is the whole reason
 * MOTION_VALIDATE prints that line rather than letting the run pass quietly.
 *
 * VIDEO is now enabled: $50/day, $5/job, $1/request, and attempts per shot
 * raised 3 -> 10 (the CHECK ceiling) on the owner's "focus on quality".
 *
 * ONLY THE ATTEMPT COUNT WAS RAISED, and the arithmetic is why. At the
 * measured in-house rate below, $1/request is 344 clips, $5/job is 1,724, and
 * $50/day is 17,241 — against films of nine to seventeen shots. None of the
 * dollar ceilings can reach an in-house film to truncate it; what they
 * actually bound is the PREMIUM route, where $5 is six to twelve clips.
 * Raising them would have bought no quality and widened the Veo blast radius
 * if the route ever resolves premium, so they stand. The attempt count was
 * the one cap a shot could really hit: a clip that fails the aliveness gate
 * gives up and carries as a still, and three tries was the ceiling on how
 * hard a doubtful shot is allowed to try.
 *
 * "IN-HOUSE FIRST" NEEDED NO CODE CHANGE — it is what the branches below
 * already do, and more strictly than "first" implies: when in-house is
 * selected, a failure is `blocked`, never `premium`. The directive is recorded
 * here so that reading this router tells you the routing IS the owner's
 * decision, not an implementation detail free to be relaxed later.
 *
 * WHY THE ORDER IS WORTH DEFENDING, measured rather than argued:
 *   in-house  $0.0029 per clip   (IN_HOUSE_CLIP_COST, A5000, 2026-08-27)
 *   Veo Fast  $0.40–$0.80 per clip ($0.10/s × 4–8s, videoRouting.ts)
 * That is roughly 140–275x. A silent premium fallback would not be a
 * degradation of quality, it would be a two-order-of-magnitude change in what
 * a film costs to make — which is exactly the class of decision the
 * 2026-08-14 directive says an agent may not take on its own.
 */
export function routeMotion(c: MotionConditions): MotionRoute {
  if (!c.inHouseEnabled) return { engine: "premium", level: 5 };
  if (!c.workerImagePresent) return { engine: "blocked", reason: "worker-image-missing" };
  if (!c.gpuHealthy) return { engine: "blocked", reason: "gpu-unavailable" };
  return { engine: "in-house", level: 4 };
}

// ------------------------------------------------------- measured economics
/**
 * THE IN-HOUSE RATE, MEASURED — not a price list.
 *
 * Job e010372d (2026-08-27) billed 38.87 GPU-seconds at the A5000's live
 * $0.27/hr and recorded actual_cost_usd 0.0029 for one clip. That clip is
 * 97 frames at 24fps, so the per-video-second figure is derived from those
 * two measurements rather than quoted.
 *
 * It is deliberately NOT called a price. It is what one clip cost on one
 * measured day; the live rate is re-quoted before every job by the existing
 * admission path, and this constant exists to ESTIMATE a reservation before
 * any of that runs. `measuredOn` is part of the value so a stale figure is
 * visible rather than authoritative — the same discipline videoRouting.ts
 * applies to Veo's published table.
 */
export const IN_HOUSE_CLIP_COST = {
  usdPerClip: 0.0029,
  gpuSecondsPerClip: GPU_SECONDS_PER_CLIP,
  clipSeconds: CLIP_SECONDS,
  measuredOn: "2026-08-27",
  source: "gpu_video_jobs e010372d, 38.87s billed at $0.27/hr on the A5000",
} as const;

export function estimateMotionUsd(units: number): number {
  return Math.round(units * IN_HOUSE_CLIP_COST.usdPerClip * 1e6) / 1e6;
}

// --------------------------------------------------------- the submit path
/**
 * One logical motion unit's trip through the GPU, with every side effect
 * INJECTED so the whole path is testable without a worker (the
 * planOrchestrator discipline — this path spends money when it is wrong).
 *
 * The invariants it exists to hold:
 *   - a unit already done is SKIPPED, so a retry re-spends nothing (§7);
 *   - attempts are BOUNDED, so a failing unit cannot bill forever (§18);
 *   - a failure is a failure — there is no branch that reaches another
 *     provider from here (§18, and no import that could);
 *   - a unit never ends `running`: every exit writes a terminal state (§3).
 */
export type UnitOutcome =
  | { state: "reused"; outputKey: string }
  | { state: "completed"; outputKey: string; gpuJobId: string; attempts: number }
  | { state: "failed"; reason: string; attempts: number };

export type SubmitDeps = {
  /** A previously completed unit's output, by logical key. */
  findCompleted(key: string): Promise<string | null>;
  /** Create the gpu_video_jobs row and submit. Returns the provider job id. */
  submit(unit: ClipUnit, payload: ReturnType<typeof buildClipPayload>): Promise<string>;
  /** Terminal poll: resolve once the provider job stops moving. */
  awaitTerminal(gpuJobId: string): Promise<{ ok: boolean; reason?: string }>;
  /** Record the unit's terminal state against the film. */
  record(row: {
    key: string;
    sceneId: string;
    shotId: string;
    index: number;
    gpuJobId: string | null;
    status: "completed" | "failed";
    reason: string | null;
  }): Promise<void>;
};

/** Bounded (§18). Two attempts: one blip forgiven, then the truth. */
export const MAX_UNIT_ATTEMPTS = 2;

export async function runUnit(
  unit: ClipUnit,
  shot: MovieShot,
  noWatermark: boolean,
  deps: SubmitDeps,
): Promise<UnitOutcome> {
  const already = await deps.findCompleted(unit.key);
  if (already) return { state: "reused", outputKey: already };

  let lastReason = "unknown";
  for (let attempt = 1; attempt <= MAX_UNIT_ATTEMPTS; attempt++) {
    // The attempt number travels INTO the payload, so attempt 2 is a
    // genuinely different draw rather than a second copy of attempt 1.
    const payload = buildClipPayload(unit, shot, noWatermark, attempt);
    let gpuJobId: string | null = null;
    try {
      gpuJobId = await deps.submit(unit, payload);
      const terminal = await deps.awaitTerminal(gpuJobId);
      if (terminal.ok) {
        await deps.record({
          key: unit.key,
          sceneId: unit.sceneId,
          shotId: unit.shotId,
          index: unit.index,
          gpuJobId,
          status: "completed",
          reason: null,
        });
        return { state: "completed", outputKey: unit.outputKey, gpuJobId, attempts: attempt };
      }
      lastReason = terminal.reason ?? "gpu-job-failed";
    } catch (err) {
      lastReason = String((err as Error)?.message ?? err);
    }
    if (attempt === MAX_UNIT_ATTEMPTS) {
      // Terminal, and WRITTEN. A unit that stops here must not be left
      // `running` for a reconciler to find hours later.
      await deps.record({
        key: unit.key,
        sceneId: unit.sceneId,
        shotId: unit.shotId,
        index: unit.index,
        gpuJobId,
        status: "failed",
        reason: lastReason,
      });
    }
  }
  return { state: "failed", reason: lastReason, attempts: MAX_UNIT_ATTEMPTS };
}

/**
 * Every unit of a film, in order. Serialized because workersMax = 1: firing
 * them together would queue behind one another anyway and make the failure
 * accounting harder to read.
 *
 * It does NOT stop the film on the first failure — the caller decides whether
 * a missing clip is fatal or steps down to the still — but it does return
 * exactly which units failed, so nothing has to be re-derived by guesswork.
 */
export async function runUnits(
  units: readonly ClipUnit[],
  shotFor: (unit: ClipUnit) => MovieShot,
  noWatermark: boolean,
  deps: SubmitDeps,
): Promise<{ outcomes: Map<string, UnitOutcome>; failed: string[]; submitted: number }> {
  const outcomes = new Map<string, UnitOutcome>();
  const failed: string[] = [];
  let submitted = 0;
  for (const unit of units) {
    const outcome = await runUnit(unit, shotFor(unit), noWatermark, deps);
    outcomes.set(unit.key, outcome);
    if (outcome.state === "completed") submitted++;
    if (outcome.state === "failed") failed.push(unit.key);
  }
  return { outcomes, failed, submitted };
}

/**
 * The bridge to motionCost.selectMotionLevel: a route becomes a policy.
 *
 * L4 is allowed only when the route actually resolved in-house, and premium is
 * withdrawn at the same moment — otherwise the level ladder would quietly
 * escalate an in-house film to Veo on a QC miss, which is the fallback this
 * whole loop exists to prevent, arriving through the back door.
 */
export function policyFromRoute(route: MotionRoute): {
  allowDiffusion: boolean;
  allowPremium: boolean;
} {
  if (route.engine === "in-house") return { allowDiffusion: true, allowPremium: false };
  if (route.engine === "premium") return { allowDiffusion: false, allowPremium: true };
  return { allowDiffusion: false, allowPremium: false };
}

// --------------------------------------------------------------- the ledger
/**
 * THE IN-HOUSE MOTION SPEND, in the ledger ONIQ already keeps.
 *
 * There is no second billing system here and no new user price. What the USER
 * pays for a film is film SECONDS, reserved against video_time_reservations
 * when the job is priced — that is untouched, and moving a film's motion
 * in-house must not change it. What changes is ONIQ'S OWN COST, which
 * financialLedger records per provider call: story-clip admits and settles
 * every Veo clip through it, and an in-house clip is the same kind of event
 * with a different provider and a much smaller number.
 *
 * GPU is its own capability on purpose — it is time-billed from boot to
 * termination whether it computes or wedges, so its ceiling moves
 * independently of the metered APIs'.
 *
 * IDEMPOTENCE COMES FROM THE KEY, NOT A FLAG. The requestId IS the logical
 * unit key, so a retried unit re-admits the SAME reservation row rather than
 * opening a second one. Nothing in this module remembers anything between
 * calls; the persistence is the ledger's.
 */
export const IN_HOUSE_PROVIDER = "oniq-gpu";
export const IN_HOUSE_MODEL = "LTX_VIDEO_2B";

export function spendRequestFor(
  ref: { key: string; sceneId: string; shotId: string; index: number },
  jobId: string,
  detail: Record<string, unknown> = {},
) {
  return {
    requestId: ref.key,
    capability: "GPU" as const,
    provider: IN_HOUSE_PROVIDER,
    model: IN_HOUSE_MODEL,
    unit: "video_seconds" as const,
    units: CLIP_SECONDS,
    estimatedUsd: IN_HOUSE_CLIP_COST.usdPerClip,
    jobId,
    detail: { sceneId: ref.sceneId, shotId: ref.shotId, index: ref.index, ...detail },
  };
}

/**
 * What the clip actually cost, from the GPU time the worker reported.
 *
 * The basis is the measured pair in IN_HOUSE_CLIP_COST — $/clip over
 * GPU-seconds/clip — applied to THIS job's seconds. It is an application of a
 * measurement, not a quote, which is why the constant carries its date: a run
 * on a different card or a re-priced endpoint makes this figure stale, and a
 * stale figure should be visible rather than authoritative.
 *
 * Undefined when the worker reported no usable time. The ledger treats that
 * as "the provider did not report a cost" and the ESTIMATE stands, which
 * over-counts rather than under-counts — the safe direction.
 */
export function actualUsdFor(gpuSeconds: number | null | undefined): number | undefined {
  if (typeof gpuSeconds !== "number" || !Number.isFinite(gpuSeconds) || gpuSeconds <= 0) {
    return undefined;
  }
  const usdPerGpuSecond = IN_HOUSE_CLIP_COST.usdPerClip / IN_HOUSE_CLIP_COST.gpuSecondsPerClip;
  return Math.round(gpuSeconds * usdPerGpuSecond * 1e6) / 1e6;
}

/** The worker's reported wall time for one clip, in seconds, or null. */
export function gpuSecondsFrom(output: unknown): number | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  const load = typeof o.model_load_ms === "number" ? o.model_load_ms : 0;
  const infer = typeof o.inference_ms === "number" ? o.inference_ms : 0;
  const total = load + infer;
  return total > 0 ? total / 1000 : null;
}

/**
 * RESERVE → GENERATE → SETTLE, as one testable sequence.
 *
 * story-motion is the transport; this is the order of operations, and the
 * order is the part that matters financially:
 *
 *   - a refused admission returns BEFORE `generate` is ever called, so a
 *     film that cannot be paid for never touches the GPU;
 *   - once generate HAS been called the exit always SETTLES, never releases —
 *     the card may have been held before the failure, and pretending it was
 *     not under-counts spend;
 *   - the requestId is the logical unit key, so a retry re-admits the same
 *     reservation instead of opening a second one.
 *
 * Keeping it here rather than inline in the edge function means those three
 * can be proved against fakes instead of asserted about source text.
 */
export type BilledDeps<T> = {
  admit(request: ReturnType<typeof spendRequestFor>): Promise<{ ok: boolean; reason?: string }>;
  generate(): Promise<T>;
  settle(
    requestId: string,
    settlement: {
      outcome: "ACCEPTED" | "FAILED";
      actualUsd?: number;
      unitsActual?: number;
      detail?: Record<string, unknown>;
    },
  ): Promise<void>;
};

export type BilledOutcome<T> =
  | { ok: true; result: T }
  | { ok: false; stage: "admission" | "generation"; reason: string };

export async function runBilledUnit<T extends { gpuJobId: string; key: string; output: unknown }>(
  ref: { key: string; sceneId: string; shotId: string; index: number },
  jobId: string,
  deps: BilledDeps<T>,
  detail: Record<string, unknown> = {},
): Promise<BilledOutcome<T>> {
  const admission = await deps.admit(spendRequestFor(ref, jobId, detail));
  if (!admission.ok) {
    // NOT CALLED. No settle, because nothing was spent — the ledger's own
    // release path owns an unused reservation, not this function.
    return { ok: false, stage: "admission", reason: admission.reason ?? "unknown" };
  }

  try {
    const result = await deps.generate();
    await deps.settle(ref.key, {
      outcome: "ACCEPTED",
      actualUsd: actualUsdFor(gpuSecondsFrom(result.output)),
      unitsActual: CLIP_SECONDS,
      detail: { gpuJobId: result.gpuJobId, outputKey: result.key },
    });
    return { ok: true, result };
  } catch (err) {
    const reason = String((err as Error)?.message ?? err);
    await deps.settle(ref.key, {
      outcome: "FAILED",
      unitsActual: 0,
      detail: { reason: reason.slice(0, 300) },
    });
    return { ok: false, stage: "generation", reason };
  }
}

// ------------------------------------------------- the still, in the ledger
/**
 * THE IN-HOUSE STILL'S GPU SPEND, in the same ledger, with the same shape.
 *
 * THE GAP THIS CLOSES, measured rather than reasoned. Every in-house MOTION
 * clip passes through runBilledUnit above, so it reserves before dispatch and
 * settles after. The in-house STILL did not: story-still called submitStill
 * directly, and a frame that woke a cold A5000 for minutes left no row
 * anywhere. Film a7b9c3b9 is the proof — nine shots, three GPU submissions on
 * frame 1 alone, and zero rows in provider_spend_ledger. An absent row is not
 * a zero charge; RunPod bills the card whether or not this project wrote
 * anything down, so the ledger was simply blind to the still stage.
 *
 * WHY NOT runBilledUnit. That function is reserve → generate → settle inside
 * ONE call, which the still path deliberately is not: submit and poll are
 * separate edge invocations because a cold worker outlasts any wall clock an
 * edge function has. So the ORDER is the same and the transport is not, and
 * these two pure halves are what story-still composes:
 *
 *     start  admit(stillSpendRequestFor(...))   refused ⇒ nothing is submitted
 *            submitStill(...)                   threw   ⇒ RELEASE, nothing ran
 *     poll   done                               ⇒ settle ACCEPTED, measured
 *            terminal failure                   ⇒ settle FAILED, estimate stands
 *            not done                           ⇒ nothing; the row stays open
 *
 * RELEASE IS FOR EXACTLY ONE CASE and it is narrow on purpose: the submit
 * itself threw, so no engine job exists and no card was ever held. Once a job
 * id has come back, every exit SETTLES — including the failure that costs the
 * most, a worker that loads 40 GiB of image and then refuses. Treating that as
 * a release would report the expensive failures as free.
 *
 * IDEMPOTENCE COMES FROM THE KEY. The requestId is derived from the still's
 * own id, so a re-submitted shot re-admits the SAME reservation row instead of
 * opening a second one — the property that makes the attempt ladder bounded
 * rather than merely counted.
 */
export const IN_HOUSE_STILL_MODEL = "LTX_VIDEO_2B_STILL";

/**
 * What one still RESERVES, in GPU-seconds.
 *
 * A reservation is a worst case, not a price. The measured warm draw in
 * oniqImage's own contract is ~13 s of model load plus ~2.5 s of inference;
 * a COLD worker pulls the image and the text encoder first and is billed for
 * all of it, which is minutes. 120 s is chosen to cover a cold draw and still
 * sit an order of magnitude under the $0.10 per-request cap, so a legitimate
 * cold start is admitted and a runaway is not. Settlement replaces it with the
 * worker's own reported time whenever the worker reports one.
 */
export const IN_HOUSE_STILL_RESERVE_GPU_SECONDS = 120;

/** The reservation estimate, from the same measured $/GPU-second basis. */
export function estimateStillUsd(gpuSeconds: number = IN_HOUSE_STILL_RESERVE_GPU_SECONDS): number {
  const usdPerGpuSecond = IN_HOUSE_CLIP_COST.usdPerClip / IN_HOUSE_CLIP_COST.gpuSecondsPerClip;
  return Math.round(gpuSeconds * usdPerGpuSecond * 1e6) / 1e6;
}

/** The ledger request for one still. The still's id IS the idempotence key. */
export function stillSpendRequestFor(
  stillId: string,
  jobId: string,
  detail: Record<string, unknown> = {},
) {
  return {
    requestId: `still:${stillId}`,
    capability: "GPU" as const,
    provider: IN_HOUSE_PROVIDER,
    model: IN_HOUSE_STILL_MODEL,
    unit: "images" as const,
    units: 1,
    estimatedUsd: estimateStillUsd(),
    jobId,
    detail: { stillId, stage: "still", ...detail },
  };
}

/**
 * How a still's reservation is closed.
 *
 * `actualUsd` is present ONLY when the worker reported usable time. Absent, it
 * is left absent — the ledger then keeps the estimate standing, which
 * over-counts. Writing 0 there would be a fabricated settlement: it would say
 * the GPU ran for free, and nothing measured says that.
 */
export function stillSettlementFor(
  outcome: "ACCEPTED" | "FAILED",
  gpuSeconds: number | null | undefined,
  detail: Record<string, unknown> = {},
) {
  const actualUsd = actualUsdFor(gpuSeconds);
  return {
    outcome,
    ...(actualUsd === undefined ? {} : { actualUsd }),
    unitsActual: outcome === "ACCEPTED" ? 1 : 0,
    detail,
  };
}
