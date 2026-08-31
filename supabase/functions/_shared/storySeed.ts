/**
 * The seed a shot is drawn with — DERIVED, never rolled.
 *
 * WHY THIS EXISTS. videogen.py carried `SEED = 42` as a module constant, so
 * every sample of every shot of every film used the same seed. That was
 * harmless while a failed shot was simply a failed shot; it became a bug on
 * 2026-08-31, when the retry ceiling was raised from 3 to 10 on the owner's
 * "focus on quality". Ten attempts against a fixed seed are ten byte-identical
 * draws: the retry budget could not succeed, because nothing about the second
 * attempt differed from the first.
 *
 * The fix is not randomness. A random seed would make a bad frame
 * unreproducible, and the first thing anyone wants when a face comes out wrong
 * is to draw that exact frame again and look at it. So the seed is a pure
 * function of WHICH shot and WHICH attempt:
 *
 *     seed = H(job | scene | shot | attempt)
 *
 *   - same shot, same attempt  -> identical seed, identical frame
 *   - same shot, next attempt  -> a genuinely different draw
 *   - different shot           -> independent, so one bad seed cannot
 *                                 poison a whole film
 *
 * NO Date.now(), NO Math.random(), NO crypto.randomUUID(). Each of those
 * would reintroduce the unreproducibility this module exists to prevent, and
 * a test asserts their absence from this file.
 *
 * FNV-1a, not SHA-256, and deliberately: this is a sampler seed, not a
 * security boundary. It needs to be stable across runtimes and cheap, and it
 * must not be mistaken for a capability token — jobToken.ts is the module
 * that carries authority, and it uses HMAC precisely because it does.
 */

/** The worker's contract bound: params.seed is a uint64. */
export const MAX_SEED = 2n ** 64n - 1n;

/** 64-bit FNV-1a. Stable, dependency-free, identical in Deno and Node. */
function fnv1a64(text: string): bigint {
  const PRIME = 1099511628211n;
  const MASK = 2n ** 64n - 1n;
  let hash = 14695981039346656037n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i) & 0xff);
    hash = (hash * PRIME) & MASK;
  }
  return hash;
}

export type SeedParts = {
  /** The story job this shot belongs to. */
  jobId: string;
  /** The scene within the film. */
  sceneId: string;
  /** The shot within the scene. */
  shotId: string;
  /** 0 for the first draw, 1 for the first retry, and so on. */
  attempt: number;
  /**
   * The sub-unit within the shot, for a stage that has one. Absent for a
   * still, which is drawn once per shot; `v<version>/<index>` for a clip,
   * because a shot longer than one clip is covered by SEVERAL and they must
   * not be the same draw.
   *
   * MEASURED 2026-08-31: without this, a 9-second shot planned three clips
   * whose input_key, prompt, negative_prompt and seed were all identical —
   * only output_key differed. LTX is deterministic given a seed, so that is
   * three byte-identical clips: the shot played the same 4 seconds three
   * times, and two thirds of the GPU spend bought nothing. It also made the
   * version bump inert, though unitKey documents it as "the ONLY way to ask
   * for the same shot again".
   *
   * Absent leaves the material byte-for-byte what it was, so a still's seed
   * is unchanged by this field existing.
   */
  unit?: string;
  /**
   * Which stage is asking. A still and the clip that animates it are two
   * different draws of the same shot and must not share a seed — sampling a
   * video from the same seed as its own conditioning frame is not a
   * meaningful pairing, just an accidental one.
   */
  stage: "still" | "clip";
};

export function deriveSeed(parts: SeedParts): number {
  const attempt = Number.isInteger(parts.attempt) ? parts.attempt : 0;
  if (attempt < 0) throw new Error("attempt must not be negative");
  // "|" as the separator, and it is load-bearing rather than decorative: no
  // part may CONTAIN a pipe (ids are [A-Za-z0-9._-] via assertSafeId, the job
  // is a uuid, the stage a literal, the attempt digits, and `unit` is built
  // from a version and an index), so two different shots can never produce the
  // same material string. An empty separator would let ("ab","c") and
  // ("a","bc") collide into one seed.
  //
  // That invariant is now CHECKED rather than argued. It is the whole basis of
  // collision-freedom, it costs nothing to verify, and the alternative is a
  // silent seed collision — two shots drawing the same frame — which is
  // precisely the class of bug this module exists to prevent.
  for (const part of [parts.jobId, parts.sceneId, parts.shotId, parts.unit]) {
    if (typeof part === "string" && part.includes("|")) {
      throw new Error("seed parts may not contain the '|' separator");
    }
  }
  const material = [
    parts.stage,
    parts.jobId,
    parts.sceneId,
    parts.shotId,
    ...(parts.unit === undefined ? [] : [parts.unit]),
    String(attempt),
  ].join("|");
  // Number, not bigint, because it crosses JSON to the worker. 2^53-1 keeps
  // every value exactly representable — a seed that lost precision in transit
  // would break the reproducibility this whole module is for.
  return Number(fnv1a64(material) % BigInt(Number.MAX_SAFE_INTEGER));
}
