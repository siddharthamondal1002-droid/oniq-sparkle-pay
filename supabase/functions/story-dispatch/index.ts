// story-dispatch — Supabase hands one Story to a GitHub runner.
//
// THE DIRECTION IS THE POINT. The obvious wiring has GitHub poll Supabase on a
// cron, which means GitHub holds the service-role key: the database's master
// key, bypassing every RLS policy, sitting in a repository secret forever, to
// move one row through four states.
//
// This inverts it. Supabase already has its own credentials injected — it needs
// no secret to read its own tables — and reaches OUT to GitHub instead. What
// GitHub gets is a `repository_dispatch` carrying one job id and a capability
// token scoped to that job for an hour. No database key ever leaves here.
//
// The only secret this needs is a GitHub token with `actions: write` on the one
// repository, which is a far smaller thing to lose than a service-role key —
// and unlike the service-role key, Lovable can actually set it.
//
// ONE JOB PER CALL. Same reasoning as the worker: the guard order this project
// uses ends with "then the billable call", and a dispatcher that fans out the
// whole queue turns one bad night into a bill. A cron calls this again.
//
// IT DOES NOT CLAIM THE JOB. The row stays `queued` until the runner actually
// starts, so a dispatch that never lands on a runner leaves the job available
// rather than stranding it in `generating` with nothing working on it.
import { mintJobToken } from "../_shared/jobToken.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The workflow listens for exactly this. Changing it silently stops dispatch. */
const EVENT_TYPE = "story-job";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Service role only. This is a scheduled internal job, not a user action —
    // an authenticated user calling it could dispatch other people's Stories.
    const auth = req.headers.get("Authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey || auth !== `Bearer ${serviceKey}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const ghToken = Deno.env.get("GITHUB_DISPATCH_TOKEN");
    const repo = Deno.env.get("GITHUB_REPOSITORY") ?? "siddharthamondal1002-droid/oniq-sparkle-pay";
    const jobSecret = Deno.env.get("STORY_JOB_SECRET");

    // Each missing secret is named separately. "not configured" on its own
    // sends someone to check all three.
    const missing = [
      !supabaseUrl && "SUPABASE_URL",
      !ghToken && "GITHUB_DISPATCH_TOKEN",
      !jobSecret && "STORY_JOB_SECRET",
    ].filter(Boolean);
    if (missing.length > 0) return json({ configured: false, missing }, 200);

    const res = await fetch(
      `${supabaseUrl}/rest/v1/story_jobs?status=eq.queued&order=created_at.asc&limit=1&select=id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!res.ok) {
      console.error("story-dispatch query", res.status, await res.text());
      return json({ error: "could not read the queue" }, 502);
    }
    const rows = (await res.json()) as { id: string }[];
    if (!Array.isArray(rows) || rows.length === 0) {
      return json({ dispatched: false, reason: "nothing queued" }, 200);
    }

    const jobId = rows[0].id;
    const token = await mintJobToken(jobId, jobSecret!);

    const gh = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        event_type: EVENT_TYPE,
        client_payload: { job_id: jobId, token },
      }),
    });

    // GitHub answers 204 with no body on success.
    if (gh.status !== 204) {
      const detail = await gh.text().catch(() => "");
      console.error("story-dispatch github", gh.status, detail.slice(0, 300));
      return json({ error: `github dispatch failed: ${gh.status}` }, 502);
    }

    return json({ dispatched: true, jobId }, 200);
  } catch (e) {
    console.error("story-dispatch fn error", e);
    return json({ error: "Something went sideways" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
