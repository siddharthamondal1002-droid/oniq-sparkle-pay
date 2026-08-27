/**
 * VideoClips — the USER-FACING half of ONIQ's in-house video generation.
 *
 * Owner directive 2026-08-27 ("make video production live for users"): the
 * in-house path that passed its production proof — one ~4s clip with optional
 * voice-over, generated end to end on ONIQ's own rented GPU — becomes a normal
 * user surface. Every call goes through the gpu-video EDGE FUNCTION, the same
 * transport the production proof ran on; the server re-derives the caller,
 * scopes rows and signed URLs to their own jobs, and keeps every financial
 * gate (kill switch, daily cap, live-quote admission, per-job cap, one at a
 * time, idempotency) exactly where it was. Nothing here can name a GPU,
 * provider, model, budget or bucket path — the server refuses unknown fields.
 *
 * THE BOUNDARY IS THE PRODUCT PROMISE: writing a story, saving it, keeping a
 * character and drawing a portrait never generate video. Only the explicit
 * "Generate video" button below submits a generation, and a source-pinning
 * test holds this file to exactly that one call surface. Nothing retries by
 * itself: a failure is shown with its reason, and "Try again" only re-arms
 * the form with a fresh key for another explicit press.
 *
 * The clip opens on a reference frame ONIQ has staged server-side (the same
 * proven frame the production canary used); the user's words drive what
 * happens in it. Engine and infrastructure names stay out of the copy — this
 * is ONIQ's own studio, presented as such.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Film } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  MAX_PROMPT_CHARS,
  NARRATION_MAX_CHARS,
  NARRATION_MAX_WORDS,
  STAGED_REFERENCES,
  TERMINAL_STATUSES,
  UI_LABELS,
  VIDEO_CLOCK_SECONDS,
  narrationWordCount,
  type JobStatus,
} from "@/lib/gpuVideoFlow";
import {
  readVideoTimeStatus,
  sayVideoTime,
  totalRemainingMs,
  type VideoTimeStatus,
} from "@/lib/videoPricing";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";

/** A shot handed over from the story plan — prefill only, never a submission. */
export type ClipSeed = { prompt: string; narration: string; label: string };

type ClipJob = {
  id: string;
  status: JobStatus;
  prompt: string;
  stored_path: string | null;
  video_seconds: number | null;
  error: string | null;
  created_at: string;
  audio_mode: "off" | "narration" | null;
  narration_text: string | null;
  audio_error: string | null;
};

type StatusPayload = {
  jobs: ClipJob[];
  enabled: boolean;
  configured: boolean;
  audioEnabled?: boolean;
};

/** One transport for every call; the server's own message survives to the UI. */
async function callGpuVideo<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("gpu-video", { body });
  if (error) {
    let message = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const parsed = (await ctx.json()) as { error?: string };
        if (parsed?.error) message = parsed.error;
      } catch {
        // the transport error message stands
      }
    }
    throw new Error(message || "request failed");
  }
  return data as T;
}

function freshKey(): string {
  return crypto.randomUUID();
}

type VideoClipsProps = {
  /** A story shot loaded into the form by an explicit tap upstream. */
  seed: ClipSeed | null;
};

