// story-sweep — the deletion that happens when nobody taps Save.
//
// story-deliver purges on the tap, which covers the happy path. This covers
// every other one: a Story the user generated and never opened, a job that
// failed after buying nine stills, a runner that died mid-render, and the row
// whose delete returned 500 the first time. Without this, "your video is
// deleted from our servers" is true only for people who finish the flow.
//
// IT ASKS ABOUT BYTES, NOT STATUS. A row marked `purged` whose file was never
// actually removed still owes a deletion, and a status-only sweep is exactly
// the one that misses it. `has_bytes` is the question; the status only decides
// how long to wait first.
//
// THE RULES ARE MIRRORED FROM src/lib/storyLifecycle.ts, not imported: edge
// functions bundle from supabase/functions and reaching into src/ makes the
// deploy fragile. Duplicated constants drift, so storyLifecycle.test.ts reads
// THIS FILE and fails if the two ever disagree. That is the only reason it is
// safe to write them twice.
//
// SERVICE ROLE ONLY. It is a scheduled internal job. An authenticated user
// calling it could delete other people's films.

/** ready -> expired. Long enough to make one, walk away, and come back. */
const READY_TTL_MS = 2 * 60 * 60 * 1000;

/** queued/generating/assembling -> stale. A render is minutes, not half hours. */
const STALE_TTL_MS = 30 * 60 * 1000;

/** Same bucket as everything else. */
const BUCKET = "video-gen";

/**
 * How many rows one run will touch.
 *
 * Bounded because this is a scheduled job with a wall clock, and a sweep that
 * times out halfway through leaves an unknown amount done. Small and frequent
 * beats one big pass; the next tick takes the rest.
 */
const BATCH = 50;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Row = {
  id: string;
  status: string;
  storage_path: string | null;
  has_bytes: boolean;
  updated_at: string;
};

