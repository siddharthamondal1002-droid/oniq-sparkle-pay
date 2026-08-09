/**
 * Stories — make your own video, in-house.
 *
 * The generation surface for user prompts, sitting under Lores next to the
 * Originals it shares a pipeline with.
 *
 * THREE PRODUCT PROMISES ARE LOAD-BEARING HERE, and each one is a specific bit
 * of this file rather than a line of copy somewhere:
 *
 *   1. THE VIDEO DOES NOT STAY ON OUR SERVERS. It exists while it is being
 *      made, the user previews it, it transfers to their device, and then it is
 *      deleted. `storyLifecycle.ts` makes every path end in `purged`.
 *   2. THERE IS NO RE-DOWNLOAD, and that is said BEFORE generation, not after.
 *      A user who learns it at the download step has already spent their free
 *      time on a video they may lose.
 *   3. WHAT YOU MAKE IS YOURS. Sharing it back THROUGH ONIQ is a different act
 *      and gets scanned like any other upload.
 *
 * THE SERVER IS THE AUTHORITY ON QUOTA. `checkStoryQuota` runs here only so the
 * button can be disabled and the reason shown before a round trip. The decision
 * that counts is `claim_story_seconds`, which takes a row lock — two taps a
 * millisecond apart both pass the client check and only one passes that.
 *
 * WHY GENERATE MAY REFUSE TODAY. `story_config.enabled` ships false. Deployed
 * app AI draws the same credit balance that builds ONIQ, behind a 4-credit
 * monthly grant, so the feature stays off until a real per-Story cost is
 * measured. The screen is complete; the switch is a config row.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Clapperboard, Download, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";
import {
  DEFAULT_STORY_SECONDS,
  MAX_STORY_SECONDS,
  MIN_STORY_SECONDS,
  parseClaimResult,
  planStory,
  refusalMessage,
  type QuotaRefusal,
} from "@/lib/storyPlan";

/** Lengths offered as one tap. Anything between the bounds is still allowed. */
const PRESETS = [30, 60, 120, 300] as const;

/** Ting opens with these, and a blank prompt box is the hardest screen to start. */
const SUGGESTIONS = [
  "A girl finds a door in the roots of a banyan tree",
  "The last lamplighter in a city that just got electricity",
  "Two street cats argue about who owns the rooftop",
];

/**
 * The Supabase types file is GENERATED FROM THE LIVE PROJECT, and these two
 * functions are in a migration that has not been applied there yet — so
 * `supabase.rpc('claim_story_seconds')` does not typecheck against a schema
 * that has never seen it.
 *
 * This narrows that gap to one place instead of casting at each call site.
 * DELETE IT once the migration is applied and the types are regenerated; if it
 * outlives that, it is hiding a real name mismatch rather than a timing one.
 */
type StoryRpc = "story_quota_status" | "claim_story_seconds";
async function callStoryRpc(
  fn: StoryRpc,
  args?: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string } | null }> {
  const client = supabase as unknown as {
    rpc: (
      n: string,
      a?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  return client.rpc(fn, args);
}

/** Same gap, same reason, same deletion date: `story_jobs` is not in the types yet. */
async function readJobRow(id: string): Promise<{ status?: string; error?: string } | null> {
  const client = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          col: string,
          v: string,
        ) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
      };
    };
  };
  const { data } = await client.from("story_jobs").select("status,error").eq("id", id).maybeSingle();
  return (data as { status?: string; error?: string } | null) ?? null;
}

/**
 * What the user is told while they wait.
 *
 * Named per status rather than a single spinner because these steps take
 * minutes, not seconds — about 4.5 minutes of render per minute of film — and a
 * progress message that never changes is indistinguishable from a hang.
 */
const PROGRESS: Record<string, string> = {
  queued: "Waiting for a free renderer…",
  generating: "Ting is writing your film, and drawing every shot…",
  assembling: "Putting it together — this is the slow part.",
  ready: "Your film is ready.",
  delivering: "Your film is ready.",
};

/** Statuses where polling should stop, because nothing more will change. */
const SETTLED: ReadonlySet<string> = new Set(["ready", "delivering", "delivered", "purged", "failed"]);

/** What `story-plot` returns: Ting's film, before a frame exists. */
export type StoryPlot = {
  title: string;
  logline: string;
  setting: string;
  cast: { name: string; lock: string }[];
  shots: { still: string; narration: string }[];
};

