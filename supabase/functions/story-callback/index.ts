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

type Action = "started" | "assembling" | "ready" | "failed";
const ACTIONS: ReadonlySet<string> = new Set(["started", "assembling", "ready", "failed"]);

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

    const patch: Record<string, unknown> = {};
    switch (action as Action) {
      case "started":
        patch.status = "generating";
        break;
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