/** Mirrors owesPurge() in src/lib/storyLifecycle.ts. */
function owesPurge(row: Row, now: number): boolean {
  if (!row.has_bytes) return false;
  if (row.status === "purged") return true; // marked purged, bytes remain — a failed delete
  if (row.status === "delivered" || row.status === "failed") return true;
  const age = now - Date.parse(row.updated_at);
  if (row.status === "ready") return age > READY_TTL_MS;
  if (row.status === "queued" || row.status === "generating" || row.status === "assembling") {
    return age > STALE_TTL_MS;
  }
  // `delivering` is excluded on purpose: a transfer in flight must not have its
  // source deleted underneath it. It is released back to `ready` below and
  // ages out on a later pass.
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ configured: false }, 200);

    const auth = req.headers.get("Authorization") ?? "";
    if (auth !== `Bearer ${serviceKey}`) return json({ error: "Unauthorized" }, 401);

    const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    const now = Date.now();

    // A STUCK TRANSFER IS RELEASED, NOT PURGED. Someone whose download died
    // should find their film still there; sending it straight to deletion would
    // punish a dropped connection with a lost Story.
    const stuckBefore = new Date(now - STALE_TTL_MS).toISOString();
    await fetch(
      `${supabaseUrl}/rest/v1/story_jobs?status=eq.delivering&updated_at=lt.${stuckBefore}`,
      {
        method: "PATCH",
        headers: { ...svc, "content-type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ status: "ready" }),
      },
    ).catch((e) => console.error("story-sweep release", e));

    // A JOB THAT NEVER STARTED STILL COST SOMEBODY THEIR SECONDS.
    //
    // owesPurge asks about bytes, which is right for deletion and wrong for
    // this: a job stuck at `queued` or `generating` holds no bytes, so nothing
    // here ever looked at it. The first live Story sat queued while every
    // dispatch failed — charged, unrefundable, and re-dispatched every minute
    // forever. Ageing it out is the missing half of the lifecycle.
    //
    // `failed` is the honest label and it is also the useful one: the trigger
    // allows it from every pre-terminal state, and story_jobs' refund RPC is
    // idempotent, so a job swept twice gives its seconds back once.
    const deadBefore = new Date(now - STALE_TTL_MS).toISOString();
    const dead = await fetch(
      `${supabaseUrl}/rest/v1/story_jobs` +
        `?status=in.(queued,generating,assembling)&has_bytes=is.false` +
        `&updated_at=lt.${deadBefore}&select=id&limit=${BATCH}`,
      { headers: svc },
    );
    let expired = 0;
    if (dead.ok) {
      const deadRows = (await dead.json()) as { id: string }[];
      for (const row of Array.isArray(deadRows) ? deadRows : []) {
        const marked = await fetch(`${supabaseUrl}/rest/v1/story_jobs?id=eq.${row.id}`, {
          method: "PATCH",
          headers: { ...svc, "content-type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({
            status: "failed",
            error: "no renderer picked this up in time — your time has been returned",
          }),
        });
        if (!marked.ok) {
          console.error("story-sweep expire", row.id, marked.status);
          continue;
        }
        // Marked first, refunded second: if the refund throws, the job is still
        // out of the dispatch queue, whereas the reverse can refund a job that
        // then gets picked up and charged nothing.
        const refund = await fetch(`${supabaseUrl}/rest/v1/rpc/refund_story_seconds`, {
          method: "POST",
          headers: { ...svc, "content-type": "application/json" },
          body: JSON.stringify({ _job_id: row.id }),
        });
        if (!refund.ok) console.error("story-sweep refund", row.id, refund.status);
        expired += 1;
      }
    } else {
      console.error("story-sweep expire query", dead.status, await dead.text());
    }

    // Oldest first, and only rows that still hold bytes — the partial index on
    // has_bytes is exactly this query.
    const got = await fetch(
      `${supabaseUrl}/rest/v1/story_jobs?has_bytes=is.true&order=updated_at.asc&limit=${BATCH}` +
        `&select=id,status,storage_path,has_bytes,updated_at`,
      { headers: svc },
    );
    if (!got.ok) {
      console.error("story-sweep query", got.status, await got.text());
      return json({ error: "could not read the queue" }, 502);
    }
    const rows = (await got.json()) as Row[];
    const due = Array.isArray(rows) ? rows.filter((r) => owesPurge(r, now)) : [];

    let purged = 0;
    const failures: string[] = [];
    for (const row of due) {
      if (row.storage_path) {
        const del = await fetch(
          `${supabaseUrl}/storage/v1/object/${BUCKET}/${row.storage_path}`,
          { method: "DELETE", headers: svc },
        );
        // 404 means the object is already gone, which is the outcome we want.
        if (!del.ok && del.status !== 404) {
          failures.push(`${row.id}: storage ${del.status}`);
          // has_bytes stays true, so the next pass tries again rather than
          // recording a deletion that did not happen.
          continue;
        }
      }

      // has_bytes goes false in the same write that records the status, so the
      // row can never claim to be purged while still counting as holding bytes.
      const patch: Record<string, unknown> = { has_bytes: false };
      // The lifecycle trigger only allows -> purged from a terminal-ish state.
      // Anything else is moved to `failed` first, which is legal from every
      // pre-terminal status and is the honest label for a job that aged out.
      if (row.status !== "purged") {
        if (!["delivered", "failed"].includes(row.status)) {
          const toFailed = await fetch(`${supabaseUrl}/rest/v1/story_jobs?id=eq.${row.id}`, {
            method: "PATCH",
            headers: { ...svc, "content-type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ status: "failed", error: "expired before it was saved" }),
          });
          if (!toFailed.ok) {
            failures.push(`${row.id}: to-failed ${toFailed.status}`);
            continue;
          }
        }
        patch.status = "purged";
      }

      const marked = await fetch(`${supabaseUrl}/rest/v1/story_jobs?id=eq.${row.id}`, {
        method: "PATCH",
        headers: { ...svc, "content-type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
      if (!marked.ok) {
        failures.push(`${row.id}: mark ${marked.status}`);
        continue;
      }
      purged += 1;
    }

    if (failures.length > 0) console.error("story-sweep failures", failures.slice(0, 10));
    return json({ ok: true, scanned: rows.length, due: due.length, purged, expired, failures });
  } catch (e) {
    console.error("story-sweep fn error", e);
    return json({ error: "Something went sideways" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
