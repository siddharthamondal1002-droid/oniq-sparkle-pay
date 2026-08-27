/**
 * Actor build — the pure contract behind "draw this character".
 *
 * Mega loop, 2026-08-27. A character asset is a visual reference for a
 * description the USER wrote — never an identity template this module gets
 * to embellish. The prompt builder below therefore performs NO invention:
 * the character content of the prompt is the user's lock text verbatim,
 * plus their optional style note verbatim, wrapped in fixed, identity-free
 * framing (that it is one character, full body, neutral ground). It adds no
 * ethnicity, gender, age, occupation, region, or any other attribute the
 * user did not type — the tests pin exactly this.
 *
 * The module is PURE: no network, no supabase, no storage. Generation goes
 * through the existing story-still function (owner-directed engine), bytes
 * go to the story-actors bucket, and the row goes through save_story_actor —
 * all owned by the component layer, all explicitly user-initiated, none of
 * it reachable from story generation. Nothing here can start a film, a
 * voice, or a GPU job.
 */

/** Mirrors castLibrary bounds — a lock longer than a film accepts is no asset. */
export const ACTOR_NAME_MAX = 60;
export const ACTOR_LOCK_MAX = 400;
export const ACTOR_STYLE_MAX = 120;

/** What the user asked to build. Only these fields exist — by design. */
export type ActorBuildInput = {
  name: string;
  /** The canonical visual description, the user's words. */
  lock: string;
  /** Optional visual-style note ("storybook watercolour", "ink and wash"…). */
  style?: string;
};

export type ActorBuildRefusal =
  | { ok: false; reason: "name-missing" }
  | { ok: false; reason: "lock-missing" }
  | { ok: false; reason: "name-too-long" }
  | { ok: false; reason: "lock-too-long" }
  | { ok: false; reason: "style-too-long" };

export type ActorBuildValidated = {
  ok: true;
  input: Required<Omit<ActorBuildInput, "style">> & { style: string | null };
};

/**
 * Bounds only. There is deliberately no content normalisation here beyond
 * trim — "normalise" must never mean "reinterpret the character".
 */
export function validateActorBuild(raw: ActorBuildInput): ActorBuildValidated | ActorBuildRefusal {
  const name = (raw.name ?? "").trim();
  const lock = (raw.lock ?? "").trim();
  const style = (raw.style ?? "").trim();
  if (!name) return { ok: false, reason: "name-missing" };
  if (!lock) return { ok: false, reason: "lock-missing" };
  if (name.length > ACTOR_NAME_MAX) return { ok: false, reason: "name-too-long" };
  if (lock.length > ACTOR_LOCK_MAX) return { ok: false, reason: "lock-too-long" };
  if (style.length > ACTOR_STYLE_MAX) return { ok: false, reason: "style-too-long" };
  return { ok: true, input: { name, lock, style: style || null } };
}

/**
 * The story-still prompt for a character reference frame.
 *
 * Fixed framing + the user's words, nothing else. The framing lines are
 * about PHOTOGRAPHY, not identity: one character, full body, neutral
 * backdrop, even light — the properties that make a frame reusable as a
 * reference. The aspect suffix is story-still's own to add.
 */
export function actorReferencePrompt(input: { lock: string; style: string | null }): string {
  const parts = [
    "Character reference frame: one single character, full body, standing,",
    "facing the viewer, on a plain neutral backdrop with soft even light.",
    "No text, no logos, no other people.",
    "",
    `The character, exactly as described: ${input.lock}`,
  ];
  if (input.style) parts.push("", `Visual style: ${input.style}`);
  return parts.join("\n");
}

/**
 * Object name for the bytes: `<uid>/<assetId>.<ext>`. The uid prefix is the
 * bucket's access control (RLS reads the first segment as the owner) — same
 * layout as story plates.
 */
export function actorAssetPath(userId: string, assetId: string, mime: string): string {
  return `${userId}/${assetId}.${actorExtension(mime)}`;
}

export function actorExtension(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/** The mimes the bucket, the RPC and the browser all agree on. */
export const ACTOR_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;

// --- associations ------------------------------------------------------------

/** The slice of a story job this module needs to see. */
export type CastCarryingJob = {
  id: string;
  cast_json?: unknown;
};

/**
 * The films an asset's character rode into, resolved from the existing
 * association channel: `set_story_cast` writes {name, lock} onto the job,
 * and an asset carrying the same name and lock IS that character. No new
 * linkage table — the job rows are the record.
 */
export function jobsFeaturingActor(
  asset: { name: string; lock: string },
  jobs: CastCarryingJob[],
): string[] {
  const name = asset.name.trim().toLowerCase();
  const lock = asset.lock.trim().toLowerCase();
  const out: string[] = [];
  for (const job of jobs) {
    if (!Array.isArray(job.cast_json)) continue;
    const hit = job.cast_json.some((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return (
        typeof o.name === "string" &&
        typeof o.lock === "string" &&
        o.name.trim().toLowerCase() === name &&
        o.lock.trim().toLowerCase() === lock
      );
    });
    if (hit) out.push(job.id);
  }
  return out;
}
