// Who is allowed to poke the two SCHEDULED Story functions.
//
// story-dispatch and story-sweep are called by pg_cron, never by a person and
// never by the app. Both have verify_jwt = false (see supabase/config.toml —
// a machine caller has no user JWT for the gateway to check), so this is the
// only gate in front of them and it has to hold on its own.
//
// WHY NOT THE SERVICE-ROLE KEY, WHICH IS WHAT THEY USED TO COMPARE.
//
// The old check was `auth !== "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`.
// That meant the caller had to hold the database's MASTER credential just to
// say "there is work, go look" — and because pg_cron cannot read the function's
// environment, a second copy of that master key had to be kept in the Postgres
// vault for the tick to send. Two copies of the most powerful secret in the
// project, compared by byte equality, with nothing keeping them in step and no
// test that they still matched.
//
// It broke exactly the way that design predicts. On 2026-08-30 the vault's copy
// was overwritten at 16:57:45 with a DIFFERENT service-role credential — a
// legacy `eyJ...` JWT, still perfectly valid, which authenticated against
// PostgREST when it was tested. Valid was not enough, because the check is
// equality. The first 401 landed at 17:00:00, the next scheduled call after
// that write. Every dispatch and every sweep failed from then on: no Story
// could leave the queue, and user video stopped being purged. This project is
// on Supabase's new API key format (`sb_publishable_` / `sb_secret_`, see
// src/integrations/supabase/client.ts), so the value the platform injects and
// a legacy JWT are different strings by construction.
//
// THIS IS NOT A WEAKER GATE — IT IS A NARROWER ONE.
//
// The threat is that story-dispatch is reachable by anyone on the internet, so
// the secret must be unguessable. A 32-byte random value is that, with room to
// spare; nothing about the old check's strength came from the key ALSO being
// able to read every table in the database. What changes is the blast radius of
// the copy that has to live in the vault: it now authorises "ask the dispatcher
// to run" and nothing else. That is the same least-privilege reasoning as
// jobToken.ts, which exists because handing GitHub the service-role key to move
// one row through four states was "a spectacular over-grant".
//
// Both functions still read SUPABASE_SERVICE_ROLE_KEY for their OWN PostgREST
// calls. That is unchanged and correct — it is the caller's credential, not the
// function's, that this replaces.
//
// FAIL CLOSED. An unset STORY_DISPATCH_KEY refuses every caller rather than
// admitting any, so a half-finished rollout is an outage and never an opening.

/**
 * Compare without leaking WHERE two strings diverge.
 *
 * Length is allowed to short-circuit: it is not the secret, and jobToken.ts
 * settles its signature comparison the same way.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * True only for a caller presenting the scheduled-caller secret.
 *
 * The value lives in TWO places on purpose and they must be identical: the
 * edge-function secret STORY_DISPATCH_KEY, which this reads, and the Postgres
 * vault, which story_dispatch_tick() and story_sweep_tick() send. Change one
 * and you must change the other in the same breath — that coupling is the
 * whole failure mode recorded above, and moving to a dedicated secret shrinks
 * what a mismatch costs without removing the requirement to keep them equal.
 *
 * NOTE ON THE VAULT'S NAME. The tick functions look up
 * `story_dispatch_service_role_key` first, and that entry now holds THIS
 * secret rather than a service-role key. The name is left alone deliberately:
 * renaming it means editing both SQL functions, and that migration was not
 * worth running while production was down. It is the next thing to tidy.
 */
export function authorizeScheduledCaller(req: Request): boolean {
  const secret = Deno.env.get("STORY_DISPATCH_KEY");
  if (!secret) return false;
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  return timingSafeEqual(auth.slice(7), secret);
}
