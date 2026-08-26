// The in-house GPU video tool, INLINE in the moderation inbox.
//
// This panel exists because the standalone route version failed on the
// owner's device three times without a trace (2026-08-26): SPA navigation to
// it did nothing, a plain anchor did nothing, and its TanStack server-fn
// POSTs never reached the server. The two mechanisms proven working on that
// same device are the inbox's section chips and supabase-js calls — Stories
// runs on them daily — so this panel is a chip, and every call goes through
// the gpu-video EDGE FUNCTION via supabase.functions.invoke.
//
// The panel is not the gate. The edge function re-derives the caller,
// requires is_admin, and refuses unknown fields server-side; gpu_video_jobs
// RLS is admin-only. Nothing here can name a GPU, provider, model, budget or
// bucket path.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  LAUNCH,
  MAX_PROMPT_CHARS,
  NARRATION_MAX_CHARS,
  NARRATION_MAX_WORDS,
  STAGED_REFERENCES,
  TERMINAL_STATUSES,
  UI_LABELS,
  narrationWordCount,
  type AudioMode,
  type JobStatus,
} from "@/lib/gpuVideoFlow";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";

type GpuJobRow = {
  id: string;
  status: JobStatus;
  prompt: string;
  stored_path: string | null;
  video_seconds: number | null;
  actual_cost_usd: number | null;
  error: string | null;
  created_at: string;
  audio_mode: AudioMode | null;
  narration_text: string | null;
  audio_cost_usd: number | null;
  audio_error: string | null;
};

