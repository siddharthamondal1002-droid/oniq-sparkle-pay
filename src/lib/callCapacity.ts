/**
 * HOW MANY PEOPLE FIT IN ONE CALL — owner directive, 2026-08-16.
 *
 * Free 4, Plus 8, and the room size is the reason to upgrade. This TRIMS the
 * 2026-08-16 "group calls stay free for everyone" directive rather than
 * replacing it: group calling is still on the free plan and nobody loses it,
 * but past four people it is a Plus feature. Asked and answered with that
 * reversal named out loud before any of it was written.
 *
 * WHY THERE IS A CEILING AT ALL. The call path is a MESH — every participant
 * opens a peer connection to every other participant and sends a separate
 * copy of its own camera down each one. At CallOverlay's own bitrate caps
 * (400 kbps video + 64 kbps audio) every extra person costs EVERY phone in
 * the call another 464 kbps in both directions:
 *
 *     4 people  ->  3 connections per phone, ~1.4 Mbps each way
 *     8 people  ->  7 connections per phone, ~3.3 Mbps each way
 *
 * Eight is the top of what a phone on good wifi or 5G holds. The header on
 * CallOverlay.tsx used to say "no participant cap", which on a mesh is not a
 * feature — it is an unbounded device load and an unbounded TURN relay bill.
 *
 * THESE NUMBERS MIRROR subscription_plans.max_call_participants. The database
 * is the authority (`my_call_cap`); these exist so the UI has something to
 * say before the read lands, and so a plan row edited to something absurd
 * fails a test rather than a phone.
 *
 * NO IMPORTS ON PURPOSE — entitlements.ts leans on FREE_CALL_PARTICIPANTS as
 * its fallback, and a cycle through this file would be a hard one to see.
 */

/** The free plan's room, counting the caller. */
export const FREE_CALL_PARTICIPANTS = 4;

/** Every paid tier's room, counting the caller. */
export const PLUS_CALL_PARTICIPANTS = 8;

/**
 * The most any plan may sell. Past this the mesh stops being a call and
 * starts being a way to overheat a phone, whatever anyone has paid.
 */
export const MAX_CALL_PARTICIPANTS = PLUS_CALL_PARTICIPANTS;

/** "up to 4 people" — one phrasing, so the plan sheet and the toast agree. */
export function sayCallCap(n: number): string {
  return n <= 2 ? "one-to-one calls" : `group calls up to ${n} people`;
}
