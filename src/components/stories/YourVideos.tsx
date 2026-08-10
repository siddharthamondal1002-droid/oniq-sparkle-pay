/**
 * Your videos — where a finished Story actually lives.
 *
 * WHY THIS IS A TAB AND NOT PART OF THE STUDIO. A Story takes minutes: about
 * 4.5 minutes of render per minute of film, plus generation. The first one ONIQ
 * ever made rendered perfectly, uploaded, reached `ready` — and was unreachable,
 * because the only pointer to it was a useState in the form that started it.
 * Six minutes is long enough to lock a phone. Anything that outlives the screen
 * that started it needs somewhere of its own to be found.
 *
 * NOTHING IS OPENED AUTOMATICALLY. Tapping Watch moves a job `ready ->
 * delivering`, and doing that to every finished film on mount would start a
 * transfer nobody asked for on all of them at once. The user says which one.
 *
 * PURGED AND DELIVERED FILMS ARE NOT LISTED. Both mean the bytes are gone —
 * `delivered` is the successful ending — and offering a play button for nothing
 * is worse than an empty list.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clapperboard, Download, Loader2, Play } from "lucide-react";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";
import {
  PROGRESS,
  SETTLED,
  type StoryJobRow,
  isWatchable,
  listStories,
  openStory,
  releaseStory,
  saveStoryToDevice,
} from "./storyJobsClient";

/** Six seconds. The step being waited on takes minutes; faster only adds load. */
const POLL_MS = 6000;

function whenLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function YourVideos() {
  // EVERY HOOK ABOVE EVERY EARLY RETURN. rules-of-hooks is a release blocker in
  // this repo. There are no early returns below, and there must not be.
  const [rows, setRows] = useState<StoryJobRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filmUrl, setFilmUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await listStories());
    } catch {
      setError("Could not load your videos.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll only while something is actually moving. A settled list is a static
  // list, and polling it forever is load with no answer attached.
  const inFlight = useMemo(
    () => (rows ?? []).some((r) => !SETTLED.has(r.status)),
    [rows],
  );
  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [inFlight, refresh]);

  const watch = useCallback(async (jobId: string) => {
    setBusy(true);
    setError(null);
    try {
      const url = await openStory(jobId);
      setOpenId(jobId);
      setFilmUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that film.");
    } finally {
      setBusy(false);
    }
  }, []);

  const save = useCallback(async () => {
    if (!openId || !filmUrl) return;
    setBusy(true);
    setError(null);
    try {
      await saveStoryToDevice(openId, filmUrl);
      setSaved(openId);
      setOpenId(null);
      setFilmUrl(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that file.");
      // Hand it back so a dropped connection does not cost somebody their film.
      await releaseStory(openId);
      setOpenId(null);
      setFilmUrl(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [openId, filmUrl, refresh]);

  return (
    <div className="pb-4">
      {/* Same labelling rule as every other generative surface: the label AND
          an in-app way to report the output. Declared as `stories_ai_output`
          in config/playCompliance.ts. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-3 py-2">
        <span className="text-[11px] font-semibold text-amber-300">
          AI-generated video 🤖 — {AI_OUTPUT_LABEL}
        </span>
        <AiOutputReport surface="stories_library_output" targetId="stories-library" />
      </div>

      {saved ? (
        <div className="mt-3 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2.5 text-[11px] text-emerald-300">
          Saved to your device, and deleted from ours. It is yours now.
        </div>
      ) : null}
      {error ? <p className="mt-3 text-center text-[11px] text-destructive">{error}</p> : null}

      {filmUrl ? (
        <div className="mt-3 rounded-2xl border border-primary/40 bg-card/70 p-3">
          <video
            src={filmUrl}
            controls
            autoPlay
            playsInline
            className="w-full rounded-xl bg-black"
            style={{ aspectRatio: "9 / 16", maxHeight: "60vh" }}
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {busy ? "Saving…" : "Save to my device"}
          </button>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            Saving deletes it from our servers. Watch it first — there is no re-download.
          </p>
        </div>
      ) : null}

      {rows === null ? (
        <p className="mt-6 text-center text-[11px] text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-border bg-card/50 p-5 text-center">
          <Clapperboard className="mx-auto h-6 w-6 text-muted-foreground/60" />
          <p className="mt-2 text-xs font-semibold text-foreground">No videos yet</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Make one in <span className="font-semibold text-foreground">Make a Story</span>. It
            lands here when it is done, even if you close the app.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {rows.map((r) => {
            const watchable = isWatchable(r.status);
            const failed = r.status === "failed";
            return (
              <li
                key={r.id}
                className="rounded-2xl border border-border bg-card/70 p-3"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground">
                      {r.prompt?.trim() || "Untitled story"}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {r.requested_seconds ? `${r.requested_seconds}s` : "—"}
                      {r.shot_count ? ` · ${r.shot_count} shots` : ""} · {whenLabel(r.created_at)}
                    </p>
                  </div>
                  {watchable ? (
                    <button
                      type="button"
                      onClick={() => void watch(r.id)}
                      disabled={busy}
                      className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" /> Watch
                    </button>
                  ) : null}
                </div>

                {!watchable && !failed ? (
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                    {PROGRESS[r.status] ?? "Working…"}
                  </div>
                ) : null}

                {failed ? (
                  <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{r.error || "That one could not be made. Your time was returned."}</span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