type StatusPayload = {
  jobs: GpuJobRow[];
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

export function GpuVideoPanel() {
  const referenceIds = Object.keys(STAGED_REFERENCES);
  const [referenceId, setReferenceId] = useState(referenceIds[0] ?? "");
  const [promptText, setPromptText] = useState("");
  const [audioMode, setAudioMode] = useState<AudioMode>("off");
  const [narrationText, setNarrationText] = useState("");
  // One key per user gesture: minted when the form is (re)armed, spent on
  // submit. A double-click, refresh retry or network retry re-sends the SAME
  // key and gets the same job back instead of renting a second GPU.
  const [idempotencyKey, setIdempotencyKey] = useState(freshKey);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Record<string, string>>({});

  const refreshStatus = useCallback(async () => {
    try {
      const s = await callGpuVideo<StatusPayload>({ action: "status" });
      setStatus(s);
      setStatusError(null);
    } catch (e) {
      setStatusError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const jobs = status?.jobs ?? [];
  const hasLive = jobs.some((j) => !TERMINAL_STATUSES.has(j.status));

  // Smallest safe status delivery: poll the provider then re-read rows,
  // every 5s, only while something is actually in flight.
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
      setMessage(r.reused ? "Already running — showing the existing job." : "Submitted.");
      // Arm the NEXT gesture with its own key; the submitted one stays bound
      // to this job so any transport-level retry of it maps to the same row.
      if (!r.reused) setIdempotencyKey(freshKey());
      await refreshStatus();
    } catch (e) {
      setMessage((e as Error).message || "The server rejected the call without a reason.");
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
  const generateDisabled = submitting || !promptOk || !narrationOk || !referenceId || hasLive;

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm">
      <div className="font-display text-lg font-semibold">Generate video — in-house GPU</div>
      <p className="mt-1 text-xs text-muted-foreground">
        {LAUNCH.model} on {LAUNCH.gpu} · {LAUNCH.limits.width}×{LAUNCH.limits.height} ·{" "}
        {LAUNCH.limits.fps}fps · one job at a time
      </p>
      <p className="mt-1 text-xs">AI-generated video 🤖 — {AI_OUTPUT_LABEL}</p>
      <AiOutputReport surface="gpu_video_ai_output" targetId="gpu-video-tool" />

      {statusError && (
        <p role="alert" className="mt-2 text-xs text-red-500">
          Status check failed: {statusError}
        </p>
      )}
      {status && !status.configured && (
        <p role="alert" className="mt-2 text-xs text-red-500">
          Not configured on this server yet: RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID and
          R2_PUBLIC_BASE_URL must be set in the backend environment (owner action).
        </p>
      )}
      {status && !status.enabled && (
        <p role="alert" className="mt-2 text-xs text-red-500">
          Video generation is switched off (kill switch).
        </p>
      )}

      <div className="mt-3">
        <label className="block text-xs font-semibold">
          Reference image
          <select
            value={referenceId}
            onChange={(e) => setReferenceId(e.target.value)}
            className="mt-1 block w-full rounded-xl border border-border bg-background p-2"
          >
            {referenceIds.map((id) => (
              <option key={id} value={id}>
                {STAGED_REFERENCES[id].label}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-xs font-semibold">
          Motion prompt (what moves — your scene, your words)
          <textarea
            rows={4}
            maxLength={MAX_PROMPT_CHARS}
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="The character slowly turns toward the camera and smiles; gentle push-in."
            className="mt-1 block w-full rounded-xl border border-border bg-background p-2"
          />
        </label>
        {!promptOk && promptText.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Type a motion prompt to switch the button on.
          </p>
        )}
        <label className="mt-3 block text-xs font-semibold">
          Voice-over
          <select
            value={audioMode}
            onChange={(e) => setAudioMode(e.target.value === "narration" ? "narration" : "off")}
            disabled={status ? status.audioEnabled !== true : false}
            className="mt-1 block w-full rounded-xl border border-border bg-background p-2 disabled:opacity-50"
          >
            <option value="off">Off — silent video</option>
            <option value="narration">Narration (in-house voice)</option>
          </select>
        </label>
        {status && status.audioEnabled !== true && (
          <p className="mt-1 text-xs text-muted-foreground">
            Voice-over is not enabled yet (owner switch).
          </p>
        )}
        {audioMode === "narration" && (
          <label className="mt-3 block text-xs font-semibold">
            Narration line (spoken over the clip — it must fit inside the ~4s video)
            <textarea
              rows={2}
              maxLength={NARRATION_MAX_CHARS}
              value={narrationText}
              onChange={(e) => setNarrationText(e.target.value)}
              placeholder="He turns to face the light."
              className="mt-1 block w-full rounded-xl border border-border bg-background p-2"
            />
            <span
              className={
                narrationWords > NARRATION_MAX_WORDS ? "text-red-500" : "text-muted-foreground"
              }
            >
              {narrationWords}/{NARRATION_MAX_WORDS} words
              {narrationWords > NARRATION_MAX_WORDS &&
                " — too long to fit the clip even at the fastest measured speech rate"}
            </span>
          </label>
        )}
        <button
          type="button"
          disabled={generateDisabled}
          onClick={() => void submit()}
          className="mt-3 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {submitting ? "Submitting…" : hasLive ? "A job is running…" : "Generate video"}
        </button>
        {message && (
          <p role="status" className="mt-2 text-xs">
            {message}
          </p>
        )}
      </div>

      <div className="mt-4 font-semibold">Jobs</div>
      {!status && !statusError && <p className="text-xs text-muted-foreground">Loading…</p>}
      {status && jobs.length === 0 && (
        <p className="text-xs text-muted-foreground">No generations yet.</p>
      )}
      <ul className="mt-1 space-y-3">
        {jobs.map((j) => (
          <li key={j.id} className="text-xs">
            <span className="font-semibold">{UI_LABELS[j.status] ?? j.status}</span>{" "}
            <span className="text-muted-foreground">
              {new Date(j.created_at).toLocaleTimeString()} · “{j.prompt.slice(0, 60)}
              {j.prompt.length > 60 ? "…" : ""}”
            </span>
            {j.status === "completed" && (
              <>
                {" "}
                · {j.video_seconds ?? "?"}s
                {j.audio_mode === "narration" && !j.audio_error && <> · voiced 🔊</>}
                {j.actual_cost_usd !== null && (
                  <> · ${(Number(j.actual_cost_usd) + Number(j.audio_cost_usd ?? 0)).toFixed(2)}</>
                )}
                {j.audio_mode === "narration" && j.audio_error && (
                  <>
                    {" "}
                    · <span className="text-red-500">voice failed — delivered silent</span>{" "}
                    <span className="text-muted-foreground">({j.audio_error})</span>
                  </>
                )}
                {playback[j.id] ? (
                  <div className="mt-1">
                    <video
                      src={playback[j.id]}
                      controls
                      preload="metadata"
                      width={352}
                      height={240}
                    />
                  </div>
                ) : (
                  <div className="text-muted-foreground">Preparing player…</div>
                )}
              </>
            )}
            {(j.status === "failed" || j.status === "timed-out" || j.status === "cancelled") && (
              <>
                {" "}
                — <span className="text-red-500">{j.error ?? "failed"}</span>{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    // Explicit retry only: a NEW idempotency key, the same
                    // words. Nothing retries by itself.
                    setPromptText(j.prompt);
                    setAudioMode(j.audio_mode === "narration" ? "narration" : "off");
                    setNarrationText(j.narration_text ?? "");
                    setIdempotencyKey(freshKey());
                    setMessage("Ready to retry — press Generate video.");
                  }}
                >
                  Retry
                </button>
              </>
            )}
            {j.status === "orphaned" && (
              <> — needs operator attention (see the financial ledger); new jobs are paused.</>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
