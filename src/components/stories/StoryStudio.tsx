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
import { Clapperboard, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";
import {
  DEFAULT_STORY_SECONDS,
  MAX_STORY_SECONDS,
  MIN_STORY_SECONDS,
  checkStoryQuota,
  parseClaimResult,
  planStory,
  type QuotaRefusal,
} from "@/lib/storyPlan";
import { type PurchaseConfig, buyStorySeconds } from "@/lib/storyCheckout";
import { priceFor } from "@/lib/storyPricing";
import { moneyIn } from "@/lib/format";
import { PROGRESS, SETTLED, latestOpenJob, readJobRow } from "./storyJobsClient";

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

/**
 * THE FILM ITSELF IS NOT SHOWN HERE. It lives under "Your videos".
 *
 * A render outlives this screen: six minutes is long enough to lock a phone,
 * and the first film ONIQ ever made was lost because the only pointer to it
 * was a useState in this form. The studio starts a Story and reports progress;
 * the library is where films are watched and saved. Both read the same helpers
 * so the two screens cannot disagree about what a status means.
 */

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
  /** Purchased seconds still unspent. Not capped daily; see claim_story_seconds. */
  paidSeconds: number;
  purchaseEnabled: boolean;
  nativeLinkOut: boolean;
  checkoutUrl: string | null;
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
    paidSeconds: num("paidSeconds", 0),
    // DEFAULT FALSE, all three. An older deployment of story_quota_status
    // returns none of these, and the safe reading of a missing answer is "do
    // not offer to take money" rather than "assume selling is fine".
    purchaseEnabled: p.purchaseEnabled === true,
    nativeLinkOut: p.nativeLinkOut === true,
    checkoutUrl: typeof p.checkoutUrl === "string" ? p.checkoutUrl : null,
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
  const [buying, setBuying] = useState(false);
  const [handedOff, setHandedOff] = useState(false);

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
   * Pick up a Story already in flight.
   *
   * The library is where films are collected, but the studio should not
   * pretend nothing is happening either: come back mid-render and the progress
   * line should still be here. RLS scopes this to the caller, so "the newest
   * open job" can only ever mean their own.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const row = await latestOpenJob();
      if (cancelled || !row?.id) return;
      setJobId(row.id);
      setJobStatus(row.status);
      if (row.error) setJobError(row.error);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const plan_ = useMemo(() => planStory(seconds), [seconds]);

  /**
   * The local read of whether this request can go. Advisory only — it exists so
   * the button can explain itself without a round trip.
   *
   * THIS USED TO BE A SECOND IMPLEMENTATION of checkStoryQuota, open-coded here
   * with the same four branches in the same order. It was correct when written
   * and stopped being correct the moment seconds became purchasable: it had no
   * concept of a paid bucket, so it would have told somebody who had just
   * bought five minutes that they were out of time, and disabled the button
   * over it. Calling the real thing is the fix — one implementation cannot
   * disagree with itself.
   */
  const localBlock = useMemo<QuotaRefusal | null>(() => {
    if (!quota) return null;
    return checkStoryQuota(
      {
        enabled: quota.enabled,
        freeSeconds: quota.freeSeconds,
        usedSeconds: quota.usedSeconds,
        paidSeconds: quota.paidSeconds,
        // The RPC hands back what is LEFT today rather than the cap and the
        // spend, because that is all a screen needs. Encoding it as a cap with
        // nothing spent is exact — `dailySeconds - dailyUsedSeconds` gives the
        // same number back.
        dailySeconds: quota.dailyLeft,
        dailyUsedSeconds: 0,
        // The product-wide ceiling is deliberately NOT exposed to clients, so
        // the capacity branch cannot fire here. The server owns that refusal,
        // which is right: a user cannot act on it anyway.
      },
      plan_.seconds,
    );
  }, [quota, plan_.seconds]);

  /** Where a purchase would be allowed to happen, from the config row. */
  const purchaseCfg = useMemo<PurchaseConfig>(
    () => ({
      purchaseEnabled: quota?.purchaseEnabled ?? false,
      nativeLinkOut: quota?.nativeLinkOut ?? false,
      checkoutUrl: quota?.checkoutUrl ?? null,
    }),
    [quota],
  );

  /**
   * Offer to sell more time only when running out is what actually blocked
   * this. A buy button next to "Story generation is paused" would be taking
   * money for something switched off.
   */
  const offerTopUp =
    purchaseCfg.purchaseEnabled &&
    (localBlock?.reason === "exhausted" || localBlock?.reason === "too-long");

  const topUpTier = useMemo(() => priceFor(plan_.seconds), [plan_.seconds]);

  const buyTime = useCallback(async () => {
    if (!topUpTier) return;
    setBuying(true);
    setError(null);
    try {
      const result = await buyStorySeconds({ seconds: topUpTier.seconds, cfg: purchaseCfg });
      if (result.status === "paid") {
        const { data } = await callStoryRpc("story_quota_status");
        setQuota(readQuota(data));
      } else if (result.status === "handed-off") {
        // NOT AN ERROR. The browser is open and the purchase continues there —
        // this is the whole design, so it reads as an instruction rather than a
        // failure. The balance is re-read when the app comes back.
        setHandedOff(true);
      } else if (result.status === "failed") {
        setError(result.message);
      }
    } finally {
      setBuying(false);
    }
  }, [topUpTier, purchaseCfg]);

  /**
   * Re-read the balance when the app returns to the foreground.
   *
   * The native path finishes in a browser, so the seconds arrive while this
   * screen is not being looked at. Without this the user comes back to a stale
   * "0s left" and a disabled button, having just paid.
   */
  useEffect(() => {
    if (!handedOff) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void (async () => {
        const { data } = await callStoryRpc("story_quota_status");
        setQuota(readQuota(data));
      })();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [handedOff]);

  const generate = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    setRefusal(null);
    // A second Story starts from a clean screen. Leaving the previous film's
    // "Saved" note up next to a new job reads as if the new one is already done.
    setJobError(null);
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
              You can close the app. It lands under{" "}
              <span className="font-semibold text-foreground">Your videos</span> when it is done.
            </span>
          </div>
        </div>
      ) : null}

      {jobId && jobStatus && (jobStatus === "ready" || jobStatus === "delivering") ? (
        <div className="mt-3 rounded-2xl border border-primary/40 bg-primary/10 px-3 py-2.5 text-[11px] text-foreground">
          Your film is ready — open the <span className="font-semibold">Your videos</span> tab to
          watch and save it.
        </div>
      ) : null}

      {jobError ? (
        <p className="mt-2 text-center text-[11px] text-destructive">{jobError}</p>
      ) : null}

      {/*
        BUYING MORE TIME. Offered only when running out is what blocked this —
        never next to "generation is paused", which would be selling access to
        something switched off.

        THE BUTTON DOES NOT CHARGE ON NATIVE. buyStorySeconds routes on the
        platform: in a browser it opens Checkout here, in the app it opens
        oniqhub.com and returns `handed-off`. A Story is digital content
        consumed in the app and Google Play requires Play Billing for that, so
        the app never collects. `nativeLinkOut` is a config row — with it off
        this whole block disappears on native and the website keeps selling.
      */}
      {offerTopUp && topUpTier ? (
        <div className="mt-3 rounded-2xl border border-border/60 bg-muted/30 px-3 py-2.5 text-[11px]">
          {handedOff ? (
            <p className="text-center text-muted-foreground">
              Finish your purchase in the browser — your Story time appears here once it is done.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">
                {topUpTier.label} of Story time ·{" "}
                <span className="font-semibold text-foreground">
                  {moneyIn(topUpTier.pricePaise / 100, "INR")}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void buyTime()}
                disabled={buying}
                className="shrink-0 rounded-full bg-primary px-3 py-1 font-semibold text-primary-foreground disabled:opacity-60"
              >
                {buying ? "Opening…" : "Buy time"}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {quota && !loadingQuota ? (
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          {quota.paidSeconds > 0 ? `${quota.paidSeconds}s bought · ` : ""}
          {quota.remaining}s of free Story time left · {quota.dailyLeft}s today
        </p>
      ) : null}
    </div>
  );
}

export const STORY_STUDIO_ICON = Clapperboard;
