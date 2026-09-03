/**
 * One saved item, opened: it plays here in its provider's own player where
 * one exists (the shared WatchPlayer), resumes where it stopped, reports
 * progress, and carries the person's notes, moments, collections, threads,
 * rights and an "Ask ONIQ" that answers from those notes only.
 *
 * Nothing in this file downloads, proxies or fetches media. Nebula has no
 * player to frame, so its button opens nebula.tv.
 */
import { ExternalLink, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AiOutputReport, AI_OUTPUT_LABEL } from "@/components/safety/AiOutputReport";
import { WatchPlayer, type WatchPlayerHandle } from "@/components/watch/WatchPlayer";
import {
  BottomSheet,
  Chip,
  GHOST,
  INPUT,
  PRIMARY,
  ProviderBadge,
  RightsBadge,
  SMALL,
} from "@/components/watch/library/shared";
import { openInApp } from "@/lib/miniapps";
import { formatClock, formatProgressClock, parseClock } from "@/lib/watch/format";
import {
  useCollectionLinks,
  useCollections,
  useInvalidateWatch,
  useMoments,
  useThreadLinks,
  useThreads,
} from "@/lib/watch/hooks";
import {
  addMoment,
  addToCollection,
  addToThread,
  askWatch,
  createCollection,
  createThread,
  deleteMoment,
  deleteWatchItem,
  dismissResurface,
  removeFromCollection,
  removeFromThread,
  resolveWatchRef,
  setDuplicateGroup,
  setWatchProgress,
  updateWatchItem,
} from "@/lib/watch/library";
import { WATCH_PROVIDERS } from "@/lib/watch/providers";
import { classifyArchiveRights, rightsFromStored, rightsNote } from "@/lib/watch/rights";
import { SAVE_REASONS, type WatchItem } from "@/lib/watch/types";

/** Progress is written at most this often while playing. */
const PROGRESS_WRITE_MS = 15000;

