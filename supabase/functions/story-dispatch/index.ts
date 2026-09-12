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
import { authorizeScheduledCaller } from "../_shared/dispatchAuth.ts";
import { mintJobToken } from "../_shared/jobToken.ts";
import { OQCA_FLAG_ENV, parseMode } from "../_shared/oqcaRuntime/flag.ts";
import { callTextProvider } from "../_shared/oqcaRuntime/provider.ts";
import { runOqcaForDispatch } from "../_shared/oqcaRuntime/storyDispatchHook.ts";
import { serviceRoleRpc } from "../_shared/financialLedger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The workflow listens for exactly this. Changing it silently stops dispatch. */
const EVENT_TYPE = "story-job";

/**
 * HOW MANY QUEUED ROWS OQCA MAY REASON OVER. The production pick still reads
 * `limit=1` — that is untouched — but a loop choosing BETWEEN jobs needs more
 * than one candidate or every station downstream is a formality. Bounded
 * because this runs on a wall clock.
 */
const OQCA_QUEUE_LIMIT = 20;

/** How long a dispatched-but-unclaimed job waits before being offered again. */
const DISPATCH_BACKOFF_MS = 10 * 60 * 1000;

/**
 * THE VOICE-BUDGET GATE IS GONE (owner directive, 2026-08-15).
 *
 * It capped dispatch at 120 TTS calls a day and parked any film the day's
 * remainder could not finish, "waiting for the Pacific-midnight reset". Two
 * things were wrong with it by the time it was removed.
 *
 * It could not do what it claimed. story-sweep fails any queued job older
 * than thirty minutes, so the state this gate believed it was parking jobs
 * into did not exist: a held film was reaped long before the reset it was
 * waiting for, and the user was told "no renderer picked this up in time",
 * which is not what happened. Measured on job eb0d052f, 2026-08-15 — a 5
 * minute film needed ~86 calls of 56 remaining and died thirty minutes later.
 *
 * And it was guarding the wrong meter. The cap was sized to the Google AI
 * key's daily TTS quota, but the owner's 2026-08-14 directive rerouted voices
 * through the Lovable gateway — story-voice now spends CREDITS, and Google's
 * per-day ceiling stopped governing anything.
 *
 * WHAT THIS COSTS, said plainly because removing a spend guard should never
 * be quiet: the original 2026-08-12 failure is possible again. If the voice
 * provider refuses mid-film, the job has already drawn every still — real
 * image spend — and dies at the voice stage with that money gone. There is
 * now no daily ceiling on how many films a day can be attempted. The owner
 * accepted both, knowing the rate is ~1.47 credits per finished minute.
 *
 * story-voice still records every call into public.api_budget. Nothing reads
 * it to make a decision any more; it is kept as the measurement that would
 * let a future ceiling be set from evidence rather than guessed at again.
 */

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
    // Scheduled caller only. This is an internal job, not a user action — an
    // authenticated user calling it could dispatch other people's Stories.
    // _shared/dispatchAuth.ts holds the credential's whole story: why it is a
    // dedicated secret rather than the service-role key, and the 2026-08-30
    // outage that forced the change.
    //
    // WHEN THE STORY QUEUE STOPS MOVING, READ story_dispatch_health FIRST.
    // consecutive_failures and last_detail name a caller-auth failure in one
    // row, and last_ok_at brackets when it began. Do NOT start at story-still:
    // a dispatcher that never fires leaves the GPU idle and the job rows
    // clean, with `error` empty and dispatched_at NULL, which reads like a
    // fault downstream of the queue and is the opposite of one. A user's Story
    // sat in `queued` for over half an hour that way, while the GPU worker sat
    // warm and idle and every probe of it came back healthy.
    if (!authorizeScheduledCaller(req)) {
      return json({ error: "Unauthorized" }, 401);
    }
    // Still needed BELOW, for this function's OWN PostgREST calls. What moved
    // to a dedicated secret is the CALLER's credential, not the function's.
    // Checked here rather than folded into `missing` below because this is
    // also what narrows the type for the header uses further down.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) {
      return json({ configured: false, missing: ["SUPABASE_SERVICE_ROLE_KEY"] }, 200);
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

    // READ-ONLY: is the DEFAULT BRANCH's workflow the one that honours a
    // per-job routing override?
    //
    // A workflow file only takes effect on repository_dispatch once it is on
    // the default branch, and this container cannot see GitHub (the connector
    // credential answers 401 Bad credentials, and `origin` here is Lovable's
    // own mirror, not GitHub). Dispatching the bounded in-house motion test
    // against a STALE workflow would run the old routing and waste the test.
    //
    // It reads one file with the token this function already holds, dispatches
    // nothing, claims no runner and spends nothing.
    //
    // NO SECOND GATE, deliberately. The first draft added its own
    // `role === "service_role"` check on top, and that refused the very caller
    // this exists for: the scheduled credential is `story_dispatch_service_role_key`,
    // which is OPAQUE and carries no JWT claims, so every call answered 401
    // while the ordinary dispatch path using the same key worked perfectly.
    // authorizeScheduledCaller above is already the stronger gate — a second,
    // narrower one below it can only subtract callers it was never meant to.
    if (new URL(req.url).searchParams.get("action") === "workflow_head") {

      const wf = await fetch(
        `https://api.github.com/repos/${repo}/contents/.github/workflows/story-worker.yml?ref=main`,
        {
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github.raw+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      const text = wf.ok ? await wf.text() : (await wf.text()).slice(0, 300);
      return json({
        status: wf.status,
        // The MARKER, never the file. The workflow is long and carries no
        // secret, but shipping it back would make every future reader of this
        // reply scroll a config file to learn one boolean.
        honoursPerJobOverride: wf.ok && text.includes("client_payload.in_house_motion"),
        detail: wf.ok ? undefined : text,
      });
    }


    // Queued AND not asked for in the last ten minutes. Without the second
    // half, a runner that cannot claim gets re-summoned every sixty seconds —
    // the first live Story burned eight runner minutes that way. Ten minutes is
    // comfortably longer than a healthy boot-and-claim (~90s, mostly Chromium),
    // so a working system never re-dispatches.
    const staleBefore = new Date(Date.now() - DISPATCH_BACKOFF_MS).toISOString();
    const res = await fetch(
      `${supabaseUrl}/rest/v1/story_jobs?status=eq.queued` +
        `&or=(dispatched_at.is.null,dispatched_at.lt.${staleBefore})` +
        `&order=created_at.asc&limit=1&select=id,requested_seconds,actor_refs,grade,motion_mode`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!res.ok) {
      console.error("story-dispatch query", res.status, await res.text());
      return json({ error: "could not read the queue" }, 502);
    }
    const rows = (await res.json()) as {
      id: string;
      requested_seconds: number;
      actor_refs?: boolean;
      grade?: string;
      motion_mode?: string | null;
    }[];
    if (!Array.isArray(rows) || rows.length === 0) {
      return json({ dispatched: false, reason: "nothing queued" }, 200);
    }

    // ------------------------------------------------------------------
    // OQCA — brief sections 2, 7, 8 and 9. OFF BY DEFAULT, AND OFF IS THIS
    // FUNCTION EXACTLY AS IT WAS. `parseMode` treats anything it does not
    // recognise as "off", including a typo, so a misspelt secret cannot
    // change what a scheduled dispatcher does.
    //
    // ASSISTED RUNS BEFORE THE PRODUCTION PICK AND SHADOW RUNS AFTER IT, and
    // the ordering is the point rather than a detail. In assisted mode the
    // loop may dispatch, so it must decide before this function has, or two
    // dispatches go out. In shadow mode it must not affect the answer at all,
    // so it runs once the answer is already made.
    //
    // `runOqcaForDispatch` cannot throw and returns `handled: false` on every
    // failure, so the lines below run unchanged whatever happens inside it.
    const oqcaMode = parseMode(Deno.env.get(OQCA_FLAG_ENV));
    let oqca = null;
    if (oqcaMode === "assisted") {
      oqca = await runOqcaForDispatch({
        mode: oqcaMode,
        runId: crypto.randomUUID(),
        call: callTextProvider,
        // THE SPEND LEDGER. Without it every model call refuses with
        // `guard-unavailable`, which is the right failure for the wrong reason:
        // the loop would look like a broken provider rather than a missing
        // wire. The ceiling that binds is `provider_budget_config` for TEXT —
        // owner directive 2026-09-11, $100/day, cumulative and row-locked.
        rpc: serviceRoleRpc(),
        envConfig: {
          supabaseUrl: supabaseUrl!,
          serviceKey,
          repo,
          githubToken: ghToken,
          eventType: EVENT_TYPE,
          queueLimit: OQCA_QUEUE_LIMIT,
          payloadFor: async (id: string) => ({
            job_id: id,
            token: await mintJobToken(id, jobSecret!),
            supabase_url: supabaseUrl,
            actor_refs:
              rows.find((r) => r.id === id)?.actor_refs === true ||
              rows.find((r) => r.id === id)?.grade === "movie",
            ...(rows.find((r) => r.id === id)?.motion_mode === "select"
              ? { story_movie: "select" }
              : {}),
            ...(rows.find((r) => r.id === id)?.motion_mode === "in_house"
              ? { in_house_motion: true }
              : {}),

          }),
        },
      });
      if (oqca.handled) {
        return json(
          { dispatched: oqca.jobId !== null, jobId: oqca.jobId, by: "oqca", oqca: oqca.comparison },
          200,
        );
      }
    }

    const jobId = rows[0].id;
    // OWNER-ACTOR conditioning GRADUATED to default-on for MOVIE grade
    // (2026-08-22), after the 43-shot acceptance render (job 5871421e) passed
    // visual inspection: 38/38 eligible shots conditioned with clean anatomy
    // and no reference contamination, and the sheet-refusal path degraded
    // gracefully to text-only draws. The per-job flag still wins for any job
    // that set it explicitly, classic-grade jobs stay off (their pipeline
    // never carried conditioning), and the workflow/worker defaults remain
    // 'off' — an unset payload can never enable it anywhere else.
    const actorRefs = rows[0].actor_refs === true || rows[0].grade === "movie";
    // PER-JOB clip-stage mode (owner-authorized Veo `select` validation,
    // 2026-08-22). Only the literal 'select' travels — anything else,
    // including NULL (every production job) and any unexpected value, sends
    // nothing and the workflow's STORY_MOVIE stays off. The column is
    // service-role-writable only (story_jobs has no client INSERT/UPDATE
    // policy), so this can never become a user-reachable spend switch.
    const motionMode = rows[0].motion_mode === "select" ? "select" : null;
    // PER-JOB IN-HOUSE MOTION (owner-authorized bounded internal test,
    // 2026-09-12). Same shape and same reasoning as the two flags above: only
    // the literal 'in_house' travels, and NULL — every production job — sends
    // nothing, so the workflow keeps reading the repository variables it reads
    // today and the paid tier's routing is byte-identical.
    //
    // This is the only way to scope the test. routeMotion's three gates come
    // from GLOBAL repository variables; flipping those would change the engine
    // for every film every user renders.
    const inHouseMotion = rows[0].motion_mode === "in_house";

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
        client_payload: {
          job_id: jobId,
          token,
          supabase_url: supabaseUrl,
          actor_refs: actorRefs,
          ...(motionMode ? { story_movie: motionMode } : {}),
          ...(inHouseMotion ? { in_house_motion: true } : {}),

        },
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

    // SHADOW RUNS AFTER THE DISPATCH IS ALREADY OUT, so nothing it does can
    // change what happened. Section 8: "without changing the user's result".
    if (oqcaMode === "shadow") {
      oqca = await runOqcaForDispatch({
        mode: oqcaMode,
        runId: crypto.randomUUID(),
        call: callTextProvider,
        // THE SPEND LEDGER. Without it every model call refuses with
        // `guard-unavailable`, which is the right failure for the wrong reason:
        // the loop would look like a broken provider rather than a missing
        // wire. The ceiling that binds is `provider_budget_config` for TEXT —
        // owner directive 2026-09-11, $100/day, cumulative and row-locked.
        rpc: serviceRoleRpc(),
        envConfig: {
          supabaseUrl: supabaseUrl!,
          serviceKey,
          repo,
          githubToken: ghToken,
          eventType: EVENT_TYPE,
          queueLimit: OQCA_QUEUE_LIMIT,
          // A SHADOW RUN NEVER DISPATCHES, so it never mints a token. This
          // throws rather than returning an empty payload: reaching it would
          // mean the shadow gate failed, and a silent empty dispatch is the
          // shape of bug that gets found in a bill.
          payloadFor: () => {
            throw new Error("oqca shadow: a dispatch payload was requested");
          },
        },
      });
      console.log(`oqca shadow ${JSON.stringify(oqca.comparison ?? { error: oqca.error })}`);
    }

    return json(
      { dispatched: true, jobId, usingToken: gh!.name, ...(oqca ? { oqca: oqca.comparison } : {}) },
      200,
    );
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
