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

  const plan = useMemo(() => planStory(seconds), [seconds]);

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
    if (plan.seconds > quota.dailyLeft) {
      return {
        reason: "daily",
        message: refusalMessage("daily", {
          remaining: quota.remaining,
          dailyLeft: quota.dailyLeft,
          wanted: plan.seconds,
        }),
        remaining: quota.remaining,
      };
    }
    if (plan.seconds > quota.remaining) {
      return {
        reason: "too-long",
        message: refusalMessage("too-long", {
          remaining: quota.remaining,
          dailyLeft: quota.dailyLeft,
          wanted: plan.seconds,
        }),
        remaining: quota.remaining,
      };
    }
    return null;
  }, [quota, plan.seconds]);

  const generate = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    setRefusal(null);
    try {
      const { data, error: rpcError } = await callStoryRpc("claim_story_seconds", {
        _requested_seconds: plan.seconds,
        _prompt: prompt.trim(),
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      const claim = parseClaimResult(data);
      if (claim.ok) {
        setJobId(claim.jobId);
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
  }, [plan.seconds, prompt]);

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
        {plan.seconds}s · {plan.shots.length} shots
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

      {jobId ? (
        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-border bg-card/70 px-3 py-2.5">
          <Download className="h-4 w-4 text-primary" />
          <div className="text-[11px] text-muted-foreground">
            Queued. Your video will appear here to preview, then save to your device.
          </div>
        </div>
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