type QuotaStatus = {
  enabled: boolean;
  freeSeconds: number;
  usedSeconds: number;
  remaining: number;
  dailyLeft: number;
  minSeconds: number;
  maxSeconds: number;
};

function readQuota(payload: unknown): QuotaStatus | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const num = (k: string, fallback: number) =>
    typeof p[k] === "number" ? (p[k] as number) : fallback;
  return {
    enabled: p.enabled === true,
    freeSeconds: num("freeSeconds", 0),
    usedSeconds: num("usedSeconds", 0),
    remaining: num("remaining", 0),
    dailyLeft: num("dailyLeft", 0),
    minSeconds: num("minSeconds", MIN_STORY_SECONDS),
    maxSeconds: num("maxSeconds", MAX_STORY_SECONDS),
  };
}

export function StoryStudio() {
  // EVERY HOOK ABOVE EVERY EARLY RETURN. rules-of-hooks is a release blocker in
  // this repo — three violations reached production on 2026-08-04 with tsc
  // clean and 275 tests green, and the app only threw once a particular branch
  // rendered. There are no early returns below, and there must not be.
  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState<number>(DEFAULT_STORY_SECONDS);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [loadingQuota, setLoadingQuota] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<QuotaRefusal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [filmUrl, setFilmUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: rpcError } = await callStoryRpc("story_quota_status");
      if (cancelled) return;
      if (rpcError) {
        setError("Could not load your Story balance.");
      } else {
        setQuota(readQuota(data));
      }
      setLoadingQuota(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Watch the job until it settles.
   *
   * POLLING, NOT REALTIME, and deliberately. A render takes minutes; a
   * subscription held open across a backgrounded phone reconnects into an
   * unknown state, and the recovery for that is a poll. This is the recovery
   * with none of the machinery.
   *
   * Six seconds. The step it is waiting on is measured in minutes, so a faster
   * tick would only add requests.
   */
  useEffect(() => {
    if (!jobId || (jobStatus && SETTLED.has(jobStatus))) return;
    let cancelled = false;
    const tick = async () => {
      const row = await readJobRow(jobId);
      if (cancelled || !row?.status) return;
      setJobStatus(row.status);
      if (row.status === "failed") {
        // The seconds are already back — refund_story_seconds runs server-side
        // when the job is marked failed, so this is telling the user something
        // that is already true rather than promising it.
        setJobError(row.error ?? "That Story could not be made. Your time has been returned.");
        void (async () => {
          const { data } = await callStoryRpc("story_quota_status");
          if (!cancelled) setQuota(readQuota(data));
        })();
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 6000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [jobId, jobStatus]);

  /**
   * Open the film once it exists.
   *
   * `start` moves the job to `delivering` and hands back one short-lived signed
   * URL that serves BOTH the preview and the save. Issuing two would be two
   * chances to leak the same bytes.
   */
  useEffect(() => {
    if (jobStatus !== "ready" && jobStatus !== "delivering") return;
    if (!jobId || filmUrl) return;
    let cancelled = false;
    void (async () => {
      const { data, error: fnError } = await supabase.functions.invoke("story-deliver", {
        body: { action: "start", jobId },
      });
      if (cancelled) return;
      const payload = data as { url?: string; error?: string } | null;
      if (fnError || payload?.error || !payload?.url) {
        setJobError(payload?.error ?? "Could not open your film.");
        return;
      }
      setFilmUrl(payload.url);
    })();
    return () => {
      cancelled = true;
    };
  }, [jobStatus, jobId, filmUrl]);

  /**
   * Save it to the device, then delete it from ours — in that order, and only
   * on an explicit tap.
   *
   * The purge is not a background job here. The screen promises "your video
   * goes to your device once, then it is deleted from our servers" BEFORE
   * anyone spends a second of their allowance, and a promise made before the
   * action has to be kept by the action.
   */
  const saveToDevice = useCallback(async () => {
    if (!jobId || !filmUrl) return;
    setSaving(true);
    setJobError(null);
    try {
      // Fetched as a blob rather than linked, so the anchor's download
      // attribute is honoured — a cross-origin href ignores it and opens the
      // video in a tab instead, which on a phone means it is never saved.
      const res = await fetch(filmUrl);
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `oniq-story-${jobId.slice(0, 8)}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);

      const { data } = await supabase.functions.invoke("story-deliver", {
        body: { action: "done", jobId },
      });
      const payload = data as { error?: string } | null;
      if (payload?.error) {
        // The file IS on their device; only the cleanup stumbled. Saying
        // "failed" here would be a lie in the direction that makes someone
        // download it twice.
        setJobError(payload.error);
      }
      setSaved(true);
      setFilmUrl(null);
      setJobStatus("purged");
    } catch (e) {
      setJobError(e instanceof Error ? e.message : "Could not save that file.");
      // Hand the job back so the film is not lost to a dropped connection.
      await supabase.functions
        .invoke("story-deliver", { body: { action: "cancel", jobId } })
        .catch(() => undefined);
      setFilmUrl(null);
      setJobStatus("ready");
    } finally {
      setSaving(false);
    }
  }, [jobId, filmUrl]);

  const plan_ = useMemo(() => planStory(seconds), [seconds]);

  /**
   * The local read of whether this request can go. Advisory only — it exists so
   * the button can explain itself without a round trip, and it is deliberately
   * derived from the SAME `refusalMessage` the server path uses, so the two
   * cannot word the same refusal differently.
   */
  const localBlock = useMemo<QuotaRefusal | null>(() => {
    if (!quota) return null;
    if (!quota.enabled) {
      return {
        reason: "disabled",
        message: refusalMessage("disabled", { remaining: 0, dailyLeft: 0, wanted: 0 }),
        remaining: quota.remaining,
      };
    }
    if (quota.remaining <= 0) {
      return {
        reason: "exhausted",
        message: refusalMessage("exhausted", { remaining: 0, dailyLeft: 0, wanted: 0 }),
        remaining: 0,
      };
    }
    if (plan_.seconds > quota.dailyLeft) {
      return {
        reason: "daily",
        message: refusalMessage("daily", {
          remaining: quota.remaining,
          dailyLeft: quota.dailyLeft,
          wanted: plan_.seconds,
        }),
        remaining: quota.remaining,
      };
    }
    if (plan_.seconds > quota.remaining) {
      return {
        reason: "too-long",
        message: refusalMessage("too-long", {
          remaining: quota.remaining,
          dailyLeft: quota.dailyLeft,
          wanted: plan_.seconds,
        }),
        remaining: quota.remaining,
      };
    }
    return null;
  }, [quota, plan_.seconds]);

  const generate = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    setRefusal(null);
    // A second Story starts from a clean screen. Leaving the previous film's
    // "Saved" note up next to a new job reads as if the new one is already done.
    setSaved(false);
    setJobError(null);
    setFilmUrl(null);
    setJobStatus(null);
    try {
      const { data, error: rpcError } = await callStoryRpc("claim_story_seconds", {
        _requested_seconds: plan_.seconds,
        _prompt: prompt.trim(),
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      const claim = parseClaimResult(data);
      if (claim.ok) {
        setJobId(claim.jobId);
        // Named immediately rather than waiting for the first poll: a tap that
        // produces nothing visible for six seconds gets tapped again.
        setJobStatus("queued");
        setQuota((q) => (q ? { ...q, remaining: claim.remaining, dailyLeft: claim.dailyLeft } : q));
      } else {
        setRefusal(claim.refusal);
        setQuota((q) => (q ? { ...q, remaining: claim.refusal.remaining } : q));
      }
    } catch (e) {
      // parseClaimResult throws on a shape it does not recognise rather than
      // guessing. A migration ahead of this bundle must not read as success.
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }, [plan_.seconds, plan_.shots.length, prompt]);

  const blocked = refusal ?? localBlock;
  const canGenerate = !submitting && !loadingQuota && blocked === null && prompt.trim().length >= 8;

  return (
    <div className="pb-4">
      {/* Play's AI-Generated Content policy needs the label AND an in-app way
          to report the output. `stories_ai_output` is declared in
          config/playCompliance.ts; the guard test fails until it is. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-3 py-2">
        <span className="text-[11px] font-semibold text-amber-300">
          AI-generated video 🤖 — {AI_OUTPUT_LABEL}
        </span>
        <AiOutputReport surface="stories_ai_output" targetId="stories-studio" />
      </div>

      <label htmlFor="story-prompt" className="mt-4 block text-xs font-semibold text-foreground">
        What happens in your story?
      </label>
      <textarea
        id="story-prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        maxLength={2000}
        placeholder="A girl finds a door in the roots of a banyan tree, and the city on the other side is made of paper lanterns…"
        className="mt-1.5 w-full resize-none rounded-2xl border border-border bg-card/70 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none"
      />
      {prompt.trim().length === 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((sug) => (
            <button
              key={sug}
              type="button"
              onClick={() => setPrompt(sug)}
              className="rounded-full border border-border bg-card/70 px-2.5 py-1 text-left text-[11px] text-muted-foreground"
            >
              {sug}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-1 text-right text-[10px] text-muted-foreground">
        {prompt.trim().length < 8 ? "a few more words" : `${prompt.length}/2000`}
      </div>

      <div className="mt-3 text-xs font-semibold text-foreground">How long?</div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {PRESETS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSeconds(s)}
            aria-pressed={seconds === s}
            className={
              "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors " +
              (seconds === s
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card/70 text-muted-foreground")
            }
          >
            {s < 60 ? `${s}s` : `${s / 60} min`}
          </button>
        ))}
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        {plan_.seconds}s · {plan_.shots.length} shots
      </div>

      {/*
        THE DISCLAIMER SITS ABOVE THE BUTTON, not below it and not behind a
        link. Everything in it is something a user would be angry to discover
        afterwards, which is the test for whether copy belongs before an action.
      */}
      <div className="mt-4 rounded-2xl border border-border bg-card/50 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <ShieldAlert className="h-3.5 w-3.5" /> before you generate
        </div>
        <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <li>
            <span className="font-semibold text-foreground">Save it or lose it.</span> Your video
            goes to your device once, then it is deleted from our servers.{" "}
            <span className="font-semibold text-foreground">There is no re-download.</span>
          </li>
          <li>
            <span className="font-semibold text-foreground">Your story is yours.</span> ONIQ is not
            responsible for what you make. Share it anywhere you like.
          </li>
          <li>
            Share it back <span className="font-semibold text-foreground">through ONIQ</span> and it
            gets checked like any other upload.
          </li>
        </ul>
      </div>

      <button
        type="button"
        onClick={() => void generate()}
        disabled={!canGenerate}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        {submitting ? "Starting…" : "Generate"}
      </button>

      {blocked ? (
        <p className="mt-2 text-center text-[11px] text-amber-300">{blocked.message}</p>
      ) : null}
      {error ? <p className="mt-2 text-center text-[11px] text-destructive">{error}</p> : null}

      {/* THE WAIT IS PART OF THE PRODUCT. A render is minutes long, so the
          screen names the step it is on; an unchanging spinner across four
          minutes is indistinguishable from a hang. */}
      {jobId && jobStatus && !SETTLED.has(jobStatus) ? (
        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-border bg-card/70 px-3 py-2.5">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <div className="text-[11px] text-muted-foreground">
            {PROGRESS[jobStatus] ?? "Working…"}
            <span className="mt-0.5 block text-[10px] opacity-70">
              You can leave this screen — it keeps going.
            </span>
          </div>
        </div>
      ) : null}

      {filmUrl ? (
        <div className="mt-3 rounded-2xl border border-border bg-card/70 p-3">
          <video
            src={filmUrl}
            controls
            playsInline
            className="w-full rounded-xl bg-black"
            // Portrait, like everything else the pipeline makes.
            style={{ aspectRatio: "9 / 16", maxHeight: "60vh" }}
          />
          <button
            type="button"
            onClick={() => void saveToDevice()}
            disabled={saving}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {saving ? "Saving…" : "Save to my device"}
          </button>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            Saving deletes it from our servers. Watch it first — there is no re-download.
          </p>
        </div>
      ) : null}

      {saved ? (
        <div className="mt-3 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2.5 text-[11px] text-emerald-300">
          Saved to your device, and deleted from ours. It is yours now.
        </div>
      ) : null}

      {jobError ? (
        <p className="mt-2 text-center text-[11px] text-destructive">{jobError}</p>
      ) : null}

      {quota && !loadingQuota ? (
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          {quota.remaining}s of free Story time left · {quota.dailyLeft}s today
        </p>
      ) : null}
    </div>
  );
}

export const STORY_STUDIO_ICON = Clapperboard;