export function VideoClips({ seed }: VideoClipsProps) {
  const [promptText, setPromptText] = useState("");
  const [voiceOn, setVoiceOn] = useState(false);
  const [narrationText, setNarrationText] = useState("");
  // One key per user gesture: minted when the form is (re)armed, spent on
  // submit. A double-tap, refresh retry or network retry re-sends the SAME
  // key and gets the same job back instead of renting a second GPU.
  const [idempotencyKey, setIdempotencyKey] = useState(freshKey);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [seedNote, setSeedNote] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [timeStatus, setTimeStatus] = useState<VideoTimeStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Record<string, string>>({});
  const lastSeed = useRef<ClipSeed | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await callGpuVideo<StatusPayload>({ action: "status" });
      setStatus(s);
      setStatusError(null);
    } catch (e) {
      setStatusError((e as Error).message);
    }
    // The finished-video-time balance — the customer's unit, never a GPU
    // number. Read fresh alongside jobs so a settlement shows up promptly.
    const { data: time, error: timeError } = await supabase.rpc("video_time_status" as never);
    if (!timeError) setTimeStatus(readVideoTimeStatus(time));
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Adopt a handed-over shot: prefill only. The narration rides along when it
  // fits the clip's ~4s clock; otherwise voice stays off and the note says
  // exactly what would make it speakable. Generation still needs the button.
  useEffect(() => {
    if (!seed || seed === lastSeed.current) return;
    lastSeed.current = seed;
    setPromptText(seed.prompt.slice(0, MAX_PROMPT_CHARS));
    const line = seed.narration.trim();
    const fits =
      line.length > 0 &&
      line.length <= NARRATION_MAX_CHARS &&
      narrationWordCount(line) <= NARRATION_MAX_WORDS;
    setVoiceOn(fits);
    setNarrationText(fits ? line : "");
    setSeedNote(
      fits
        ? `${seed.label} is loaded — press Generate video when you are ready.`
        : `${seed.label} is loaded. Its narration is longer than a ~4-second clip can speak, so voice-over is off — write a line of ${NARRATION_MAX_WORDS} words or fewer to add voice.`,
    );
    setMessage(null);
    setIdempotencyKey(freshKey());
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [seed]);

  const jobs = status?.jobs ?? [];
  const hasLive = jobs.some((j) => !TERMINAL_STATUSES.has(j.status));

  // Smallest safe status delivery: poll the provider then re-read rows,
  // every 5s, only while something of the user's is actually in flight.
  useEffect(() => {
    if (!hasLive) return;
    const t = setInterval(() => {
      callGpuVideo({ action: "poll" })
        .then(() => refreshStatus())
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [hasLive, refreshStatus]);

  const doneJobs = useMemo(
    () => jobs.filter((j) => j.status === "completed" && j.stored_path),
    [jobs],
  );
  useEffect(() => {
    for (const j of doneJobs) {
      if (j.stored_path && !playback[j.id]) {
        callGpuVideo<{ url: string | null }>({ action: "sign", path: j.stored_path })
          .then((r) => {
            if (r.url) setPlayback((p) => ({ ...p, [j.id]: r.url as string }));
          })
          .catch(() => undefined);
      }
    }
  }, [doneJobs, playback]);

  const voiceAvailable = status?.audioEnabled === true;
  const audioMode = voiceOn && voiceAvailable ? "narration" : "off";
  // The reference frame is server-registered; the client only ever names an
  // id from that registry — never a path, never a file.
  const referenceId = Object.keys(STAGED_REFERENCES)[0] ?? "";

  const submit = useCallback(async () => {
    setSubmitting(true);
    setMessage(null);
    try {
      const r = await callGpuVideo<{ id: string; status: JobStatus; reused: boolean }>({
        action: "submit",
        request: {
          prompt: promptText,
          referenceId,
          idempotencyKey,
          audio: audioMode,
          ...(audioMode === "narration" ? { narrationText } : {}),
        },
      });
      setMessage(r.reused ? "Already running — showing the existing clip." : "Generating…");
      setSeedNote(null);
      // Arm the NEXT gesture with its own key; the submitted one stays bound
      // to this job so any transport-level retry of it maps to the same row.
      if (!r.reused) setIdempotencyKey(freshKey());
      await refreshStatus();
    } catch (e) {
      setMessage((e as Error).message || "The server refused that one without a reason.");
    } finally {
      setSubmitting(false);
    }
  }, [promptText, referenceId, idempotencyKey, audioMode, narrationText, refreshStatus]);

  const promptOk = promptText.trim().length > 0 && promptText.length <= MAX_PROMPT_CHARS;
  const narrationWords = narrationWordCount(narrationText);
  const narrationOk =
    audioMode === "off" ||
    (narrationText.trim().length > 0 &&
      narrationText.length <= NARRATION_MAX_CHARS &&
      narrationWords <= NARRATION_MAX_WORDS);
  // One clip spends its full clock from the balance; the server re-checks
  // and is the authority — this only saves a doomed round trip.
  const clipCostMs = Math.ceil(VIDEO_CLOCK_SECONDS * 1000);
  const outOfTime =
    timeStatus !== null && !timeStatus.admin && totalRemainingMs(timeStatus) < clipCostMs;
  const generateDisabled =
    submitting ||
    !promptOk ||
    !narrationOk ||
    !referenceId ||
    hasLive ||
    outOfTime ||
    status?.enabled === false;

  return (
    <div ref={rootRef} className="mt-4 rounded-2xl border border-border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Film className="h-3.5 w-3.5" /> video clips — made by ONIQ
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        A real video clip of about 4 seconds, with optional voice-over, generated end to end in
        ONIQ&apos;s own studio. It opens on ONIQ&apos;s reference frame and your words decide what
        happens in it.
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">
          Writing stories, keeping characters and drawing portraits never generate video.
        </span>{" "}
        Only the Generate video button below does, and it makes exactly one clip per press.
      </p>
      <p className="mt-1 text-[11px]">AI-generated video 🤖 — {AI_OUTPUT_LABEL}</p>
      <AiOutputReport surface="gpu_video_ai_output" targetId="gpu-video-clips" />

      {statusError && (
        <p role="alert" className="mt-2 text-[11px] text-destructive">
          Could not check the studio: {statusError}
        </p>
      )}
      {status && !status.enabled && (
        <p role="alert" className="mt-2 text-[11px] text-amber-300">
          Video clips are switched off right now.
        </p>
      )}
      {timeStatus && !timeStatus.admin && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground">
            {sayVideoTime(totalRemainingMs(timeStatus))}
          </span>{" "}
          of video time left
          {timeStatus.trialRemainingMs > 0 &&
            timeStatus.planRemainingMs === 0 &&
            timeStatus.paidMs === 0 &&
            " — your free minute"}
          . Only finished video counts; a failed clip costs nothing.
        </p>
      )}
      {outOfTime && (
        <p className="mt-1 text-[11px] text-amber-300">
          {timeStatus?.salesEnabled
            ? "You are out of video time — add more below."
            : "Your free video minute is used up. Plans and top-ups open soon."}
        </p>
      )}

      <label className="mt-2 block text-[11px] font-semibold text-foreground">
        What happens in the clip
        <textarea
          rows={3}
          maxLength={MAX_PROMPT_CHARS}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="The character slowly turns toward the camera and smiles; gentle push-in."
          className="mt-1 block w-full resize-none rounded-xl border border-border bg-card/70 px-3 py-2 text-xs font-normal text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none"
        />
      </label>
      {seedNote && <p className="mt-1 text-[11px] text-primary">{seedNote}</p>}

      <button
        type="button"
        aria-pressed={voiceOn && voiceAvailable}
        disabled={!voiceAvailable}
        onClick={() => setVoiceOn((v) => !v)}
        className={
          "mt-2 flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left " +
          (voiceOn && voiceAvailable
            ? "border-primary bg-primary/10"
            : "border-border bg-card/50") +
          (voiceAvailable ? "" : " opacity-60")
        }
      >
        <span className="text-[11px] font-semibold text-foreground">
          🔊 Voice-over
          <span className="mt-0.5 block font-normal text-muted-foreground">
            {voiceAvailable
              ? "A spoken line, in ONIQ's own voice, inside the clip."
              : "Not available right now."}
          </span>
        </span>
        <span
          className={
            "ms-3 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold " +
            (voiceOn && voiceAvailable
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground")
          }
        >
          {voiceOn && voiceAvailable ? "on" : "off"}
        </span>
      </button>
      {voiceOn && voiceAvailable && (
        <label className="mt-2 block text-[11px] font-semibold text-foreground">
          The spoken line (it must fit inside the ~4s clip)
          <textarea
            rows={2}
            maxLength={NARRATION_MAX_CHARS}
            value={narrationText}
            onChange={(e) => setNarrationText(e.target.value)}
            placeholder="She turns to face the light."
            className="mt-1 block w-full resize-none rounded-xl border border-border bg-card/70 px-3 py-2 text-xs font-normal text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none"
          />
          <span
            className={
              "font-normal " +
              (narrationWords > NARRATION_MAX_WORDS ? "text-destructive" : "text-muted-foreground")
            }
          >
            {narrationWords}/{NARRATION_MAX_WORDS} words
            {narrationWords > NARRATION_MAX_WORDS && " — too long to fit the clip"}
          </span>
        </label>
      )}

      <button
        type="button"
        disabled={generateDisabled}
        onClick={() => void submit()}
        className="mt-3 rounded-xl border border-primary/50 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary disabled:opacity-40"
      >
        {submitting ? "Submitting…" : hasLive ? "A clip is being made…" : "Generate video"}
      </button>
      {message && (
        <p role="status" className="mt-1.5 text-[11px] text-muted-foreground">
          {message}
        </p>
      )}

      {jobs.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            your clips
          </div>
          <ul className="mt-1 grid grid-cols-1 gap-1.5">
            {jobs.map((j) => (
              <li key={j.id} className="min-w-0 rounded-lg border border-border p-1.5">
                <div className="text-[11px]">
                  <span className="font-semibold text-foreground">
                    {UI_LABELS[j.status] ?? j.status}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {new Date(j.created_at).toLocaleTimeString()} · “{j.prompt.slice(0, 60)}
                    {j.prompt.length > 60 ? "…" : ""}”
                  </span>
                  {j.status === "completed" && j.audio_mode === "narration" && !j.audio_error && (
                    <span className="text-muted-foreground"> · voiced 🔊</span>
                  )}
                </div>
                {j.status === "completed" && j.audio_mode === "narration" && j.audio_error && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    The voice could not be added, so this clip is silent.
                  </p>
                )}
                {j.status === "completed" &&
                  (playback[j.id] ? (
                    <video
                      src={playback[j.id]}
                      controls
                      preload="metadata"
                      className="mt-1 w-full max-w-[352px] rounded-lg"
                    />
                  ) : (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Preparing player…</p>
                  ))}
                {(j.status === "failed" ||
                  j.status === "timed-out" ||
                  j.status === "cancelled") && (
                  <p className="mt-0.5 text-[11px]">
                    <span className="text-destructive">
                      That clip could not be made{j.error ? ` (${j.error})` : ""}.
                    </span>{" "}
                    <button
                      type="button"
                      className="font-semibold text-primary underline"
                      onClick={() => {
                        // Explicit retry only: a NEW key, the same words, and
                        // another deliberate press. Nothing retries by itself.
                        setPromptText(j.prompt);
                        setVoiceOn(j.audio_mode === "narration");
                        setNarrationText(j.narration_text ?? "");
                        setIdempotencyKey(freshKey());
                        setSeedNote(null);
                        setMessage("Ready to try again — press Generate video.");
                      }}
                    >
                      Try again
                    </button>
                  </p>
                )}
                {j.status === "orphaned" && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    This one needs ONIQ&apos;s attention; new clips are paused for a moment.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
