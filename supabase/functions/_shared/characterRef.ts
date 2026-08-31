/**
 * The canonical character reference — as an IDENTITY, never as a path.
 *
 * THE DEFECT THIS CLOSES, measured 2026-08-31. Every shot drew its character
 * from text alone, so the person was invented afresh nine to seventeen times
 * per film and looked like a different person in each. The owner-asset map,
 * the casting matcher, the origin pin and the fetcher all existed and all
 * worked — and then the last hop refused: `story-still` answered 422 to any
 * request carrying a reference, because the in-house engine could not
 * condition on one. The chain was complete except at the end.
 *
 * WHY A KEY AND NOT AN IMAGE. The refusal was not arbitrary. Inline bytes
 * would have to reach the GPU worker somehow, and the media bucket's write
 * credentials live in the endpoint alone — by design, so no browser and no
 * edge function can put an object where a worker will read one. Shipping
 * bytes through the request body would have meant either handing the worker a
 * URL to fetch (a caller-influenced outbound request) or teaching the edge
 * function to write to the bucket (a credential in a second place). Both are
 * worse than the problem.
 *
 * So the reference travels as an IDENTIFIER that only the server can resolve:
 *
 *     characterRefId  ->  [server-side allowlist]  ->  story/ref/<id>.png
 *
 * The caller contributes a name from a fixed set. The server contributes the
 * prefix, the extension and the layout. The worker validates the whole key
 * against its own contract before spending a byte of GPU, and reads it with
 * its own credentials — the same download, the same size bound and the same
 * pixel-bounded decoder every other input gets.
 *
 * WHAT A CALLER CANNOT DO, and each of these is a real attack this shape
 * removes rather than merely discourages:
 *
 *   - name another user's still            the prefix is not story/still/
 *   - name any other object in the bucket  the id must be in the allowlist
 *   - traverse                             `..` never survives the allowlist
 *   - cause an outbound fetch              no URL is ever constructed
 *   - reach a host of their choosing       there is no host in this module
 *   - leak one film's reference into       the id names a PUBLISHED canonical
 *     another's                            character, which is not per-user
 *                                          data and belongs to no film
 *
 * THE ALLOWLIST IS THE AUTHORISATION. It is not a sanitiser in front of a
 * broader capability — there is no broader capability. An id that is not a
 * published canonical character resolves to nothing, and nothing is what the
 * worker is then asked for.
 */

import { ACTOR_ASSETS, referenceEligible } from "../../../src/data/storyActorAssets.ts";

/** The server-owned prefix. Mirrors contract.py REFERENCE_PREFIX exactly. */
export const REFERENCE_PREFIX = "story/ref/";

/**
 * The shape the worker's contract will accept. Kept here so this side cannot
 * build a key the other side is going to refuse — the same discipline
 * ENGINE_MAX_PROMPT_CHARS applies to the prompt ceiling, and for the same
 * reason: a bound known to only one end of a contract is a deterministic
 * failure waiting for the right input.
 */
const REF_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/**
 * Every character whose reference may be conditioned on.
 *
 * ELIGIBILITY IS PART OF THE ALLOWLIST, not a later check. A sheet frame — a
 * turnaround, a palette, a labelled panel — reproduces its own layout when
 * conditioned (measured 2026-08-21, shot 04), so conditioning on one makes the
 * shot worse in a way that looks like a model failure. Those ids never become
 * keys here; the shot draws text-only and says why, which is the honest
 * degrade.
 */
const PUBLISHABLE: ReadonlySet<string> = new Set(
  ACTOR_ASSETS.filter(referenceEligible)
    .map((a) => a.characterRefId)
    .filter((id) => REF_ID_RE.test(id)),
);

export function isPublishableCharacterRef(id: unknown): id is string {
  return typeof id === "string" && PUBLISHABLE.has(id);
}

/**
 * The bucket key for one published canonical character reference, or null.
 *
 * Null rather than a thrown error, and rather than a key built anyway: an
 * unknown id is not an emergency, it is a shot that draws without an anchor —
 * exactly what happens today for every shot. The caller records the reason.
 */
export function characterRefKey(id: unknown): string | null {
  if (!isPublishableCharacterRef(id)) return null;
  return `${REFERENCE_PREFIX}${id}.png`;
}

/**
 * How hard to hold the reference, when the caller names no number.
 *
 * MIRRORS videogen.DEFAULT_REFERENCE_STRENGTH, and the reasoning lives there:
 * at 1.0 the sampler returns the reference and the shot's own prompt is
 * wasted; near 0 the anchor is indistinguishable from no anchor. 0.5 is the
 * midpoint of the band the worker's contract admits and is deliberately
 * UNTUNED — no measurement on this hardware justifies a sharper value, and
 * inventing one would repeat the mistake the audit found.
 */
export const DEFAULT_REFERENCE_STRENGTH = 0.5;

/** The band the worker's contract admits. Both ends are refusals, not clamps. */
export const MIN_REFERENCE_STRENGTH = 0.05;
export const MAX_REFERENCE_STRENGTH = 0.95;

/**
 * WHERE THE CANONICAL FRAME COMES FROM.
 *
 * It is drawn by ONIQ's own engine and written to this exact key, by an
 * `image_generate` job whose `output_key` IS `characterRefKey(id)`. That is
 * why no upload path, no presign and no second credential appear anywhere in
 * this module: publishing a canonical character is the ordinary still stage
 * pointed at a different destination.
 *
 * Until an id has been published, `story/ref/<id>.png` is simply absent and
 * the worker's download refuses it by name. The caller treats that as
 * CAPABILITY_UNSUPPORTED — drop the reference, keep the rung — which is the
 * taxonomy referenceOutcome.ts already holds, and NOT as a verdict on the
 * shot's content.
 */
export function isCanonicalRefKey(key: unknown): key is string {
  if (typeof key !== "string" || !key.startsWith(REFERENCE_PREFIX)) return false;
  const id = key.slice(REFERENCE_PREFIX.length).replace(/\.png$/, "");
  return id !== key.slice(REFERENCE_PREFIX.length) && isPublishableCharacterRef(id);
}