export function ItemSheet({
  userId,
  item: initial,
  siblings,
  onClose,
}: {
  userId: string;
  item: WatchItem;
  /** Other items that share this one's duplicate group, for "Available from N sources". */
  siblings: WatchItem[];
  onClose: () => void;
}) {
  const [item, setItem] = useState(initial);
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [momentAt, setMomentAt] = useState("");
  const [momentNote, setMomentNote] = useState("");
  const [newCollection, setNewCollection] = useState("");
  const [newThread, setNewThread] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<WatchPlayerHandle | null>(null);
  const lastWriteRef = useRef(0);
  const latestRef = useRef<{ t: number; d: number | null } | null>(null);
  const invalidate = useInvalidateWatch();
  const collectionsQ = useCollections(userId);
  const linksQ = useCollectionLinks(userId);
  const threadsQ = useThreads(userId);
  const threadLinksQ = useThreadLinks(userId);
  const momentsQ = useMoments(userId, item.id);

  const provider = WATCH_PROVIDERS[item.provider];
  const playable = useMemo(
    () => provider.playable(item.content_id, item.title),
    [provider, item.content_id, item.title],
  );
  const inCollections = useMemo(
    () => new Set((linksQ.data ?? []).filter((l) => l.itemId === item.id).map((l) => l.parentId)),
    [linksQ.data, item.id],
  );
  const inThreads = useMemo(
    () =>
      new Set((threadLinksQ.data ?? []).filter((l) => l.itemId === item.id).map((l) => l.parentId)),
    [threadLinksQ.data, item.id],
  );

  const apply = useCallback(
    (next: WatchItem) => {
      setItem(next);
      invalidate();
    },
    [invalidate],
  );

  const patch = useCallback(
    async (p: Parameters<typeof updateWatchItem>[1], okText?: string) => {
      try {
        apply(await updateWatchItem(item.id, p));
        if (okText) toast.success(okText);
      } catch (e) {
        console.warn("watch: update failed", (e as { code?: string })?.code ?? "");
        toast.error("Couldn't save that change.");
      }
    },
    [apply, item.id],
  );

  // Progress from the player, written at most every PROGRESS_WRITE_MS and
  // flushed when the sheet closes.
  const writeProgress = useCallback(
    async (t: number, d: number | null) => {
      try {
        apply(await setWatchProgress(item, t, d));
      } catch {
        /* a missed progress write is harmless; the next one catches up */
      }
    },
    [apply, item],
  );
  const onProgress = useCallback(
    (t: number, d: number | null) => {
      latestRef.current = { t, d };
      const now = Date.now();
      if (now - lastWriteRef.current < PROGRESS_WRITE_MS) return;
      lastWriteRef.current = now;
      void writeProgress(t, d);
    },
    [writeProgress],
  );
  useEffect(() => {
    return () => {
      const last = latestRef.current;
      if (last && last.t > 0) void writeProgress(last.t, last.d);
    };
    // Flush once, on unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markPosition = async () => {
    const fromPlayer = playerRef.current?.currentTime() ?? latestRef.current?.t ?? null;
    const typed = parseClock(momentAt);
    const t = typed ?? fromPlayer;
    if (t == null) {
      toast.error("Type a position like 17:32 first.");
      return;
    }
    await writeProgress(t, latestRef.current?.d ?? null);
    toast.success(`Position saved at ${formatClock(t)}`);
  };

  const saveMoment = async () => {
    const typed = parseClock(momentAt);
    const t = typed ?? playerRef.current?.currentTime() ?? latestRef.current?.t ?? null;
    if (t == null) {
      toast.error("Type a time like 12:05, or play the video first.");
      return;
    }
    try {
      await addMoment(userId, item.id, t, momentNote, null);
      setMomentAt("");
      setMomentNote("");
      invalidate();
      toast.success(`Moment saved at ${formatClock(t)}`);
    } catch {
      toast.error("Couldn't save the moment.");
    }
  };

  const toggleCollection = async (collectionId: string) => {
    try {
      if (inCollections.has(collectionId)) await removeFromCollection(collectionId, item.id);
      else await addToCollection(userId, collectionId, item.id);
      invalidate();
    } catch {
      toast.error("Couldn't change the collection.");
    }
  };

  const toggleThread = async (threadId: string) => {
    try {
      if (inThreads.has(threadId)) await removeFromThread(threadId, item.id);
      else
        await addToThread(
          userId,
          threadId,
          item.id,
          (threadLinksQ.data ?? []).filter((l) => l.parentId === threadId).length,
        );
      invalidate();
    } catch {
      toast.error("Couldn't change the thread.");
    }
  };

  const ask = async (task: "ask" | "summarize") => {
    setAsking(true);
    setAnswer(null);
    const res = await askWatch({
      mode: "item",
      itemId: item.id,
      question: task === "ask" ? question : "summarize",
      task,
    });
    setAsking(false);
    setAnswer(
      res.ok && res.answer ? res.answer : `ONIQ couldn't answer: ${res.reason ?? "unavailable"}.`,
    );
  };

  const checkRights = async () => {
    const m = await resolveWatchRef("internet_archive", item.content_id);
    if (!m.resolved) {
      toast.error("Couldn't read the Archive's rights record right now.");
      return;
    }
    await patch(
      {
        rights: classifyArchiveRights(m.archive ?? {}),
        duration_seconds: m.durationSeconds ?? item.duration_seconds,
      },
      "Rights checked",
    );
  };

  const remove = async () => {
    try {
      await deleteWatchItem(item.id);
      invalidate();
      toast.success("Removed from Watch");
      onClose();
    } catch {
      toast.error("Couldn't remove it.");
    }
  };

  const rights = rightsFromStored(item.rights);

  return (
    <BottomSheet title={item.title} onClose={onClose} testId="watch-item-sheet">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <ProviderBadge provider={item.provider} />
        {item.creator ? <span>{item.creator}</span> : null}
        {item.duration_seconds ? (
          <span>{formatProgressClock(item.position_seconds, item.duration_seconds)}</span>
        ) : null}
        {item.provider === "internet_archive" ? <RightsBadge rights={item.rights} /> : null}
      </div>

      {/* THE PLAYER. The provider's own, nothing over it. Starts on a tap. */}
      {playable ? (
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black">
          {playing ? (
            <WatchPlayer
              item={playable}
              autoplay
              startSeconds={item.position_seconds}
              onProgress={provider.capabilities.progress ? onProgress : undefined}
              onReady={(h) => {
                playerRef.current = h;
              }}
              className="absolute inset-0 h-full w-full"
            />
          ) : (
            <button
              type="button"
              data-testid="watch-item-play"
              onClick={() => setPlaying(true)}
              className="absolute inset-0 grid place-items-center text-sm font-semibold text-foreground"
            >
              ▶{" "}
              {item.position_seconds > 0 && !item.completed_at
                ? `Continue from ${formatClock(item.position_seconds)}`
                : "Play here"}
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm">
          <div className="font-semibold">Watch on {provider.name}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {provider.name} plays only in its own app or site. ONIQ keeps your note, progress and
            place in your collections; the video stays with {provider.name}.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => openInApp(item.canonical_url)} className={SMALL}>
          Open on {provider.name} <ExternalLink className="size-3" />
        </button>
        <button type="button" onClick={markPosition} className={SMALL}>
          Save position
        </button>
        <button
          type="button"
          onClick={() =>
            patch(
              {
                completed_at: item.completed_at ? null : new Date().toISOString(),
                ...(item.completed_at ? { position_seconds: 0 } : {}),
                last_watched_at: new Date().toISOString(),
              },
              item.completed_at ? "Marked unfinished" : "Marked finished",
            )
          }
          className={SMALL}
        >
          {item.completed_at ? "Mark unfinished" : "Mark finished"}
        </button>
        {item.state !== "library" ? (
          <button
            type="button"
            onClick={() => patch({ state: "library" }, "Kept")}
            className={SMALL}
          >
            Keep
          </button>
        ) : null}
        {item.state !== "archived" ? (
          <button
            type="button"
            onClick={() => patch({ state: "archived" }, "Archived")}
            className={SMALL}
          >
            Archive
          </button>
        ) : (
          <button
            type="button"
            onClick={() => patch({ state: "library" }, "Restored")}
            className={SMALL}
          >
            Restore
          </button>
        )}
        {!confirmRemove ? (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className={`${SMALL} text-red-300`}
          >
            <Trash2 className="size-3" /> Remove
          </button>
        ) : (
          <button
            type="button"
            onClick={remove}
            className={`${SMALL} border-red-500/50 text-red-300`}
          >
            Really remove?
          </button>
        )}
      </div>

      {siblings.length > 0 ? (
        <div className="mt-3 rounded-2xl border border-border bg-card p-3 text-xs">
          <div className="font-semibold">Available from {siblings.length + 1} sources</div>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {siblings.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <ProviderBadge provider={s.provider} /> <span className="truncate">{s.title}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={async () => {
              await setDuplicateGroup([item.id], null);
              apply({ ...item, duplicate_group_id: null });
              toast.success("Ungrouped");
            }}
            className={`${SMALL} mt-2`}
          >
            Not the same video
          </button>
        </div>
      ) : null}

      {item.provider === "internet_archive" ? (
        <div className="mt-3 rounded-2xl border border-border bg-card p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Rights</div>
            <button type="button" onClick={checkRights} className={SMALL}>
              {rights ? "Re-check" : "Check rights"}
            </button>
          </div>
          <div className="mt-1 text-muted-foreground">{rightsNote(rights)}</div>
          {rights?.licenseUrl ? (
            <button
              type="button"
              onClick={() => openInApp(rights.licenseUrl as string)}
              className="mt-1 text-primary underline"
            >
              licence record
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3">
        <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          why you saved it · priority
        </div>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
          {SAVE_REASONS.map((r) => (
            <Chip
              key={r.key}
              active={item.reason === r.key}
              onClick={() => patch({ reason: item.reason === r.key ? null : r.key })}
            >
              {r.label}
            </Chip>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {[0, 1, 2, 3].map((p) => (
            <Chip
              key={p}
              active={item.priority === p}
              onClick={() => patch({ priority: p })}
              label={`Priority ${p}`}
            >
              {p === 0 ? "normal" : "★".repeat(p)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          notes
        </div>
        <textarea
          data-testid="watch-item-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== (item.notes ?? ""))
              void patch({ notes: notes.trim().slice(0, 4000) || null });
          }}
          placeholder="what you want to remember from this"
          aria-label="Notes"
          rows={3}
          className={INPUT}
        />
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          onBlur={() => {
            const next = tags
              .split(",")
              .map((t) => t.trim().toLowerCase())
              .filter(Boolean)
              .slice(0, 20);
            if (next.join(",") !== item.tags.join(",")) void patch({ tags: next });
          }}
          placeholder="tags, comma separated"
          aria-label="Tags"
          className={`${INPUT} mt-1.5`}
        />
        {item.topics.length ? (
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            topics: {item.topics.join(", ")}
          </div>
        ) : null}
      </div>

      <div className="mt-3">
        <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          moments
        </div>
        {(momentsQ.data ?? []).length ? (
          <ul className="space-y-1 text-xs">
            {(momentsQ.data ?? []).map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2"
              >
                <span>
                  <span className="font-semibold">{formatClock(m.at_seconds)}</span>
                  {m.note ? <span className="text-muted-foreground"> — {m.note}</span> : null}
                </span>
                <button
                  type="button"
                  aria-label="Delete moment"
                  onClick={async () => {
                    await deleteMoment(m.id);
                    invalidate();
                  }}
                  className="tap press grid h-8 w-8 place-items-center rounded-full text-muted-foreground"
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-xs text-muted-foreground">
            No moments yet. A moment is a timestamp and a note — the video stays where it is.
          </div>
        )}
        <div className="mt-1.5 grid grid-cols-[6rem_1fr_auto] gap-1.5">
          <input
            value={momentAt}
            onChange={(e) => setMomentAt(e.target.value)}
            placeholder="12:05"
            aria-label="Moment time"
            className={INPUT}
          />
          <input
            value={momentNote}
            onChange={(e) => setMomentNote(e.target.value)}
            placeholder="note (optional)"
            aria-label="Moment note"
            maxLength={500}
            className={INPUT}
          />
          <button type="button" onClick={saveMoment} className={SMALL}>
            Save moment
          </button>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          collections
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(collectionsQ.data ?? []).map((c) => (
            <Chip
              key={c.id}
              active={inCollections.has(c.id)}
              onClick={() => toggleCollection(c.id)}
            >
              {c.name}
            </Chip>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <input
            value={newCollection}
            onChange={(e) => setNewCollection(e.target.value)}
            placeholder="new collection"
            aria-label="New collection"
            maxLength={60}
            className={INPUT}
          />
          <button
            type="button"
            disabled={!newCollection.trim()}
            onClick={async () => {
              try {
                const c = await createCollection(userId, newCollection);
                await addToCollection(userId, c.id, item.id);
                setNewCollection("");
                invalidate();
              } catch {
                toast.error("Couldn't create that collection (is the name taken?)");
              }
            }}
            className={SMALL}
          >
            Add
          </button>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          threads
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(threadsQ.data ?? []).map((t) => (
            <Chip key={t.id} active={inThreads.has(t.id)} onClick={() => toggleThread(t.id)}>
              {t.name}
            </Chip>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <input
            value={newThread}
            onChange={(e) => setNewThread(e.target.value)}
            placeholder="new thread"
            aria-label="New thread"
            maxLength={80}
            className={INPUT}
          />
          <button
            type="button"
            disabled={!newThread.trim()}
            onClick={async () => {
              try {
                const t = await createThread(userId, newThread);
                await addToThread(userId, t.id, item.id, 0);
                setNewThread("");
                invalidate();
              } catch {
                toast.error("Couldn't create that thread (is the name taken?)");
              }
            }}
            className={SMALL}
          >
            Add
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-border bg-card p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          ask ONIQ about this video
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Answers come from your notes and moments and the video&apos;s details. ONIQ has not
          watched it and has no transcript.
        </p>
        <div className="mt-1.5 flex gap-1.5">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="what did this say about…?"
            aria-label="Question"
            maxLength={500}
            className={INPUT}
          />
          <button
            type="button"
            disabled={asking || !question.trim()}
            onClick={() => ask("ask")}
            className={PRIMARY}
          >
            Ask
          </button>
        </div>
        <div className="mt-1.5">
          <button
            type="button"
            disabled={asking}
            onClick={() => ask("summarize")}
            className={GHOST}
          >
            Main points from my notes
          </button>
        </div>
        {asking ? <div className="mt-2 text-xs text-muted-foreground">Thinking…</div> : null}
        {answer ? (
          <div className="mt-2 rounded-xl border border-border bg-background p-3 text-sm">
            <div className="whitespace-pre-wrap">{answer}</div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">{AI_OUTPUT_LABEL}</span>
              <AiOutputReport
                surface="watch_ai_output"
                targetId={item.id}
                context={{ provider: item.provider }}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex justify-between gap-2">
        <button
          type="button"
          onClick={async () => {
            apply(await dismissResurface(item));
            toast.success("Won't resurface for a while");
          }}
          className={GHOST}
        >
          Not interested for now
        </button>
        <button type="button" onClick={onClose} className={PRIMARY}>
          Done
        </button>
      </div>
    </BottomSheet>
  );
}
