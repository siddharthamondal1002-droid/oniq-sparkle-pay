// ADMIN-ONLY tool: in-house GPU video generation (owner directive
// 2026-08-26 — the PRIMARY video path: LTX-Video 2B on a RunPod-serverless
// RTX 3090). Deliberately unstyled, like the Runway tool beside it.
//
// The screen is not the gate. Every call is refused server-side for a
// non-admin, gpu_video_jobs RLS is admin-only, and nothing here can name a
// GPU, provider, model, budget or bucket path — the server refuses unknown
// fields rather than ignoring them.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  gpuVideoDiag,
  gpuVideoPoll,
  gpuVideoSign,
  gpuVideoStatus,
  gpuVideoSubmit,
} from "@/lib/gpuVideo.functions";
import {
  LAUNCH,
  MAX_PROMPT_CHARS,
  STAGED_REFERENCES,
  TERMINAL_STATUSES,
  UI_LABELS,
  type JobStatus,
} from "@/lib/gpuVideoFlow";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";

export const Route = createFileRoute("/_authenticated/app/admin/gpu-video")({
  head: () => ({
    meta: [
      { title: "Generate video (in-house GPU)" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: GpuVideoTool,
});

function freshKey(): string {
  return crypto.randomUUID();
}

function GpuVideoTool() {
  const qc = useQueryClient();
  const status = useServerFn(gpuVideoStatus);
  const submit = useServerFn(gpuVideoSubmit);
  const poll = useServerFn(gpuVideoPoll);
  const sign = useServerFn(gpuVideoSign);
  const diag = useServerFn(gpuVideoDiag);

  const referenceIds = Object.keys(STAGED_REFERENCES);
  const [referenceId, setReferenceId] = useState(referenceIds[0] ?? "");
  const [promptText, setPromptText] = useState("");
  // One key per user gesture: minted when the form is (re)armed, spent on
  // submit. A double-click, refresh retry or network retry re-sends the SAME
  // key and gets the same job back instead of renting a second GPU.
  const [idempotencyKey, setIdempotencyKey] = useState(freshKey);
  const [message, setMessage] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Record<string, string>>({});

  const statusQuery = useQuery({
    queryKey: ["gpu-video-status"],
    queryFn: () => status({ data: undefined }),
    retry: false,
  });
  // Production has no readable server logs, so when the status call fails
  // the wiring check below is the only way to see WHICH link broke.
  const diagQuery = useQuery({
    queryKey: ["gpu-video-diag"],
    queryFn: () => diag({ data: undefined }),
    retry: false,
    enabled: statusQuery.isError,
  });
  const jobs = statusQuery.data?.jobs ?? [];
  const hasLive = jobs.some((j) => !TERMINAL_STATUSES.has(j.status as JobStatus));

  // Smallest safe status delivery: poll the provider then re-read rows,
  // every 5s, only while something is actually in flight.
  useEffect(() => {
    if (!hasLive) return;
    const t = setInterval(() => {
      poll({ data: undefined })
        .then(() => qc.invalidateQueries({ queryKey: ["gpu-video-status"] }))
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [hasLive, poll, qc]);

  const submitMutation = useMutation({
    mutationFn: () => submit({ data: { prompt: promptText, referenceId, idempotencyKey } }),
    onSuccess: (r) => {
      setMessage(r.reused ? "Already running — showing the existing job." : null);
      // Arm the NEXT gesture with its own key; the submitted one stays bound
      // to this job so any transport-level retry of it maps to the same row.
      if (!r.reused) setIdempotencyKey(freshKey());
      qc.invalidateQueries({ queryKey: ["gpu-video-status"] });
    },
    onError: (e) =>
      setMessage((e as Error).message || "The server rejected the call without a reason."),
  });

  const promptOk = promptText.trim().length > 0 && promptText.length <= MAX_PROMPT_CHARS;
  const generateDisabled = submitMutation.isPending || !promptOk || !referenceId || hasLive;

  const doneJobs = useMemo(
    () => jobs.filter((j) => j.status === "completed" && j.stored_path),
    [jobs],
  );
  useEffect(() => {
    for (const j of doneJobs) {
      if (j.stored_path && !playback[j.id]) {
        sign({ data: { path: j.stored_path } })
          .then((url) => {
            if (url) setPlayback((p) => ({ ...p, [j.id]: url }));
          })
          .catch(() => undefined);
      }
    }
  }, [doneJobs, playback, sign]);

  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <h1>Generate video — in-house GPU</h1>
      <p>
        {LAUNCH.model} on {LAUNCH.gpu} · {LAUNCH.limits.width}×{LAUNCH.limits.height} ·{" "}
        {LAUNCH.limits.fps}fps · one job at a time
      </p>
      <p>AI-generated video 🤖 — {AI_OUTPUT_LABEL}</p>
      <AiOutputReport surface="gpu_video_ai_output" targetId="gpu-video-tool" />

      {statusQuery.isError && (
        <div role="alert">
          <p>
            Status check failed:{" "}
            {(statusQuery.error as Error)?.message || "the server returned an unnamed error"}
          </p>
          {diagQuery.data && (
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {[
                "Server wiring check (names and booleans only):",
                ...Object.entries(diagQuery.data.env).map(
                  ([name, present]) => `  ${name}: ${present ? "present" : "MISSING"}`,
                ),
                `  admin flag for this account: ${String(diagQuery.data.isAdmin)}`,
                `  admin database client: ${diagQuery.data.adminClient}`,
                `  gpu_video_jobs table: ${diagQuery.data.table}`,
              ].join("\n")}
            </pre>
          )}
          {diagQuery.isError && (
            <p>
              The wiring check itself also failed (
              {(diagQuery.error as Error)?.message || "unnamed error"}) — the break is before the
              server code runs: auth, routing, or an old cached build. Try a hard reload.
            </p>
          )}
        </div>
      )}
      {statusQuery.data && !statusQuery.data.configured && (
        <p role="alert">
          Not configured on this server yet: RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID and
          R2_PUBLIC_BASE_URL must be set in the server environment (owner action). Submissions will
          be refused until then.
        </p>
      )}
      {statusQuery.data && !statusQuery.data.enabled && (
        <p role="alert">Video generation is switched off (kill switch).</p>
      )}

      <h2>New generation</h2>
      <label>
        Reference image{" "}
        <select value={referenceId} onChange={(e) => setReferenceId(e.target.value)}>
          {referenceIds.map((id) => (
            <option key={id} value={id}>
              {STAGED_REFERENCES[id].label}
            </option>
          ))}
        </select>
      </label>
      <br />
      <label>
        Motion prompt (what moves — your scene, your words)
        <br />
        <textarea
          rows={4}
          cols={70}
          maxLength={MAX_PROMPT_CHARS}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="The character slowly turns toward the camera and smiles; gentle push-in."
        />
      </label>
      <br />
      <button type="button" disabled={generateDisabled} onClick={() => submitMutation.mutate()}>
        {submitMutation.isPending
          ? "Submitting…"
          : hasLive
            ? "A job is running…"
            : "Generate video"}
      </button>
      {message && <p role="status">{message}</p>}

      <h2>Jobs</h2>
      {statusQuery.isLoading && <p>Loading…</p>}
      {!statusQuery.isLoading && jobs.length === 0 && <p>No generations yet.</p>}
      <ul>
        {jobs.map((j) => (
          <li key={j.id} style={{ marginBottom: 12 }}>
            <strong>{UI_LABELS[j.status as JobStatus] ?? j.status}</strong>{" "}
            <span>
              {new Date(j.created_at).toLocaleTimeString()} · “{j.prompt.slice(0, 60)}
              {j.prompt.length > 60 ? "…" : ""}”
            </span>
            {j.status === "completed" && (
              <>
                {" "}
                · {j.video_seconds ?? "?"}s
                {j.actual_cost_usd !== null && <> · ${Number(j.actual_cost_usd).toFixed(2)}</>}
                {playback[j.id] ? (
                  <div>
                    <video
                      src={playback[j.id]}
                      controls
                      preload="metadata"
                      width={352}
                      height={240}
                    />
                  </div>
                ) : (
                  <div>Preparing player…</div>
                )}
              </>
            )}
            {(j.status === "failed" || j.status === "timed-out" || j.status === "cancelled") && (
              <>
                {" "}
                — <span>{j.error ?? "failed"}</span>{" "}
                <button
                  type="button"
                  onClick={() => {
                    // Explicit retry only: a NEW idempotency key, the same
                    // words. Nothing retries by itself.
                    setPromptText(j.prompt);
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
