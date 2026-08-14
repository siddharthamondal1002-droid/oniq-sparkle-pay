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
import {
  MAX_CAST_PER_FILM,
  MAX_LOCK,
  MAX_NAME,
  deleteCastMember,
  listCast,
  saveCastMember,
  type CastMember,
} from "@/lib/castLibrary";
import { Link } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { Clapperboard, Clock, Loader2, ShieldAlert, Sparkles, Users2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";
import { openInApp } from "@/lib/miniapps";
import { packNarrations, verbatimFits } from "@/lib/verbatimNarration";
import {
  DEFAULT_STORY_SECONDS,
  MAX_STORY_SECONDS,
  MIN_STORY_SECONDS,
  checkStoryQuota,
  parseClaimResult,
  planStory,
  type QuotaRefusal,
} from "@/lib/storyPlan";
import { checkoutTarget } from "@/lib/storyPricing";
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
  paidSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  /** Whether Story time is for sale at all, on any surface. */
  purchaseEnabled: boolean;
  /** Whether THIS build, if native, may link out to the web checkout. */
  nativeLinkOut: boolean;
  /** Where that link goes. A config row, validated again in checkoutTarget. */
  checkoutUrl: string | null;
  /**
   * The claim's owner branch. Today it also gates the movie-grade toggle:
   * movie is admin-only until purchased seconds learn grades, and a toggle
   * the server would refuse must not be drawn.
   */
  admin: boolean;
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
    paidSeconds: num("paidSeconds", 0),
    minSeconds: num("minSeconds", MIN_STORY_SECONDS),
    maxSeconds: num("maxSeconds", MAX_STORY_SECONDS),
    // Absent fields read as "not for sale" — a bundle newer than the migration
    // must not invent a buy button the server would refuse.
    purchaseEnabled: p.purchaseEnabled === true,
    nativeLinkOut: p.nativeLinkOut === true,
    checkoutUrl: typeof p.checkoutUrl === "string" ? p.checkoutUrl : null,
    admin: p.admin === true,
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
  // The cast library: saved characters, and which of them ride into THIS film.
  const [cast, setCast] = useState<CastMember[]>(() => listCast());
  const [pickedCast, setPickedCast] = useState<Set<string>>(new Set());
  // Movie grade: every shot's still handed to Veo for real motion, the ep3
  // pipeline per user film. The toggle renders for admins only (see
  // QuotaStatus.admin); the server refuses it for anyone else either way.
  const [grade, setGrade] = useState<"classic" | "movie">("classic");
  // Verbatim mode (owner directive, 2026-08-14): the prompt is a finished
  // story, narrated word for word — sliced by the worker, never retold by
  // Ting. The toggle only arms when the text's spoken length fits the
  // purchased seconds; the claim RPC re-checks the same band server-side.
  const [verbatim, setVerbatim] = useState(false);
  const [newCastName, setNewCastName] = useState("");
  const [newCastLock, setNewCastLock] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: rpcError } = await supabase.rpc("story_quota_status");
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
   * Re-read the balance when the app comes back to the foreground. The one
   * moment this matters is the return from the web checkout — the purchase
   * happened in a browser this webview never saw, and without this the screen
   * would keep refusing until a full restart.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void supabase.rpc("story_quota_status").then(({ data, error: rpcError }) => {
        if (!rpcError) setQuota(readQuota(data));
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
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
          const { data } = await supabase.rpc("story_quota_status");
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

  // Does the typed text FIT the picked tier as spoken narration, AND can
  // it actually be SLICED into that tier's shots? The review panel proved
  // the band alone charges money for unpackable stories (three giant
  // sentences fit sixty seconds by word count and still cannot fill nine
  // shots) — so the packer runs here, before any debit, and the toggle
  // explains which gate refused. EVERY HOOK ABOVE EVERY EARLY RETURN.
  const verbatimFit = useMemo(() => {
    const fit = verbatimFits(prompt, plan_.seconds);
    if (!fit.fits) return fit;
    if (packNarrations(prompt.trim(), plan_.shots.length) === null) {
      return {
        fits: false,
        spokenSeconds: fit.spokenSeconds,
        reason: `needs at least ${plan_.shots.length} sentences — one per shot`,
      };
    }
    return fit;
  }, [prompt, plan_]);
  useEffect(() => {
    // Text edits can un-fit an armed toggle; disarm rather than let the
    // claim refuse later with a colder message.
    if (verbatim && !verbatimFit.fits) setVerbatim(false);
  }, [verbatim, verbatimFit.fits]);

  /**
   * The local read of whether this request can go. Advisory only — it exists so
   * the button can explain itself without a round trip. It now delegates to
   * `checkStoryQuota`, the SAME pure function the schema test pins to the SQL,
   * so the paid-bucket arithmetic (free first, paid ignores the daily cap)
   * exists in exactly one place. The status payload already did the free/used
   * subtraction, so it is handed over as "this much free, none used".
   */
  const localBlock = useMemo<QuotaRefusal | null>(() => {
    if (!quota) return null;
    return checkStoryQuota(
      {
        enabled: quota.enabled,
        freeSeconds: quota.remaining,
        usedSeconds: 0,
        paidSeconds: quota.paidSeconds,
        dailyUsedSeconds: 0,
        dailySeconds: quota.dailyLeft,
        // The product-wide ceiling is invisible from here; the claim is what
        // answers it, under its row lock.
        globalDailyUsedSeconds: 0,
      },
      plan_.seconds,
    );
  }, [quota, plan_.seconds]);

  const generate = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    setRefusal(null);
    // A second Story starts from a clean screen. Leaving the previous film's
    // "Saved" note up next to a new job reads as if the new one is already done.
    setJobError(null);
    setJobStatus(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("claim_story_seconds", {
        _requested_seconds: plan_.seconds,
        _prompt: prompt.trim(),
        // Sent only when chosen: an older database without the parameter keeps
        // answering the two-argument shape it knows.
        ...(grade === "movie" ? { _grade: "movie" } : {}),
        ...(verbatim ? { _verbatim: true } : {}),
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      const claim = parseClaimResult(data);
      if (claim.ok) {
        // Attach the chosen characters BEFORE anything else — the dispatch
        // cron can claim the job within a minute, and set_story_cast refuses
        // once it leaves `queued`. Fire-and-forget: losing the race means the
        // film renders without reuse, which is a film, not a failure.
        const picked = cast.filter((m) => pickedCast.has(m.id)).slice(0, MAX_CAST_PER_FILM);
        if (picked.length > 0) {
          void supabase
            .rpc(
              "set_story_cast" as never,
              {
                _job_id: claim.jobId,
                _cast: picked.map((m) => ({ name: m.name, lock: m.lock })),
              } as never,
            )
            .then(() => {});
        }
        setJobId(claim.jobId);
        // Named immediately rather than waiting for the first poll: a tap that
        // produces nothing visible for six seconds gets tapped again.
        setJobStatus("queued");
        setQuota((q) =>
          q
            ? {
                ...q,
                remaining: claim.remaining,
                dailyLeft: claim.dailyLeft,
                paidSeconds: claim.paidSeconds,
              }
            : q,
        );
      } else {
        setRefusal(claim.refusal);
        setQuota((q) =>
          q
            ? {
                ...q,
                remaining: claim.refusal.remaining,
                paidSeconds: claim.refusal.paidSeconds ?? q.paidSeconds,
              }
            : q,
        );
      }
    } catch (e) {
      // parseClaimResult throws on a shape it does not recognise rather than
      // guessing. A migration ahead of this bundle must not read as success.
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }, [plan_.seconds, plan_.shots.length, prompt, grade, verbatim, cast, pickedCast]);

  const blocked = refusal ?? localBlock;
  const canGenerate = !submitting && !loadingQuota && blocked === null && prompt.trim().length >= 8;

  /**
   * Where — if anywhere — to offer more time. `checkoutTarget` is the Play
   * policy line: web buys in-page at /pay/story, native either links out to
   * the system browser or (when `story_purchase_config.native_link_out` is
   * off) says NOTHING about buying — the reader-app posture, and the reason a
   * disabled button is not an option here.
   */
  const buyTarget = useMemo(
    () =>
      quota
        ? checkoutTarget(
            {
              purchaseEnabled: quota.purchaseEnabled,
              nativeLinkOut: quota.nativeLinkOut,
              checkoutUrl: quota.checkoutUrl,
            },
            Capacitor.isNativePlatform(),
          )
        : ({ kind: "none" } as const),
    [quota],
  );
  // Offered only against the refusals more time would actually fix — never for
  // "disabled" or "capacity", where a purchase would change nothing today.
  const offerBuy =
    buyTarget.kind !== "none" &&
    blocked !== null &&
    (blocked.reason === "exhausted" || blocked.reason === "daily" || blocked.reason === "too-long");

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

      {/* MOVIE GRADE — the in-house engine (owner launch, 2026-08-13): the
          owned cinematography stack, rendered on ONIQ's own worker. Open to
          everyone; the server accepts either grade. */}
      <button
        type="button"
        aria-pressed={grade === "movie"}
        onClick={() => setGrade((g) => (g === "movie" ? "classic" : "movie"))}
        className={
          "mt-3 flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left " +
          (grade === "movie" ? "border-primary bg-primary/10" : "border-border bg-card/50")
        }
      >
        <span>
          <span className="block text-xs font-semibold text-foreground">🎬 Movie grade</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            The cinematic cut — depth the camera moves through, characters who speak their
            lines, the film look. Made end to end by ONIQ&apos;s own engine.
          </span>
        </span>
        <span
          className={
            "ms-3 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold " +
            (grade === "movie"
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground")
          }
        >
          {grade === "movie" ? "on" : "off"}
        </span>
      </button>

      {/* MY WORDS — verbatim mode (owner directive, 2026-08-14). The typed
          text is a finished story, narrated exactly as written: the worker
          slices it into shot narrations and Ting designs only the pictures.
          Arms only when the text's spoken length fits the picked tier; the
          claim re-checks the same band server-side, so this gate is honest
          twice. */}
      <button
        type="button"
        aria-pressed={verbatim}
        disabled={!verbatimFit.fits}
        onClick={() => setVerbatim((v) => !v)}
        className={
          "mt-2 flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left " +
          (verbatim
            ? "border-primary bg-primary/10"
            : "border-border bg-card/50" + (verbatimFit.fits ? "" : " opacity-60"))
        }
      >
        <span>
          <span className="block text-xs font-semibold text-foreground">📜 My words</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {verbatimFit.fits
              ? `Narrated exactly as written — no retelling. Reads as ~${Math.round(verbatimFit.spokenSeconds)}s of speech.`
              : prompt.trim().length >= 8
                ? `Needs a full story that fits ${plan_.seconds}s: yours ${verbatimFit.reason ?? "does not fit"}.`
                : "Paste a full story and it will be narrated exactly as written."}
          </span>
        </span>
        <span
          className={
            "ms-3 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold " +
            (verbatim
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground")
          }
        >
          {verbatim ? "on" : "off"}
        </span>
      </button>

      {/* YOUR CHARACTERS — the cast library. Saved people the user can put in
          any film. Toggled chips ride into this job as `reuse`; the planner
          keeps their locks verbatim, so the same character stays the same
          person film after film. Design characters anywhere (Adobe Firefly is
          the house authoring tool) — the DESCRIPTION is what the pipeline
          consumes. */}
      <div className="mt-4 rounded-2xl border border-border bg-card/50 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Users2 className="h-3.5 w-3.5" /> your characters
        </div>
        {cast.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {cast.map((m) => {
              const on = pickedCast.has(m.id);
              return (
                <span key={m.id} className="inline-flex items-center">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setPickedCast((cur) => {
                        const next = new Set(cur);
                        if (next.has(m.id)) next.delete(m.id);
                        else if (next.size < MAX_CAST_PER_FILM) next.add(m.id);
                        return next;
                      })
                    }
                    title={m.lock}
                    className={`rounded-s-full border py-1 ps-3 pe-2 text-[11px] font-semibold normal-case tracking-normal ${
                      on
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {m.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${m.name}`}
                    onClick={() => {
                      deleteCastMember(m.id);
                      setCast(listCast());
                      setPickedCast((cur) => {
                        const next = new Set(cur);
                        next.delete(m.id);
                        return next;
                      });
                    }}
                    className={`rounded-e-full border border-s-0 py-1 ps-1.5 pe-2 ${
                      on ? "border-primary text-primary" : "border-border text-muted-foreground"
                    }`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <div className="mt-2 grid gap-1.5">
          <input
            value={newCastName}
            onChange={(e) => setNewCastName(e.target.value)}
            maxLength={MAX_NAME}
            placeholder="Character name — e.g. Meera"
            className="w-full rounded-xl border border-border bg-card/70 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none"
          />
          <textarea
            value={newCastLock}
            onChange={(e) => setNewCastLock(e.target.value)}
            maxLength={MAX_LOCK}
            rows={2}
            placeholder="Exact look, repeated in every frame — age, build, hair, clothing, colours. e.g. a nine-year-old girl, small and quick, black hair in two braids, red scarf over a mustard kurta"
            className="w-full resize-none rounded-xl border border-border bg-card/70 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            disabled={!newCastName.trim() || !newCastLock.trim()}
            onClick={() => {
              const saved = saveCastMember(newCastName, newCastLock);
              if (saved) {
                setCast(listCast());
                setPickedCast((cur) => {
                  const next = new Set(cur);
                  if (next.size < MAX_CAST_PER_FILM) next.add(saved.id);
                  return next;
                });
                setNewCastName("");
                setNewCastLock("");
              }
            }}
            className="justify-self-start rounded-xl border border-primary/50 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary disabled:opacity-40"
          >
            Save character
          </button>
        </div>
        {pickedCast.size > 0 && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            {pickedCast.size} character{pickedCast.size === 1 ? "" : "s"} will appear in this film,
            looking the same as in your last one.
          </p>
        )}
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
      {offerBuy && buyTarget.kind === "in-page" ? (
        <Link
          to="/pay/story"
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-4 py-2.5 text-xs font-semibold text-primary"
        >
          <Clock className="h-4 w-4" /> Get more Story time
        </Link>
      ) : null}
      {offerBuy && buyTarget.kind === "link-out" ? (
        // The system browser, not this webview — the whole point. The balance
        // refreshes on the visibilitychange that firing this causes.
        <button
          type="button"
          onClick={() => void openInApp(buyTarget.url)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-4 py-2.5 text-xs font-semibold text-primary"
        >
          <Clock className="h-4 w-4" /> Get more Story time
        </button>
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

      {quota && !loadingQuota ? (
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          {quota.remaining}s of free Story time left · {quota.dailyLeft}s today
          {quota.paidSeconds > 0 ? ` · ${quota.paidSeconds}s purchased` : null}
        </p>
      ) : null}
    </div>
  );
}

export const STORY_STUDIO_ICON = Clapperboard;
