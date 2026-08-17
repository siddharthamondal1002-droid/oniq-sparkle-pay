/**
 * GROUP CALLS ARE FREE, WITH NO PARTICIPANT CAP — owner directive, 2026-08-16.
 *
 * This REPLACES the earlier 2026-08-16 "free 4, Plus 8" directive (491f521c),
 * which had itself trimmed a "group calls stay free for everyone" directive
 * from the same day. The owner's decision, latest and in force: group calling
 * is free for every account, and the size of the room is not a plan feature,
 * not an upsell, and not gated on anything. Nobody is refused a seat.
 *
 * So there is no cap here to read, no `my_call_cap` to ask, and no "this call
 * is full" anywhere in the app. Whether calls cost money and who may use them
 * is the owner's call and it has been made.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT DOES NOT GO AWAY, BECAUSE IT IS PHYSICS RATHER THAN POLICY
 *
 * The call path is a MESH. Every participant opens a peer connection to every
 * other participant and uploads a SEPARATE copy of its own camera down each
 * one. Removing a policy cap does not change that; it just means the mesh is
 * now allowed to reach sizes where it is the binding constraint.
 *
 * At a fixed 400 kbps per stream — what the app sent when the cap existed —
 * every phone's upload grows linearly with the room:
 *
 *     4 people  ->  3 streams  ->  ~1.4 Mbps up
 *     8 people  ->  7 streams  ->  ~3.3 Mbps up
 *    12 people  -> 11 streams  ->  ~5.1 Mbps up
 *    20 people  -> 19 streams  ->  ~8.8 Mbps up      (most phones fail here)
 *
 * A cap was one answer to that. It is not the only one, and it is no longer
 * the one in force — so instead of REFUSING the eleventh person, the app now
 * SPENDS LESS ON EACH of them. `videoBitrateFor` below holds total video
 * upload inside a budget by shrinking the per-stream rate as the room grows,
 * which turns "the call collapses at twelve" into "the call gets softer as it
 * gets bigger". That is engineering inside the owner's decision, not a cap
 * wearing a different hat: nobody is ever turned away, and no number in this
 * file can stop a call from starting.
 *
 * AUDIO IS NEVER SCALED DOWN. Voice is the thing a call is for, and 64 kbps
 * of Opus is cheap next to any video stream. A twenty-person room spends
 * ~1.2 Mbps on audio and that is the correct place for the money to go.
 *
 * HONEST LIMIT, STATED PLAINLY: a mesh has a ceiling that no bitrate maths
 * removes, because the CPU cost of encoding N separate streams and decoding N
 * more is not something a phone can be talked out of. Somewhere past a dozen
 * or so this stops being pleasant however few bits each stream carries.
 * Genuinely unbounded rooms need an SFU — one upload per phone, the server
 * fans it out — which means a paid media service and therefore an owner
 * decision about whose money it spends. It is written up in the migration
 * alongside this, and is deliberately NOT assumed here.
 */

/**
 * Total video upload one phone should aim to stay inside, in bits per second.
 *
 * Chosen as roughly what the 8-person room cost under the old fixed rate
 * (7 x 400 kbps = 2.8 Mbps), rounded down. Past that size the room keeps
 * growing and the per-stream share keeps shrinking instead of the call
 * breaking.
 */
export const VIDEO_UPLOAD_BUDGET_BPS = 2_400_000;

/** Never send worse than this — below it video is not worth the battery. */
export const MIN_VIDEO_BPS = 120_000;

/** Never send better than this, however small the call. The old fixed rate. */
export const MAX_VIDEO_BPS = 400_000;

/** Opus, per stream, never scaled — see the header. */
export const AUDIO_BPS = 64_000;

/**
 * Bits per second for ONE outgoing video stream, given how many peers this
 * phone is sending to.
 *
 * `peers` is the number of OTHER people — the count of peer connections, not
 * the room size — because that is what this phone actually pays for.
 *
 * A 1:1 call and a 4-person call both land on the ceiling, so the common case
 * is bit-for-bit what shipped before the cap was lifted; only rooms larger
 * than the old cap see any change at all.
 */
export function videoBitrateFor(peers: number): number {
  if (!Number.isFinite(peers) || peers <= 1) return MAX_VIDEO_BPS;
  const share = VIDEO_UPLOAD_BUDGET_BPS / peers;
  return Math.max(MIN_VIDEO_BPS, Math.min(MAX_VIDEO_BPS, Math.round(share)));
}

/**
 * How the app describes group calling wherever it is mentioned.
 *
 * One phrasing so the plan sheet and any in-call copy agree, and no number in
 * it — because there is no number, and a plan sheet that quotes one would be
 * re-inventing the cap in marketing copy.
 */
export const GROUP_CALLS_BLURB = "Group calls, free for everyone";
