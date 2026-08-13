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

/** How long a dispatched-but-unclaimed job waits before being offered again. */
const DISPATCH_BACKOFF_MS = 10 * 60 * 1000;

/**
 * THE VOICE-BUDGET GATE. 2026-08-12's proof runs emptied Gemini TTS's daily
 * quota and the failure landed in the worst place: films dispatched, drew
 * every still — real image spend — and died at the voice stage. A job the
 * day's remaining voice budget cannot finish now WAITS in the queue instead
 * of dispatching; the ledger (public.api_budget, story-voice records into
 * it) rolls over at midnight Pacific and the same cron dispatches it then.
 *
 * The cap is TOTAL successful TTS calls a day, both models: ~100 flash
 * (measured — the bucket died just past it) plus pro-fallback headroom.
 * RAISE THIS when the Google AI key's billing tier goes up; it is the one
 * constant that says how many films a day the voices allow.
 *
 * The estimate is deliberately generous: a shot is ~7 seconds, and narration
 * plus a possible dialogue line is at most two calls a shot. Estimating high
 * means a film never starts on fumes; the cost of being wrong is a job
 * waiting a few extra hours, not a dead film.
 */
const VOICE_DAILY_CAP = 120;
const voiceCallsNeeded = (seconds: number) => Math.ceil(seconds / 7) * 2;

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

    // Queued AND not asked for in the last ten minutes. Without the second
    // half, a runner that cannot claim gets re-summoned every sixty seconds —
    // the first live Story burned eight runner minutes that way. Ten minutes is
    // comfortably longer than a healthy boot-and-claim (~90s, mostly Chromium),
    // so a working system never re-dispatches.
    const staleBefore = new Date(Date.now() - DISPATCH_BACKOFF_MS).toISOString();
    const res = await fetch(
      `${supabaseUrl}/rest/v1/story_jobs?status=eq.queued` +
        `&or=(dispatched_at.is.null,dispatched_at.lt.${staleBefore})` +
        `&order=created_at.asc&limit=1&select=id,requested_seconds`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!res.ok) {
      console.error("story-dispatch query", res.status, await res.text());
      return json({ error: "could not read the queue" }, 502);
    }
    const rows = (await res.json()) as { id: string; requested_seconds: number }[];
    if (!Array.isArray(rows) || rows.length === 0) {
      return json({ dispatched: false, reason: "nothing queued" }, 200);
    }

    // The voice-budget gate, FAIL OPEN. A broken ledger must degrade to
    // yesterday's behaviour (dispatch and hope), never to a queue nothing
    // can leave — so only a successful budget read that SAYS "not enough"
    // holds a job back. The held job stays queued, untouched: this same
    // cron re-offers it every minute and it dispatches the moment the
    // Pacific day rolls over.
    const need = voiceCallsNeeded(rows[0].requested_seconds ?? 0);
    try {
      const budgetRes = await fetch(`${supabaseUrl}/rest/v1/rpc/api_budget_left`, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ _bucket: "tts", _cap: VOICE_DAILY_CAP }),
      });
      if (budgetRes.ok) {
        const left = Number(await budgetRes.json());
        if (Number.isFinite(left) && left < need) {
          return json(
            {
              dispatched: false,
              reason: `voice budget low: ${left} of ${VOICE_DAILY_CAP} calls left, film needs ~${need} — job waits for the Pacific-midnight reset`,
              jobId: rows[0].id,
            },
            200,
          );
        }
      } else {
        console.warn("story-dispatch budget read failed", budgetRes.status);
      }
    } catch (e) {
      console.warn("story-dispatch budget check skipped", e);
    }

    const jobId = rows[0].id;
    const token = await mintJobToken(jobId, jobSecret!);

    // Stamped BEFORE the GitHub call, not after. If the dispatch throws or the
    // isolate dies mid-flight, an un-stamped row is re-dispatched a minute
    // later — which is the storm this exists to prevent. Ten minutes late is
    // the safe direction to be wrong in.
    await fetch(`${supabaseUrl}/rest/v1/story_jobs?id=eq.${jobId}`, {
      method: "PATCH",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ dispatched_at: new Date().toISOString() }),
    });

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
        // THE CALLBACK ADDRESS TRAVELS WITH THE JOB. It used to come from a
        // `SUPABASE_URL` secret on GitHub, and that secret pointed somewhere
        // else — every dispatch reached a runner, claimed nothing, and died on
        // a gateway 404 that looked like a bug in story-callback. Supabase
        // knows its own address; making GitHub store a second copy of it was
        // both unnecessary and the one thing that went stale.
        client_payload: { job_id: jobId, token, supabase_url: supabaseUrl },
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
