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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Clapperboard,
  Download,
  Loader2,
  Play,
  Share2,
  Smartphone,
  Trash2,
} from "lucide-react";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";
import { lastShareDiagnostics, prepareVideoShare, shareReadyFile } from "@/lib/share";

/** What a finished share can say, from either step. */
type ShareOutcome = "shared" | "cancelled" | "download-started" | "failed" | "unsupported";

/**
 * WHICH film a prepared share belongs to.
 *
 * THE SURFACE IS NOT ENOUGH, and that was a real bug: with only a surface
 * name, preparing one saved film turned EVERY saved row's button into "Send
 * now", and tapping any of them sent the first film. A prepared file is bound
 * to one kind AND one id, and only that row may send it.
 */
type ShareSource = { kind: "film" | "saved"; id: string };

const sameSource = (a: ShareSource | undefined, b: ShareSource): boolean =>
  a?.kind === b.kind && a.id === b.id;

/** A fetched film waiting for its own tap, with the copy for however it ends. */
type ReadyShare = {
  file: File;
  source: ShareSource;
  surface: string;
  whenFailed: string;
  whenUnsupported: string;
};


const SHARE_PAYLOAD = {
  title: "My ONIQ Story",
  text: "Made with AI on ONIQ 🎬 oniqhub.com",
  url: "https://oniqhub.com",
};
import { reportClientError } from "@/lib/errorReport";
import { listSavedVideos, onSavedVideosChanged, type SavedVideo } from "@/lib/savedVideos";
import {
  PROGRESS,
  SETTLED,
  type StoryJobRow,
  deleteSavedVideo,
  deleteStoryJob,
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
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [sharePct, setSharePct] = useState<number | null>(null);
  const [shareHint, setShareHint] = useState<string | null>(null);
  // A file already fetched and waiting for its own tap. Holding it here is
  // what lets `navigator.share` run with nothing awaited in front of it.
  const [ready, setReady] = useState<ReadyShare | null>(null);
  // WHICH preparation is the current one. A fetch takes seconds, so a person
  // can start one film and tap another before it lands; without this the older
  // fetch would resolve last and arm the WRONG file. Every prepare takes a
  // ticket and only the newest ticket may set `ready`.
  const prepareSeq = useRef(0);
  // One send at a time. `sendNow` is deliberately not async, so two fast taps
  // would otherwise both reach the sheet with the same file.
  const sending = useRef(false);

  // Films already on this phone. Kept in local state because the server has
  // nothing left to list once a film is saved — saving purges it there.
  const [onDevice, setOnDevice] = useState<SavedVideo[]>([]);
  const [playing, setPlaying] = useState<SavedVideo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Server-side rows being deleted. Separate from `confirmDelete` (which
  // belongs to the on-phone list) because the two lists can both be open and a
  // shared id would arm the wrong confirmation.
  const [confirmJob, setConfirmJob] = useState<string | null>(null);
  const [deletingJob, setDeletingJob] = useState<string | null>(null);

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

  // Saved-to-device library. Re-reads on the change event so a save that
  // finishes while this screen is open shows up without a refresh.
  useEffect(() => {
    const sync = () => setOnDevice(listSavedVideos());
    sync();
    return onSavedVideosChanged(sync);
  }, []);

  /**
   * Delete a film, or a failed job, from ONIQ's side.
   *
   * OPTIMISTIC, because the row is gone the moment the RPC returns ok — it is
   * marked `purged` and listStories does not list purged. Waiting for a
   * refresh to make it disappear would leave a deleted film on screen for a
   * round trip, which reads as a delete that did not work.
   *
   * The film being watched is closed if it was the one deleted; leaving a
   * player open on bytes that are being removed is the one state worse than
   * a stale list.
   */
  const removeJob = useCallback(
    async (r: StoryJobRow) => {
      setDeletingJob(r.id);
      setError(null);
      try {
        const res = await deleteStoryJob(r.id);
        if (!res.ok) {
          setError(
            res.reason === "still-working"
              ? "That one is still being made — it can be deleted once it finishes."
              : "Could not delete that. Try again.",
          );
          return;
        }
        setRows((cur) => (cur ?? []).filter((x) => x.id !== r.id));
        setConfirmJob(null);
        if (openId === r.id) {
          setOpenId(null);
          setFilmUrl(null);
        }
      } finally {
        setDeletingJob(null);
      }
    },
    [openId],
  );

  const removeFromDevice = useCallback(async (v: SavedVideo) => {
    await deleteSavedVideo(v);
    setPlaying((cur) => (cur?.id === v.id ? null : cur));
    setConfirmDelete(null);
  }, []);

  /**
   * How a share ENDED, in one place, so the two buttons cannot drift apart.
   * "shared" and "cancelled" both end quietly — the person saw the sheet.
   */
  const reportShare = useCallback(
    (surface: string, outcome: ShareOutcome, whenFailed: string, whenUnsupported: string) => {
      if (outcome === "failed" || outcome === "unsupported") {
        reportClientError(surface, `share ${outcome}`, lastShareDiagnostics());
      }
      if (outcome === "failed") setError(whenFailed);
      else if (outcome === "unsupported") setShareHint(whenUnsupported);
      else if (outcome === "download-started") {
        // A download was REQUESTED. Whether the browser wrote it is not
        // observable from here, so the copy points at where to look.
        setShareHint("Your browser wouldn't open the share sheet — check your downloads.");
      }
    },
    [],
  );

  /**
   * STEP ONE of the web share: fetch the bytes. On native this finishes the
   * whole thing, because that sheet takes a URI and has no activation rule.
   * On the web it leaves a prepared file and the caller shows "Send now" —
   * the second tap is what keeps the activation the sheet requires.
   *
   * The prepared file is stamped with the SOURCE it came from, and a stale
   * fetch is discarded rather than armed: whoever took the last ticket wins.
   */
  const prepare = useCallback(
    async (
      source: ShareSource,
      surface: string,
      url: string,
      fileName: string,
      whenFailed: string,
      whenUnsupported: string,
    ) => {
      const ticket = ++prepareSeq.current;
      setSharing(true);
      setShareHint(null);
      setError(null);
      setReady(null);
      try {
        const r = await prepareVideoShare(url, fileName, SHARE_PAYLOAD, setSharePct);
        // A newer tap started while this one was fetching. Arming this file
        // now would hand the person the film they moved away from.
        if (ticket !== prepareSeq.current) return;
        if (r.kind === "ready") {
          setReady({ file: r.file, source, surface, whenFailed, whenUnsupported });
          setShareHint("Your film is ready — tap Send now to choose an app.");
          return;
        }
        reportShare(surface, r.outcome, whenFailed, whenUnsupported);
      } finally {
        if (ticket === prepareSeq.current) {
          setSharing(false);
          setSharePct(null);
        }
      }
    },
    [reportShare],
  );

  /**
   * STEP TWO. NOT async, and nothing is awaited before `shareReadyFile` — an
   * `await` added in front of this call silently restores the very refusal the
   * split exists to prevent.
   *
   * The caller says which film it believes it is sending, and a mismatch is
   * refused rather than sent: the button is the only thing that could be
   * wrong, and sending the wrong person's film is not a recoverable error.
   */
  const sendNow = useCallback(
    (source: ShareSource) => {
      const r = ready;
      if (!r || !sameSource(r.source, source)) return;
      if (sending.current) return;
      sending.current = true;
      setShareHint(null);
      void shareReadyFile(r.file, SHARE_PAYLOAD).then((outcome) => {
        sending.current = false;
        setReady((cur) => (cur && sameSource(cur.source, source) ? null : cur));
        reportShare(r.surface, outcome, r.whenFailed, r.whenUnsupported);
      });
    },
    [ready, reportShare],
  );

  const sendSaved = useCallback(
    (v: SavedVideo) =>
      prepare(
        { kind: "saved", id: v.id },
        "share-saved-video",
        v.uri,
        v.fileName,
        "Could not share that film. It is still on your device.",
        "Sharing isn't available here — send it from your gallery instead.",
      ),
    [prepare],
  );

  /**
   * A prepared file outlives nothing. If the film it belongs to is closed,
   * deleted, or no longer on the phone, the file is dropped — an armed "Send
   * now" pointing at something that is gone is the shape of the bug this
   * binding exists to prevent.
   */
  useEffect(() => {
    setReady((cur) => {
      if (!cur) return cur;
      if (cur.source.kind === "film") return cur.source.id === openId ? cur : null;
      return onDevice.some((v) => v.id === cur.source.id) ? cur : null;
    });
  }, [openId, onDevice]);


  // Poll only while something is actually moving. A settled list is a static
  // list, and polling it forever is load with no answer attached.
  const inFlight = useMemo(() => (rows ?? []).some((r) => !SETTLED.has(r.status)), [rows]);
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

  /**
   * Share the FILM ITSELF into WhatsApp, Facebook, or whatever the device
   * offers, straight from Your videos. The bytes stay on our servers, so the
   * same film can be shared again tomorrow — there is no longer a save step
   * that takes it away. On surfaces with no file share (desktop browsers) the
   * honest answer is guidance, not a link: the URL behind this film expires,
   * so a pasted link would die in the recipient's chat.
   */
  const share = useCallback(() => {
    if (!openId || !filmUrl) return Promise.resolve();
    // The SHAPE of the failure is filed, not just the word: "share doesn't
    // work" is unfixable as a report; "native-threw: download failed, http
    // 400" is a one-line fix. That happens inside `reportShare`.
    return prepare(
      "share-video",
      filmUrl,
      `oniq-story-${openId.slice(0, 8)}.mp4`,
      "Could not share that film. It is still here — try again.",
      "Sharing isn't available in this browser — open ONIQ on your phone to send it.",
    );
  }, [openId, filmUrl, prepare]);

  /**
   * Save a copy onto the phone. The film STAYS in Your videos afterwards —
   * this is a copy, not a handover, which is why the release step below is a
   * cancel rather than a done.
   */
  const save = useCallback(async () => {
    if (!openId || !filmUrl) return;
    setBusy(true);
    setError(null);
    try {
      const title = (rows ?? []).find((r) => r.id === openId)?.prompt ?? undefined;
      await saveStoryToDevice(openId, filmUrl, title);
      await refresh();
    } catch (e) {
      reportClientError("save-video", e instanceof Error ? e.message : String(e), {
        stack: e instanceof Error ? e.stack : null,
      });
      setError(e instanceof Error ? e.message : "Could not save that file.");
      // Hand it back so a dropped connection does not cost somebody their film.
      await releaseStory(openId);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [openId, filmUrl, refresh, rows]);

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
          {/* SHARE IS THE ONLY WAY OUT, and that is the point (owner
              directive, 2026-08-12: "share it directly from your videos and
              videos not download in user phone").

              The old primary action copied the film onto the phone AND
              deleted it from our servers, which made every film a one-way
              door: save it and it could never be shared from here again, lose
              the phone and it was gone. Films now stay put, so Share works
              today, tomorrow and from any device the account signs in on. */}
          <button
            type="button"
            data-testid={ready ? "story-share-send-now" : "story-share-prepare"}
            onClick={ready ? sendNow : () => void share()}
            disabled={busy || sharing}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {sharing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
            {sharing
              ? sharePct !== null
                ? `Preparing… ${sharePct}%`
                : "Preparing…"
              : ready
                ? "Send now"
                : "Share — WhatsApp, Facebook & more"}
          </button>
          {/* Saving is BACK, and it is no longer a trapdoor. It used to delete
              the film from our side, so a save meant you could never share it
              from here again; now it is simply a copy and the film stays put
              for thirty days either way. */}
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || sharing}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {busy ? "Saving…" : "Also save to my phone"}
          </button>
          {shareHint ? (
            <p className="mt-2 text-center text-[10px] text-amber-300">{shareHint}</p>
          ) : null}
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            Your films stay here in Your videos for 30 days — share them as often as you like, and
            saving a copy to your phone no longer removes them from here.
          </p>
        </div>
      ) : null}

      {/* On this phone. Listed above the server-side jobs because these are
          finished films the user already owns, and because after a save the
          server has nothing left to show for them. */}
      {onDevice.length > 0 ? (
        <section className="mt-4">
          <h3 className="flex items-center gap-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Smartphone className="h-3.5 w-3.5" /> On this phone
          </h3>
          <ul className="mt-2 space-y-2.5">
            {onDevice.map((v) => (
              <li key={v.id} className="rounded-2xl border border-border bg-card/70 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground">{v.title}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {(v.bytes / (1024 * 1024)).toFixed(1)} MB · saved {whenLabel(v.savedAt)}
                      {v.galleryUri ? " · in your gallery" : ""}
                    </p>
                  </div>
                </div>

                {playing?.id === v.id ? (
                  <video
                    src={v.uri}
                    controls
                    autoPlay
                    playsInline
                    className="mt-2.5 w-full rounded-xl bg-black"
                    style={{ aspectRatio: "9 / 16", maxHeight: "60vh" }}
                  />
                ) : null}

                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPlaying(playing?.id === v.id ? null : v)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground"
                  >
                    <Play className="h-3.5 w-3.5" /> {playing?.id === v.id ? "Stop" : "Replay"}
                  </button>
                  {/* Same two steps as the film above: this tap fetches, and
                      the button then becomes "Send now" so the sheet opens
                      out of a tap with nothing awaited in front of it. */}
                  <button
                    type="button"
                    data-testid={
                      ready?.surface === "share-saved-video"
                        ? "saved-share-send-now"
                        : "saved-share-prepare"
                    }
                    onClick={
                      ready?.surface === "share-saved-video" ? sendNow : () => void sendSaved(v)
                    }
                    disabled={sharing}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-primary/50 bg-primary/10 px-3 py-2 text-[11px] font-semibold text-primary disabled:opacity-50"
                  >
                    {sharing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Share2 className="h-3.5 w-3.5" />
                    )}
                    {ready?.surface === "share-saved-video" ? "Send now" : "Send"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(confirmDelete === v.id ? null : v.id)}
                    aria-label={`Delete ${v.title}`}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-destructive/40 text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {confirmDelete === v.id ? (
                  <div className="mt-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2.5">
                    <p className="text-[11px] text-foreground">
                      Remove from ONIQ?{" "}
                      {v.galleryUri
                        ? "The copy in your gallery stays."
                        : "This deletes the file — there is no copy left on our servers."}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void removeFromDevice(v)}
                        className="flex-1 rounded-lg bg-destructive px-3 py-1.5 text-[11px] font-semibold text-white"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="flex-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-semibold"
                      >
                        Keep
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {rows === null ? (
        <p className="mt-6 text-center text-[11px] text-muted-foreground">Loading…</p>
      ) : rows.length === 0 && onDevice.length === 0 ? (
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
            // EVERY ROW. The RPC accepts any stage now: a job still rendering
            // is failed and refunded first — the same treatment story-sweep
            // gives one that never rendered — then purged. So there is no row
            // in this list without a way out.
            const deletable = true;
            const inFlight = !SETTLED.has(r.status);
            return (
              <li key={r.id} className="rounded-2xl border border-border bg-card/70 p-3">
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

                {watchable && r.no_watermark !== true ? (
                  /* Paid addon, sold ON THE WEB like Story time — the app
                     never collects the money, it opens the checkout page.
                     No price named here: the server prices from story_addons. */
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        `https://oniqhub.com/pay/story?wm=${r.id}&from=app`,
                        "_blank",
                        "noopener",
                      )
                    }
                    className="mt-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary"
                  >
                    Remove ONIQ watermark ✨
                  </button>
                ) : null}

                {failed ? (
                  <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{r.error || "That one could not be made. Your time was returned."}</span>
                  </div>
                ) : null}

                {/* DELETE, on anything that has stopped moving.
                    Offered for finished films AND failed ones: a failure
                    notice you cannot dismiss is clutter that outlives its own
                    usefulness, and a film you cannot remove is a thirty-day
                    wait wearing the word "delete".
                    Withheld while a job is still rendering — deleting one
                    then raises whether the seconds come back, and that is a
                    refund policy, not a button. Those age out by themselves. */}
                {deletable ? (
                  confirmJob === r.id ? (
                    <div className="mt-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2.5">
                      <p className="text-[11px] text-foreground">
                        {inFlight
                          ? "Stop making this and delete it? The time it was going to use comes back to you."
                          : failed
                            ? "Remove this from your list? Nothing is lost — it never finished."
                            : "Delete this film from ONIQ? It cannot be undone. A copy you saved to this phone stays."}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void removeJob(r)}
                          disabled={deletingJob === r.id}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                        >
                          {deletingJob === r.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : null}
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmJob(null)}
                          className="flex-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-semibold"
                        >
                          Keep
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmJob(r.id)}
                      aria-label={`Delete ${r.prompt?.trim() || "this story"}`}
                      data-testid="story-job-delete"
                      className="mt-2 flex items-center gap-1.5 rounded-full border border-destructive/40 px-3 py-1 text-[11px] font-semibold text-destructive"
                    >
                      <Trash2 className="h-3 w-3" /> {inFlight ? "Stop & delete" : "Delete"}
                    </button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
