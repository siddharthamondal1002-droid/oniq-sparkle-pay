// story-callback — the runner's only way to touch the database.
//
// The runner holds a per-job capability token, not a Supabase key. Every state
// change it wants comes through here, and this function checks the token names
// the job being changed before it does anything with the service role.
//
// THE JOB ID IS TAKEN FROM THE TOKEN, NEVER FROM THE BODY. That is the whole
// security property. A body-supplied id with a valid token for a different job
// would let one runner mark any Story failed; taking it from the signed part
// makes that unrepresentable rather than merely forbidden.
//
// FOUR ACTIONS, NOT AN UPDATE ENDPOINT. `started`, `assembling`, `ready` and
// `failed` are the only transitions a runner ever needs. A general "patch this
// row" would let a compromised token write storage_path, seconds_charged or
// refunded_at — none of which are the runner's business. The database trigger
// still rejects an illegal move on top of this.
import { verifyJobToken } from "../_shared/jobToken.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action = "claim" | "assembling" | "upload-url" | "ready" | "failed";
const ACTIONS: ReadonlySet<string> = new Set([
  "claim",
  "assembling",
  "upload-url",
  "ready",
  "failed",
]);

/** Where a finished Story lands. Same bucket the episodes use. */
const BUCKET = "video-gen";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const jobSecret = Deno.env.get("STORY_JOB_SECRET");
    if (!supabaseUrl || !serviceKey || !jobSecret) {
      return json({ configured: false }, 200);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (!ACTIONS.has(action)) return json({ error: "unknown action" }, 400);

    const verified = await verifyJobToken(String(body?.token ?? ""), jobSecret);
    if (!verified.ok) return json({ error: `token ${verified.reason}` }, 401);
    const jobId = verified.jobId;

    // CLAIM RETURNS THE JOB, which is why the runner needs no database access.
    // It gets the prompt and the shot count back in the same call that moves
    // the row to `generating` — one round trip, and no read credential.
    if (action === "claim") {
      const got = await fetch(
        `${supabaseUrl}/rest/v1/story_jobs?id=eq.${jobId}&select=id,prompt,requested_seconds,shot_count,status`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
      );
      if (!got.ok) return json({ error: "could not read the job" }, 502);
      const rows = (await got.json()) as Record<string, unknown>[];
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: "no such job" }, 404);
      const job = rows[0];
      // Only a queued job may be claimed. A second runner arriving on a retry
      // must not restart one that is already generating and already paid for.
      if (job.status !== "queued") return json({ error: `job is ${job.status}` }, 409);

      const moved = await fetch(`${supabaseUrl}/rest/v1/story_jobs?id=eq.${jobId}&status=eq.queued`, {
        method: "PATCH",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "content-type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ status: "generating" }),
      });
      const movedRows = moved.ok ? await moved.json() : [];
      // The status filter makes this the atomic claim: if another runner won
      // the race, zero rows come back and this one steps aside.
      if (!Array.isArray(movedRows) || movedRows.length === 0) {
        return json({ error: "already claimed" }, 409);
      }
      return json({
        ok: true,
        jobId,
        prompt: job.prompt,
        shotCount: job.shot_count,
        requestedSeconds: job.requested_seconds,
      });
    }

    // A SIGNED UPLOAD URL, so the runner never holds a storage credential.
    // The path is derived from the job id here rather than accepted from the
    // body — a runner that could name its own path could overwrite somebody
    // else's Story, or anything else in the bucket.
    if (action === "upload-url") {
      const objectPath = `stories/${jobId}.mp4`;
      const signed = await fetch(
        `${supabaseUrl}/storage/v1/object/upload/sign/${BUCKET}/${objectPath}`,
        {
          method: "POST",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ upsert: true }),
        },
      );
      if (!signed.ok) {
        const detail = await signed.text().catch(() => "");
        console.error("story-callback sign", signed.status, detail.slice(0, 300));
        return json({ error: "could not sign an upload" }, 502);
      }
      const { url } = (await signed.json()) as { url?: string };
      if (!url) return json({ error: "no signed url returned" }, 502);
      return json({ ok: true, uploadUrl: `${supabaseUrl}/storage/v1${url}`, storagePath: objectPath });
    }

    const patch: Record<string, unknown> = {};
    switch (action as Action) {
      case "assembling":
        patch.status = "assembling";
        break;
      case "ready": {
        const storagePath = String(body?.storagePath ?? "");
        // A `ready` with no file is the worst possible lie: the user is told
        // their Story is waiting and there is nothing to fetch.
        if (!storagePath) return json({ error: "ready needs a storagePath" }, 400);
        patch.status = "ready";
        patch.storage_path = storagePath;
        patch.has_bytes = true;
        if (typeof body?.shotCount === "number") patch.shot_count = body.shotCount;
        break;
      }
      case "failed":
        patch.status = "failed";
        patch.error = String(body?.error ?? "render failed").slice(0, 500);
        break;
    }

    const res = await fetch(`${supabaseUrl}/rest/v1/story_jobs?id=eq.${jobId}`, {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // The lifecycle trigger rejects an illegal transition, and that arrives
      // here as a 4xx. Pass it back rather than swallowing it — a runner trying
      // to move a purged job to `ready` needs to see why it was refused.
      console.error("story-callback patch", res.status, detail.slice(0, 300));
      return json({ error: `update rejected: ${res.status}`, detail: detail.slice(0, 200) }, 409);
    }

    // Refunding is not the runner's decision, so it is not an action — a failed
    // job's seconds go back here, where the service role already is.
    if (action === "failed") {
      const refund = await fetch(`${supabaseUrl}/rest/v1/rpc/refund_story_seconds`, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ _job_id: jobId }),
      });
      if (!refund.ok) {
        // The job is already marked failed, which is the important part — the
        // sweeper will reclaim its bytes either way. Log and carry on rather
        // than turning a handled failure into an unhandled one.
        console.error("story-callback refund", refund.status, await refund.text());
      }
    }

    return json({ ok: true, jobId, status: patch.status }, 200);
  } catch (e) {
    console.error("story-callback fn error", e);
    return json({ error: "Something went sideways" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
