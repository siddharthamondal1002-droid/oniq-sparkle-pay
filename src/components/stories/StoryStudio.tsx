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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Clapperboard,
  Clock,
  ImagePlus,
  Loader2,
  ShieldAlert,
  Sparkles,
  Users2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";
import { CharacterBuilder } from "@/components/stories/CharacterBuilder";
import { StoryWriter } from "@/components/stories/StoryWriter";
import { VideoClips, type ClipSeed } from "@/components/stories/VideoClips";
import { VideoPlans } from "@/components/stories/VideoPlans";
import { openInApp } from "@/lib/miniapps";
import { MAX_PROMPT_CHARS, packNarrations, verbatimFits } from "@/lib/verbatimNarration";
import { FILM_LANGUAGES, type FilmLanguage } from "@/lib/storyLanguages";
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
import { PLATE_TYPES, checkPlate, uploadPlate } from "@/lib/storyPlate";
import { payForPlan } from "@/lib/razorpay";
import { PROGRESS, SETTLED, latestOpenJob, readJobRow } from "./storyJobsClient";
import { PlanSheet, sayLeft } from "./PlanSheet";
import { CinematicPanel } from "./CinematicPanel";
import { attachIntentToPrompt, type ShotIntent } from "@/lib/videoEngineering";
import { startVisiblePolling } from "@/lib/visiblePolling";

/**
 * Lengths offered as one tap. Anything between the bounds is still allowed.
 * 30s was withdrawn 2026-08-15 — a flat per-film cost is not recoverable by a
 * per-minute price, so it could not clear the 26% floor.
 */
const PRESETS = [60, 120, 300] as const;

/** The tier chips' own wording, reused wherever a tier is named in prose. */
function tierLabel(s: number): string {
  return s < 60 ? `${s}s` : `${s / 60} min`;
}

/**
 * Both verbatim gates against one tier: the spoken-length band first, then
 * the packer.
 *
 * Module-level and pure ON PURPOSE. The toggle has to ask this about the
 * PICKED tier and — when that refuses — about every other tier on offer,
 * because a refusal that names the length which WOULD work is a fix, while
 * one that only says "does not fit" is a dead end the user cannot act on.
 * Measured 2026-08-14: the owner pasted a 328-word story onto the 60s tier
 * (fill 2.19, refused) when the same text fits 2 min at 1.09, and the UI
 * never said so.
 */
