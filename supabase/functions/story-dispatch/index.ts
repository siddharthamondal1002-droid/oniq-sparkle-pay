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

/**
 * Where the GitHub token might be, in the order it is looked for.
 *
 * "GitHub is connected" means at least three different things in this stack and
 * only one of them lands a credential here:
 *
 *   - Supabase's GitHub integration in the dashboard wires branching and
 *     deploys. It does not put a token in this function's environment.
 *   - Lovable's GitHub API connector is the LOVABLE AGENT's credential, and it
 *     surfaces as `GITHUB_API_KEY`. **That is deliberately NOT in this list.**
 *     It is a key for Lovable's connector gateway, not for api.github.com, so
 *     falling back to it would send a credential the wrong service will reject
 *     and turn a clear "no token configured" into a puzzling 401 from GitHub.
 *     A fallback that cannot work is worse than no fallback.
 *   - An Edge Function secret is the only thing `Deno.env.get` can see.
 *
 * So rather than insisting on one name and reporting a bare "not configured",
 * this tries the names a real GitHub PAT is plausibly stored under and SAYS
 * WHICH IT USED. When none are present it names every one it looked for,
 * because "not configured" on its own sends someone to check three dashboards.
 *
 * A real token may still lack the right permission and get a 403. That is fine
 * and visible: the status code is passed back verbatim below, so a wrong-scope
 * token reads differently from a missing one.
 */
const GITHUB_TOKEN_NAMES = [
  "GITHUB_DISPATCH_TOKEN",
  "GITHUB_TOKEN",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
] as const;

function findGithubToken(): { name: string; value: string } | null {
  for (const name of GITHUB_TOKEN_NAMES) {
    const value = Deno.env.get(name);
    if (value) return { name, value };
  }
  return null;
}

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
    const gh = findGithubToken();
    const repo = Deno.env.get("GITHUB_REPOSITORY") ?? "siddharthamondal1002-droid/oniq-sparkle-pay";
    const jobSecret = Deno.env.get("STORY_JOB_SECRET");

    // Each missing secret is named separately. "not configured" on its own
    // sends someone to check all three.
    const missing = [
      !supabaseUrl && "SUPABASE_URL",
      !gh && `a GitHub token under one of: ${GITHUB_TOKEN_NAMES.join(", ")}`,
      !jobSecret && "STORY_JOB_SECRET",
    ].filter(Boolean);
    if (missing.length > 0) {
      return json({ configured: false, missing, repo, checked: GITHUB_TOKEN_NAMES }, 200);
    }
    const ghToken = gh!.value;

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

    const dispatchRes = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
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
    if (dispatchRes.status !== 204) {
      const detail = await dispatchRes.text().catch(() => "");
      console.error("story-dispatch github", dispatchRes.status, detail.slice(0, 300));
      // The token's SOURCE is named in the failure. A 403 from a connector key
      // that lacks `actions: write` and a 404 from a token that cannot see the
      // repository look identical otherwise, and they need different fixes.
      return json(
        {
          error: `github dispatch failed: ${dispatchRes.status}`,
          usingToken: gh!.name,
          repo,
          detail: detail.slice(0, 200),
        },
        502,
      );
    }

    return json({ dispatched: true, jobId, usingToken: gh!.name }, 200);
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