function verbatimGate(
  prompt: string,
  seconds: number,
): { fits: boolean; spokenSeconds: number; reason: string | null } {
  const plan = planStory(seconds);
  const fit = verbatimFits(prompt, plan.seconds);
  if (!fit.fits) return fit;
  if (packNarrations(prompt.trim(), plan.shots.length) === null) {
    // The packer now CUTS long sentences to fill shots, so reaching here no
    // longer means "too few sentences" — it means the text cannot be divided
    // into this many pieces at all without shredding it into fragments too
    // short to narrate. Say that, rather than asking for a sentence count
    // the user would meet and still be refused.
    return {
      fits: false,
      spokenSeconds: fit.spokenSeconds,
      reason: `is too short to fill ${plan.shots.length} shots`,
    };
  }
  return fit;
}

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
   * The claim's owner branch — the account that rides free. It used to gate
   * the movie-grade toggle as well; that toggle is gone with classic
   * (2026-08-15), so this is about money now and nothing else.
   */
  admin: boolean;
  /**
   * THE PLAN HALF (owner directive, 2026-08-16 — monthly, not per-second).
   *
   * All optional-with-defaults on purpose. This bundle can be newer than the
   * migration or older than it, and a studio that renders "undefined minutes
   * left" because the server has not caught up is worse than one that quietly
   * falls back to the free plan's shape.
   */
  plan: string;
  planLabel: string;
  includedSeconds: number;
  renewsOn: string | null;
  cancelAtPeriodEnd: boolean;
  noWatermark: boolean;
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
    plan: typeof p.plan === "string" ? p.plan : "free",
    planLabel: typeof p.planLabel === "string" ? p.planLabel : "Free",
    includedSeconds: num("includedSeconds", num("freeSeconds", 0)),
    renewsOn: typeof p.renewsOn === "string" ? p.renewsOn : null,
    cancelAtPeriodEnd: p.cancelAtPeriodEnd === true,
    noWatermark: p.noWatermark === true,
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
  const [planOpen, setPlanOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<QuotaRefusal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  // The cast library: saved characters, and which of them ride into THIS film.
  const [cast, setCast] = useState<CastMember[]>(() => listCast());
  const [pickedCast, setPickedCast] = useState<Set<string>>(new Set());
  // A story shot handed to the video-clip panel — prefill only. The clip is
  // generated by that panel's own explicit press, never by this hand-off.
  const [clipSeed, setClipSeed] = useState<ClipSeed | null>(null);
  // NO GRADE STATE ANY MORE. Classic is withdrawn (owner directive,
  // 2026-08-15: "make classic inactive totally"), so movie is not a choice —
  // it is the only film ONIQ makes. The claim below sends it explicitly rather
  // than leaning on the server default, so this build says what it wants even
  // against a database that has not taken the migration yet.
  // Verbatim mode (owner directive, 2026-08-14): the prompt is a finished
  // story, narrated word for word — sliced by the worker, never retold by
  // Ting. The toggle only arms when the text's spoken length fits the
  // purchased seconds; the claim RPC re-checks the same band server-side.
  const [verbatim, setVerbatim] = useState(false);
  // The film's language (owner directive, 2026-09-03). English is the
  // in-house voice; every other language is the cloud voice, because no
  // in-house voice exists for it. The list is the set a voice exists for.
  const [language, setLanguage] = useState<FilmLanguage>("en");
  // Cinematic controls (engineering mode). Empty by default, which keeps the
  // outgoing request byte-for-byte what it was before the panel existed.
  // Excluded in verbatim mode: there the prompt IS the narration.
  const [shotIntent, setShotIntent] = useState<ShotIntent>({});
  const [newCastName, setNewCastName] = useState("");

  const [newCastLock, setNewCastLock] = useState("");
  // THE PLATE — one image the film opens on, in place of the still the
  // pipeline would have drawn for shot 1. Held as the File until the job
  // exists, because there is nothing to attach it to until then and an upload
  // for a film the user abandons is bytes nobody asked for.
  const [plate, setPlate] = useState<File | null>(null);
  const [platePreview, setPlatePreview] = useState<string | null>(null);
  const [plateError, setPlateError] = useState<string | null>(null);
  const plateInputRef = useRef<HTMLInputElement | null>(null);

  // An object URL is a live handle, not a string — dropped without revoking,
  // every picked image stays in memory for the tab's life.
  useEffect(() => {
    if (!plate) {
      setPlatePreview(null);
      return;
    }
    const url = URL.createObjectURL(plate);
    setPlatePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [plate]);

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
  // A derived boolean, not jobStatus itself: every intermediate transition
  // would otherwise tear the poller down and start a fresh immediate read.
  const isWatchingJob = !!jobId && !(jobStatus && SETTLED.has(jobStatus));
  useEffect(() => {
    if (!jobId || !isWatchingJob) return;
    let cancelled = false;
    const tick = async () => {
      const row = await readJobRow(jobId);
      if (cancelled || !row?.status) return true;
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
      // A settled job stops the timer here rather than waiting for the state
      // round trip to re-run this effect.
      return !SETTLED.has(row.status);
    };
    const stop = startVisiblePolling(tick, 6000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [jobId, isWatchingJob]);

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
  const verbatimFit = useMemo(() => verbatimGate(prompt, plan_.seconds), [prompt, plan_.seconds]);
  // Which offered length WOULD take this story? Smallest first, so the answer
  // is the cheapest tier that works, and never the one already picked. Null
  // when nothing on the menu fits — then the honest answer is the plain
  // refusal, not a tier that would refuse a second time.
  const verbatimTierFix = useMemo(() => {
    if (verbatimFit.fits || prompt.trim().length < 8) return null;
    for (const s of PRESETS) {
      if (s !== plan_.seconds && verbatimGate(prompt, s).fits) return s;
    }
    return null;
  }, [prompt, plan_.seconds, verbatimFit.fits]);
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
      // The cinematic intent rides the prompt itself — the one channel the
      // whole pipeline already reads (plan seed, palette, plot). Verbatim
      // excludes it (the prompt is the narration there), and the attach is
      // fail-closed: invalid picks or a full prompt send the user's words
      // untouched.
      const intentAttach = verbatim ? null : attachIntentToPrompt(prompt.trim(), shotIntent);
      const { data, error: rpcError } = await supabase.rpc("claim_story_seconds", {
        _requested_seconds: plan_.seconds,
        _prompt: intentAttach?.applied ? intentAttach.prompt : prompt.trim(),
        // Always movie. Classic is withdrawn, and naming the grade is what
        // makes an old database render the right thing too: its default is
        // still 'classic', so omitting this would quietly build the withdrawn
        // product.
        _grade: "movie",
        ...(verbatim ? { _verbatim: true } : {}),
        // Only when it is not English, so a database that predates the column
        // still claims an English film exactly as it always did.
        ...(language !== "en" ? { _language: language } : {}),
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
        // THE PLATE, uploaded only now. Before the claim there is no job to
        // attach it to, and a film the user abandons at the quota refusal
        // would have left an orphan image behind.
        //
        // NOT fire-and-forget, unlike the cast: the upload is a round trip
        // over mobile data, so awaiting it is what stops the dispatch cron
        // claiming the job first and rendering a film whose opening shot the
        // user watched themselves choose. A failure here is reported and the
        // film still runs — a story that opens on a drawn still is a story,
        // and refusing to render one over a failed upload would be worse.
        if (plate) {
          const up = await uploadPlate(plate);
          if (!up.ok) {
            setPlateError(
              `Your photo did not upload (${up.message}) — the film opens on a drawn frame instead.`,
            );
          } else {
            const { data: setRes } = await supabase.rpc(
              "set_story_plate" as never,
              { _job_id: claim.jobId, _path: up.path } as never,
            );
            const res = setRes as { ok?: boolean } | null;
            if (!res?.ok) {
              setPlateError(
                "Your photo did not reach this film in time — it opens on a drawn frame.",
              );
            }
          }
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
  }, [plan_.seconds, plan_.shots.length, prompt, verbatim, shotIntent, cast, pickedCast]);

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
        maxLength={MAX_PROMPT_CHARS}
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
        {prompt.trim().length < 8 ? "a few more words" : `${prompt.length}/${MAX_PROMPT_CHARS}`}
      </div>
      {/* THE BOX CUTS LONG PASTES SILENTLY, and that is worst precisely where
          the text is the product. `maxLength` makes the browser drop the
          overflow with no event and no message, so a pasted screenplay arrives
          here already beheaded — measured 2026-08-14: three of the owner's own
          jobs stored exactly 2000 characters, against the old cap. A counter
          reading "2000/2000"
          does not read as "your story was cut"; this does. */}
      {prompt.length >= MAX_PROMPT_CHARS ? (
        <p className="mt-1 text-[10px] text-amber-300">
          The box is full at {MAX_PROMPT_CHARS} characters — anything past that in a longer paste
          was cut. Only the text above gets narrated.
        </p>
      ) : null}
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
      {/* MOVIE GRADE — no longer a toggle (owner directive, 2026-08-15:
          "make classic inactive totally"). It was a switch while there were
          two products; with classic withdrawn there is one, so this states
          what the film will be rather than asking. A control whose only
          setting is "on" is a control that teaches people it does nothing. */}
      <div className="mt-3 flex w-full items-center justify-between rounded-2xl border border-primary bg-primary/10 px-3 py-2.5">
        <span>
          <span className="block text-xs font-semibold text-foreground">🎬 Movie grade</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            The cinematic cut — depth the camera moves through, characters who speak their lines,
            the film look. Made end to end by ONIQ&apos;s own engine.
          </span>
        </span>
        <span className="ms-3 shrink-0 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground">
          every film
        </span>
      </div>

      {/* ONE JOB ON SCREEN (owner directive, 2026-08-31: "this page is very
          confusing make everything automated not so many options").

          The studio had eleven stacked sections and TWO generate buttons — the
          film one at the bottom and the clip one two thirds of the way down —
          so the first question the page asked was "which of these am I even
          using". Everything below is still here and still one tap away; what
          changed is that the default view answers one question, describe a
          story and press Generate, and the rest is folded.

          NOTHING WAS DELETED AND NOTHING MOVED ROUTE. Folding is reversible in
          a way that deleting is not, and every one of these panels is somebody's
          workflow. `<details>` is the same native disclosure CinematicPanel
          already uses: no library, no state, no hook, so it cannot break the
          rules-of-hooks gate that is a release blocker here.

          WHAT STAYS OPEN IS DELIBERATE. The AI label and its report control are
          required by Play and are declared in config/playCompliance.ts; the
          length picker is what decides how much video time a press spends; and
          the "before you generate" notice has to be read BEFORE the button, not
          discovered after. None of those three may be folded. */}
      <details className="mt-3 rounded-2xl border border-border bg-card/50 px-3 py-2">
        <summary className="cursor-pointer select-none text-xs font-semibold text-foreground">
          More options
          <span className="ms-1 font-normal text-muted-foreground">
            (opening photo, look, your own words, cast)
          </span>
        </summary>
        <div className="mb-1">
          <CinematicPanel
            intent={shotIntent}
            onChange={setShotIntent}
            disabled={verbatim}
            promptText={prompt}
          />
          {/* THE PLATE. Sits under the prompt because it answers the same
          question — what the film opens on — and because that is where it was
          looked for and not found (2026-08-17).

          The input accepts IMAGES ONLY, and the copy says why rather than
          leaving "images only" to read as a limitation of the picker. Veo is
          image-to-video; there is no video-in path in the engine at all, so a
          video here could be stored and never used, which is the kind of
          control this codebase treats as a bug. checkPlate() still catches a
          video, because `accept` is a hint a file manager may ignore. */}
          <div className="mt-3">
            <div className="text-xs font-semibold text-foreground">Open on your own photo?</div>
            <input
              ref={plateInputRef}
              type="file"
              accept={PLATE_TYPES.join(",")}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                // Clear the input's own value so picking the SAME file twice after
                // a rejection still fires a change event.
                e.target.value = "";
                if (!f) return;
                const verdict = checkPlate(f);
                if (!verdict.ok) {
                  setPlate(null);
                  setPlateError(verdict.message);
                  return;
                }
                setPlateError(null);
                setPlate(f);
              }}
            />
            {plate && platePreview ? (
              <div className="mt-1.5 flex items-center gap-2 rounded-2xl border border-border bg-card/70 p-2">
                <img
                  src={platePreview}
                  alt="The frame your film will open on"
                  className="h-14 w-20 rounded-lg object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-foreground">{plate.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    the first shot starts here, then the film moves on
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPlate(null);
                    setPlateError(null);
                  }}
                  aria-label="Remove the opening photo"
                  className="press grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => plateInputRef.current?.click()}
                className="press mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-card/60 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground"
              >
                <ImagePlus className="h-3.5 w-3.5" /> add a photo
              </button>
            )}
            {plateError ? <p className="mt-1 text-[11px] text-amber-300">{plateError}</p> : null}
          </div>
          {/* FILM LANGUAGE (owner directive, 2026-09-03). Narration and dialogue
          in the picked language, spoken by the cloud voice; English keeps the
          in-house voice. Only languages a voice exists for are offered. */}
          <div className="mt-2 rounded-2xl border border-border bg-card/50 px-3 py-2.5">
            <span className="block text-xs font-semibold text-foreground">🗣️ Spoken in</span>
            <div
              className="mt-1.5 flex flex-wrap gap-1.5"
              role="radiogroup"
              aria-label="Film language"
            >
              {FILM_LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="radio"
                  aria-checked={language === l.code}
                  onClick={() => setLanguage(l.code)}
                  className={
                    "rounded-full border px-2.5 py-1 text-[11px] font-semibold " +
                    (language === l.code
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground")
                  }
                >
                  {l.native}
                </button>
              ))}
            </div>
          </div>
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
                    ? verbatimTierFix
                      ? `Reads as ~${Math.round(verbatimFit.spokenSeconds)}s of speech — ${verbatimFit.reason ?? "does not fit"} at ${tierLabel(plan_.seconds)}. It fits ${tierLabel(verbatimTierFix)}.`
                      : `Needs a full story that fits ${tierLabel(plan_.seconds)}: yours ${verbatimFit.reason ?? "does not fit"}.`
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
          {/* The one-tap way out of a refusal. Its own button rather than part of
          the toggle above, because a button inside a button is invalid and
          because the two do different things — this changes the LENGTH, which
          changes the price, so it must be a deliberate separate tap. */}
          {verbatimTierFix !== null ? (
            <button
              type="button"
              onClick={() => setSeconds(verbatimTierFix)}
              className="mt-1.5 w-full rounded-2xl border border-primary/50 bg-primary/10 px-3 py-2 text-[11px] font-semibold text-primary"
            >
              Switch to {tierLabel(verbatimTierFix)} so &ldquo;My words&rdquo; can take this story
            </button>
          ) : null}
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
                {pickedCast.size} character{pickedCast.size === 1 ? "" : "s"} will appear in this
                film, looking the same as in your last one.
              </p>
            )}
            {/* Portraits are a separate, explicit product: one tap, one image,
            stored as a reusable reference. Drawing never starts a film. */}
            <CharacterBuilder cast={cast} />
          </div>
        </div>
      </details>

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

      {/* THE PLAN STRIP. This line used to read "60s of free Story time left ·
          120s today", which is the whole pricing model expressed as two raw
          second counts and no way to act on either. It now names the plan,
          says what is left of the month in minutes, and opens the sheet — so
          the answer to "what am I on and what else is there" is one tap from
          the place people hit the limit. */}
      {quota && !loadingQuota ? (
        <button
          type="button"
          onClick={() => setPlanOpen(true)}
          className="mt-3 flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card/60 px-3.5 py-2.5 text-left"
        >
          <span className="min-w-0">
            <span className="block text-xs font-semibold">
              {quota.admin ? "Owner — everything included" : quota.planLabel}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {quota.admin
                ? "You ride free"
                : `${sayLeft(quota.remaining)} left this month${
                    quota.paidSeconds > 0 ? ` · ${sayLeft(quota.paidSeconds)} topped up` : ""
                  }`}
            </span>
          </span>
          <span className="shrink-0 text-[11px] font-semibold text-primary">
            {quota.plan === "free" ? "See plans" : "Manage"}
          </span>
        </button>
      ) : null}

      <PlanSheet
        open={planOpen}
        onClose={() => {
          setPlanOpen(false);
          // The plan may have changed under it — a cancel, or a return from
          // checkout. Re-read rather than trusting what was rendered.
          void supabase.rpc("story_quota_status").then(({ data, error: e }) => {
            if (!e) setQuota(readQuota(data));
          });
        }}
        currentPlan={quota?.plan ?? "free"}
        renewsOn={quota?.renewsOn ?? null}
        cancelAtPeriodEnd={quota?.cancelAtPeriodEnd ?? false}
        /**
         * THE SAME POLICY LINE THE TOP-UP BUTTON OBEYS. Web collects in page;
         * the native build links out to the website and never collects; a
         * build that may not link out offers nothing at all. `checkoutTarget`
         * already decided which of those this is — reusing it means the plan
         * CTA cannot drift from the seconds CTA on the one question Play
         * actually cares about.
         */
        onChoose={
          buyTarget.kind === "none"
            ? null
            : (p) => {
                if (buyTarget.kind === "link-out") {
                  void openInApp(buyTarget.url);
                  return;
                }
                setPlanOpen(false);
                void (async () => {
                  const r = await payForPlan({ planKey: p.key });
                  if (r.status === "paid") {
                    toast.success(`${p.label} is active`);
                  } else if (r.status === "failed") {
                    toast.error(r.message);
                  }
                  // Dismissed says nothing — the sheet just closed.
                  const { data, error: e } = await supabase.rpc("story_quota_status");
                  if (!e) setQuota(readQuota(data));
                })();
              }
        }
      />

      {/* THE LIBRARIES AND THE PRICE LIST SIT BELOW THE BUTTON, folded.
          Each is a real destination, not a step in making this film — saved
          stories, the separate 4-second clip studio, and the plan catalogue.
          Above the button they competed with it; here they are still one tap
          away and no longer in the way of the thing the page is for. */}
      <details className="mt-3 rounded-2xl border border-border bg-card/50 px-3 py-2">
        <summary className="cursor-pointer select-none text-xs font-semibold text-foreground">
          Your stories
          <span className="ms-1 font-normal text-muted-foreground">
            (write one first, without making the film)
          </span>
        </summary>
        <div className="mb-1">
          {/* STORY FIRST — generation without rendering (mega loop, 2026-08-27).
          Writes the structured story through story-plot and stops. Making the
          film remains this studio's own explicit, paid Generate tap. */}
          <StoryWriter
            prompt={prompt}
            seconds={plan_.seconds}
            shots={plan_.shots.length}
            reuse={cast
              .filter((m) => pickedCast.has(m.id))
              .slice(0, MAX_CAST_PER_FILM)
              .map((m) => ({ name: m.name, lock: m.lock }))}
            onUseDraft={(draftPrompt, draftSeconds) => {
              setPrompt(draftPrompt);
              setSeconds(draftSeconds);
              // The story panel sits far below the prompt on a phone; without
              // this the tap looks dead (owner report, 2026-08-27). Mirrors the
              // clip seed's scroll — loading a form, never generating.
              document
                .getElementById("story-prompt")
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
              toast.success("Story loaded — press Generate film when you are ready");
            }}
            onCastSaved={() => setCast(listCast())}
            onFilmShot={setClipSeed}
          />
        </div>
      </details>
      <details className="mt-3 rounded-2xl border border-border bg-card/50 px-3 py-2">
        <summary className="cursor-pointer select-none text-xs font-semibold text-foreground">
          Video clips
          <span className="ms-1 font-normal text-muted-foreground">
            (one ~4 second clip, its own separate Generate)
          </span>
        </summary>
        <div className="mb-1">
          {/* VIDEO CLIPS — the in-house generation path, user-facing (owner
          directive 2026-08-27). Its own explicit Generate press is the only
          thing that submits; a shot handed over above only fills the form. */}
          <VideoClips seed={clipSeed} />
        </div>
      </details>
      <details className="mt-3 rounded-2xl border border-border bg-card/50 px-3 py-2">
        <summary className="cursor-pointer select-none text-xs font-semibold text-foreground">
          Plans &amp; pricing
          <span className="ms-1 font-normal text-muted-foreground">
            (what your video time costs)
          </span>
        </summary>
        <div className="mb-1">
          {/* VIDEO TIME — the finished-video-time catalogue (owner directive
          2026-08-27). Display and explicit purchase only: nothing here can
          start a generation, and the server prices every purchase itself. */}
          <VideoPlans />
        </div>
      </details>
    </div>
  );
}

export const STORY_STUDIO_ICON = Clapperboard;
