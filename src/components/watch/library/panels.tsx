/**
 * The Watch library's surfaces: Continue · Inbox · Resurface · Following ·
 * Collections · Threads · Movies, plus the searchable Library. Each is a
 * plain list with explicit loading, empty and error states, paginated by
 * cursor where it can grow. Nothing autoplays on a list.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { WatchPlayer } from "@/components/watch/WatchPlayer";
import { ItemCard } from "@/components/watch/library/ItemCard";
import {
  BottomSheet,
  Chip,
  EmptyState,
  ErrorState,
  GHOST,
  INPUT,
  LoadingRows,
  PRIMARY,
  RightsBadge,
  SMALL,
} from "@/components/watch/library/shared";
import type { Playable } from "@/data/watchDirectory";
import { useMyTv, useUserGenres, playableOfMyTv } from "@/lib/userWatch";
import {
  useCollectionLinks,
  useCollections,
  useContinue,
  useInvalidateWatch,
  useThreadLinks,
  useThreads,
  useWatchItems,
} from "@/lib/watch/hooks";
import {
  browseArchive,
  createCollection,
  createThread,
  deleteCollection,
  deleteThread,
  dismissResurface,
  renameCollection,
  saveWatchItem,
  updateWatchItem,
  type ArchiveBrowseRow,
  type ListFilters,
} from "@/lib/watch/library";
import { WATCH_PROVIDER_IDS, providerName, WATCH_PROVIDERS } from "@/lib/watch/providers";
import { rankResurface, topicClusters } from "@/lib/watch/resurface";
import { classifyArchiveRights } from "@/lib/watch/rights";
import { nextInThread, threadProgress } from "@/lib/watch/threads";
import type { WatchItem } from "@/lib/watch/types";

type Open = (item: WatchItem) => void;

/* ---------------- Continue ---------------- */

export function ContinuePanel({
  userId,
  now,
  onOpen,
}: {
  userId: string;
  now: Date;
  onOpen: Open;
}) {
  const q = useContinue(userId);
  if (q.isLoading) return <LoadingRows />;
  if (q.error)
    return <ErrorState message="Your unfinished videos didn't load." onRetry={() => q.refetch()} />;
  const items = q.data ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        emoji="▶️"
        title="Nothing half-watched"
        hint="Videos you start here and don't finish wait for you in Continue."
      />
    );
  }
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <ItemCard
          key={it.id}
          item={it}
          now={now}
          onOpen={onOpen}
          actions={
            <button type="button" onClick={() => onOpen(it)} className={SMALL}>
              Continue
            </button>
          }
        />
      ))}
    </div>
  );
}

/* ---------------- Inbox ---------------- */

function useItemActions(onOpen: Open) {
  const invalidate = useInvalidateWatch();
  const act = async (
    item: WatchItem,
    patch: Parameters<typeof updateWatchItem>[1],
    done: string,
  ) => {
    try {
      await updateWatchItem(item.id, patch);
      invalidate();
      toast.success(done);
    } catch {
      toast.error("Couldn't do that.");
    }
  };
  return {
    watch: (it: WatchItem) => onOpen(it),
    keep: (it: WatchItem) => act(it, { state: "library" }, "Kept"),
    archive: (it: WatchItem) => act(it, { state: "archived" }, "Archived"),
    notInterested: async (it: WatchItem) => {
      try {
        await dismissResurface(it);
        invalidate();
        toast.success("Won't resurface for a while");
      } catch {
        toast.error("Couldn't do that.");
      }
    },
  };
}

export function InboxPanel({
  userId,
  now,
  onOpen,
  onRemove,
}: {
  userId: string;
  now: Date;
  onOpen: Open;
  onRemove: (item: WatchItem) => void;
}) {
  const q = useWatchItems(userId, { state: "inbox" });
  const a = useItemActions(onOpen);
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState message="Your inbox didn't load." onRetry={() => q.refetch()} />;
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        emoji="📥"
        title="Inbox zero"
        hint="New saves land here. Watch, keep or archive them so the list never becomes a graveyard."
      />
    );
  }
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <ItemCard
          key={it.id}
          item={it}
          now={now}
          onOpen={onOpen}
          actions={
            <>
              <button type="button" onClick={() => a.watch(it)} className={SMALL}>
                Watch
              </button>
              <button type="button" onClick={() => a.keep(it)} className={SMALL}>
                Keep
              </button>
              <button type="button" onClick={() => a.archive(it)} className={SMALL}>
                Archive
              </button>
              <button
                type="button"
                onClick={() => onRemove(it)}
                className={`${SMALL} text-red-300`}
              >
                Remove
              </button>
            </>
          }
        />
      ))}
      {q.hasNextPage ? (
        <button
          type="button"
          disabled={q.isFetchingNextPage}
          onClick={() => q.fetchNextPage()}
          className={`${GHOST} w-full`}
        >
          {q.isFetchingNextPage ? "…" : "Load more"}
        </button>
      ) : null}
    </div>
  );
}

/* ---------------- Resurface ---------------- */

export function ResurfacePanel({
  userId,
  pool,
  loading,
  error,
  now,
  onOpen,
}: {
  userId: string;
  pool: WatchItem[];
  loading: boolean;
  error: boolean;
  now: Date;
  onOpen: Open;
}) {
  const threadsQ = useThreads(userId);
  const linksQ = useThreadLinks(userId);
  const a = useItemActions(onOpen);
  const threadNames = useMemo(() => {
    const byId = new Map((threadsQ.data ?? []).map((t) => [t.id, t.name]));
    const out: Record<string, string[]> = {};
    for (const l of linksQ.data ?? []) {
      const name = byId.get(l.parentId);
      if (name) (out[l.itemId] ??= []).push(name);
    }
    return out;
  }, [threadsQ.data, linksQ.data]);
  const ranked = useMemo(() => rankResurface(pool, { now, threadNames }), [pool, now, threadNames]);
  const clusters = useMemo(() => topicClusters(pool), [pool]);
  if (loading) return <LoadingRows />;
  if (error) return <ErrorState message="Resurface couldn't read your library." />;
  if (ranked.length === 0) {
    return (
      <EmptyState
        emoji="🌊"
        title="Nothing to resurface"
        hint="Things you saved and forgot, or started and dropped, show up here with a reason."
      />
    );
  }
  return (
    <div className="space-y-2">
      {clusters.length ? (
        <div className="rounded-2xl border border-border bg-card p-3 text-xs text-muted-foreground">
          {clusters.map((c) => (
            <div key={c.topic}>
              You have {c.count} saved videos about {c.topic}.
            </div>
          ))}
        </div>
      ) : null}
      {ranked.map((r) => (
        <ItemCard
          key={r.item.id}
          item={r.item}
          now={now}
          reason={r.reason}
          onOpen={onOpen}
          actions={
            <>
              <button type="button" onClick={() => a.watch(r.item)} className={SMALL}>
                {r.item.position_seconds > 0 ? "Continue" : "Watch"}
              </button>
              <button type="button" onClick={() => a.keep(r.item)} className={SMALL}>
                Keep
              </button>
              <button type="button" onClick={() => a.archive(r.item)} className={SMALL}>
                Archive
              </button>
              <button type="button" onClick={() => a.notInterested(r.item)} className={SMALL}>
                Not interested
              </button>
            </>
          }
        />
      ))}
    </div>
  );
}

/* ---------------- Following ---------------- */

export function FollowingPanel({ userId, onManage }: { userId: string; onManage: () => void }) {
  const myTv = useMyTv(userId);
  const genres = useUserGenres(userId);
  const [playing, setPlaying] = useState<Playable | null>(null);
  if (myTv.isLoading || genres.isLoading) return <LoadingRows />;
  if (myTv.error)
    return (
      <ErrorState message="Your followed channels didn't load." onRetry={() => myTv.refetch()} />
    );
  const channels = (myTv.data ?? [])
    .map((r) => ({ row: r, playable: playableOfMyTv(r) }))
    .filter((c) => c.playable);
  if (channels.length === 0) {
    return (
      <EmptyState
        emoji="📺"
        title="Follow a channel"
        hint="Channels you add to My TV on the Watch screen appear here, playing their latest uploads in the channel's own player."
        action={
          <button type="button" onClick={onManage} className={PRIMARY}>
            Manage My TV
          </button>
        }
      />
    );
  }
  return (
    <div className="space-y-3">
      {playing ? (
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black">
          <WatchPlayer
            key={`${playing.kind}:${playing.name}`}
            item={playing}
            autoplay
            className="absolute inset-0 h-full w-full"
          />
        </div>
      ) : null}
      <div className="space-y-2">
        {channels.map((c) => (
          <div
            key={c.row.channel_id}
            className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-card p-3"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{c.row.name}</div>
              <div className="text-[11px] text-muted-foreground">YouTube · latest uploads</div>
            </div>
            <button type="button" onClick={() => setPlaying(c.playable)} className={SMALL}>
              Play latest
            </button>
          </div>
        ))}
      </div>
      {(genres.data ?? []).length ? (
        <div className="text-[11px] text-muted-foreground">
          Your genres ({(genres.data ?? []).map((g) => g.name).join(", ")}) live on the Watch
          screen.
        </div>
      ) : null}
      <button type="button" onClick={onManage} className={GHOST}>
        Manage My TV
      </button>
    </div>
  );
}

/* ---------------- Collections ---------------- */

export function CollectionsPanel({
  userId,
  now,
  onOpen,
}: {
  userId: string;
  now: Date;
  onOpen: Open;
}) {
  const invalidate = useInvalidateWatch();
  const cols = useCollections(userId);
  const links = useCollectionLinks(userId);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [rename, setRename] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ids = useMemo(
    () =>
      selected
        ? (links.data ?? []).filter((l) => l.parentId === selected).map((l) => l.itemId)
        : [],
    [links.data, selected],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of links.data ?? []) m.set(l.parentId, (m.get(l.parentId) ?? 0) + 1);
    return m;
  }, [links.data]);
  const items = useWatchItems(userId, { state: "all", ids }, "saved");
  if (cols.isLoading) return <LoadingRows />;
  if (cols.error)
    return <ErrorState message="Your collections didn't load." onRetry={() => cols.refetch()} />;
  const current = (cols.data ?? []).find((c) => c.id === selected) ?? null;
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="new collection, e.g. Watch Tonight"
          aria-label="New collection"
          maxLength={60}
          className={INPUT}
        />
        <button
          type="button"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              const c = await createCollection(userId, name);
              setName("");
              setSelected(c.id);
              invalidate();
            } catch {
              toast.error("Couldn't create it (is the name taken?)");
            }
          }}
          className={SMALL}
        >
          Create
        </button>
      </div>
      {(cols.data ?? []).length === 0 ? (
        <EmptyState
          emoji="🗂️"
          title="No collections yet"
          hint="AI Video, Research, Movies, Inspiration, Learning, Watch Tonight — whatever shapes your watching."
        />
      ) : (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
          {(cols.data ?? []).map((c) => (
            <Chip
              key={c.id}
              active={selected === c.id}
              onClick={() => {
                setSelected(c.id);
                setRename(c.name);
                setConfirmDelete(false);
              }}
            >
              {c.name} · {counts.get(c.id) ?? 0}
            </Chip>
          ))}
        </div>
      )}
      {current ? (
        <div className="space-y-2">
          <div className="flex gap-1.5">
            <input
              value={rename}
              onChange={(e) => setRename(e.target.value)}
              aria-label="Rename collection"
              maxLength={60}
              className={INPUT}
            />
            <button
              type="button"
              disabled={!rename.trim() || rename.trim() === current.name}
              onClick={async () => {
                try {
                  await renameCollection(current.id, rename);
                  invalidate();
                } catch {
                  toast.error("Couldn't rename it.");
                }
              }}
              className={SMALL}
            >
              Rename
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                try {
                  await deleteCollection(current.id);
                  setSelected(null);
                  invalidate();
                  toast.success("Collection deleted; its videos stay in your library");
                } catch {
                  toast.error("Couldn't delete it.");
                }
              }}
              className={`${SMALL} ${confirmDelete ? "border-red-500/50 text-red-300" : ""}`}
            >
              {confirmDelete ? "Really delete?" : "Delete"}
            </button>
          </div>
          {items.isLoading ? <LoadingRows /> : null}
          {items.error ? (
            <ErrorState message="This collection didn't load." onRetry={() => items.refetch()} />
          ) : null}
          {!items.isLoading && ids.length === 0 ? (
            <EmptyState
              emoji="➕"
              title="Empty collection"
              hint="Open any saved video and tap this collection's name to add it."
            />
          ) : null}
          {(items.data?.pages.flatMap((p) => p.items) ?? []).map((it) => (
            <ItemCard key={it.id} item={it} now={now} onOpen={onOpen} />
          ))}
          {items.hasNextPage ? (
            <button
              type="button"
              onClick={() => items.fetchNextPage()}
              className={`${GHOST} w-full`}
            >
              Load more
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Threads ---------------- */

export function ThreadsPanel({ userId, now, onOpen }: { userId: string; now: Date; onOpen: Open }) {
  const invalidate = useInvalidateWatch();
  const threads = useThreads(userId);
  const links = useThreadLinks(userId);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const members = useMemo(
    () => (selected ? (links.data ?? []).filter((l) => l.parentId === selected) : []),
    [links.data, selected],
  );
  const ids = useMemo(() => members.map((m) => m.itemId), [members]);
  const items = useWatchItems(userId, { state: "all", ids }, "saved");
  const ordered = useMemo(() => {
    const byId = new Map((items.data?.pages.flatMap((p) => p.items) ?? []).map((i) => [i.id, i]));
    return members
      .map((m) => ({ item: byId.get(m.itemId), position: m.position }))
      .filter((m): m is { item: WatchItem; position: number } => !!m.item)
      .sort((a, b) => a.position - b.position);
  }, [items.data, members]);
  const next = useMemo(() => nextInThread(ordered), [ordered]);
  const progress = useMemo(() => threadProgress(ordered), [ordered]);
  if (threads.isLoading) return <LoadingRows />;
  if (threads.error)
    return <ErrorState message="Your threads didn't load." onRetry={() => threads.refetch()} />;
  const current = (threads.data ?? []).find((t) => t.id === selected) ?? null;
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="new thread, e.g. AI Video"
          aria-label="New thread"
          maxLength={80}
          className={INPUT}
        />
        <button
          type="button"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              const t = await createThread(userId, name);
              setName("");
              setSelected(t.id);
              invalidate();
            } catch {
              toast.error("Couldn't create it (is the name taken?)");
            }
          }}
          className={SMALL}
        >
          Create
        </button>
      </div>
      {(threads.data ?? []).length === 0 ? (
        <EmptyState
          emoji="🧵"
          title="No threads yet"
          hint="A thread strings saved videos into a line of research: Wan 2.2 → LoRA → character consistency → motion → LTX."
        />
      ) : (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
          {(threads.data ?? []).map((t) => (
            <Chip
              key={t.id}
              active={selected === t.id}
              onClick={() => {
                setSelected(t.id);
                setConfirmDelete(false);
              }}
            >
              {t.name}
            </Chip>
          ))}
        </div>
      )}
      {current ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {progress.done} of {progress.total} watched
            </span>
            <button
              type="button"
              onClick={async () => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                try {
                  await deleteThread(current.id);
                  setSelected(null);
                  invalidate();
                  toast.success("Thread deleted; its videos stay in your library");
                } catch {
                  toast.error("Couldn't delete it.");
                }
              }}
              className={`${SMALL} ${confirmDelete ? "border-red-500/50 text-red-300" : ""}`}
            >
              {confirmDelete ? "Really delete?" : "Delete thread"}
            </button>
          </div>
          {next ? (
            <div className="rounded-2xl border border-primary/40 bg-primary/10 p-3">
              <div className="text-[11px] uppercase tracking-wider text-primary">
                watch next in this thread
              </div>
              <ItemCard item={next.item} now={now} reason={next.reason} onOpen={onOpen} />
            </div>
          ) : ordered.length ? (
            <div className="rounded-2xl border border-border bg-card p-3 text-xs text-muted-foreground">
              You have watched everything in this thread.
            </div>
          ) : null}
          {items.isLoading ? <LoadingRows /> : null}
          {items.error ? (
            <ErrorState message="This thread didn't load." onRetry={() => items.refetch()} />
          ) : null}
          {!items.isLoading && ordered.length === 0 ? (
            <EmptyState
              emoji="➕"
              title="Empty thread"
              hint="Open any saved video and tap this thread's name to attach it."
            />
          ) : null}
          {ordered.map((m, i) => (
            <ItemCard
              key={m.item.id}
              item={m.item}
              now={now}
              reason={`${i + 1} of ${ordered.length}`}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Movies (Internet Archive) ---------------- */

const ARCHIVE_CATEGORIES: { id: string; label: string }[] = [
  { id: "public_domain", label: "Public-domain films" },
  { id: "silent", label: "Silent films" },
  { id: "classic", label: "Classic films" },
  { id: "documentary", label: "Documentary and educational" },
  { id: "historical", label: "Historical footage" },
  { id: "scifi", label: "Science fiction" },
  { id: "horror", label: "Horror" },
  { id: "animation", label: "Animation" },
  { id: "government", label: "Government and public information films" },
  { id: "travel", label: "Travel films" },
];

export function MoviesPanel({ userId, onOpen }: { userId: string; onOpen: Open }) {
  const invalidate = useInvalidateWatch();
  const [category, setCategory] = useState<string>("public_domain");
  const [rows, setRows] = useState<ArchiveBrowseRow[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArchiveBrowseRow | null>(null);

  if (loadedFor !== category && state !== "loading") {
    setState("loading");
    setLoadedFor(category);
    browseArchive(category)
      .then((r) => {
        setRows(r);
        setState("idle");
      })
      .catch(() => setState("error"));
  }

  const save = async (r: ArchiveBrowseRow) => {
    try {
      const rights = classifyArchiveRights({
        licenseurl: r.licenseurl,
        rights: r.rights,
        possibleCopyrightStatus: r.possibleCopyrightStatus,
      });
      const { item, existed } = await saveWatchItem(userId, {
        provider: "internet_archive",
        contentId: r.identifier,
        canonicalUrl: WATCH_PROVIDERS.internet_archive.pageUrl(r.identifier),
        title: r.title,
        creator: r.creator ?? null,
        rights,
        metadata: { source: "archive-browse", year: r.year ?? null },
        state: "inbox",
      });
      invalidate();
      toast.success(existed ? "Already saved — opened it" : "Saved to your Inbox");
      setPreview(null);
      onOpen(item);
    } catch {
      toast.error("Couldn't save that film.");
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        The Internet Archive&apos;s film library, in its own player. Rights come from each record;
        hosting there does not make a film free to reuse, and an old film is not public domain
        because it is old.
      </p>
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
        {ARCHIVE_CATEGORIES.map((c) => (
          <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
            {c.label}
          </Chip>
        ))}
      </div>
      {state === "loading" ? <LoadingRows /> : null}
      {state === "error" ? (
        <ErrorState message="The Archive didn't answer." onRetry={() => setLoadedFor(null)} />
      ) : null}
      {state === "idle" && rows && rows.length === 0 ? (
        <EmptyState emoji="🏛️" title="Nothing in this shelf right now" />
      ) : null}
      {state === "idle" && rows ? (
        <div className="space-y-2">
          {rows.map((r) => {
            const rights = classifyArchiveRights({
              licenseurl: r.licenseurl,
              rights: r.rights,
              possibleCopyrightStatus: r.possibleCopyrightStatus,
            });
            return (
              <div
                key={r.identifier}
                className="rounded-2xl border border-border bg-card p-3"
                data-testid="watch-archive-row"
              >
                <div className="flex items-start gap-3">
                  <div className="grid h-14 w-20 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-2xl">
                    🏛️
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm font-semibold leading-snug">{r.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {r.creator ? <span className="truncate">{r.creator}</span> : null}
                      {r.year ? <span>{r.year}</span> : null}
                      <RightsBadge rights={rights} />
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button type="button" onClick={() => setPreview(r)} className={SMALL}>
                    Watch
                  </button>
                  <button type="button" onClick={() => save(r)} className={SMALL}>
                    Save
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {preview ? (
        <BottomSheet title={preview.title} onClose={() => setPreview(null)}>
          <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black">
            <WatchPlayer
              item={{
                kind: "embed",
                embed: { platform: "archive", item: preview.identifier },
                name: preview.title,
              }}
              autoplay={false}
              className="absolute inset-0 h-full w-full"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <RightsBadge
              rights={classifyArchiveRights({
                licenseurl: preview.licenseurl,
                rights: preview.rights,
                possibleCopyrightStatus: preview.possibleCopyrightStatus,
              })}
            />
            <span>{providerName("internet_archive")}</span>
          </div>
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={() => save(preview)} className={PRIMARY}>
              Save to my library
            </button>
          </div>
        </BottomSheet>
      ) : null}
    </div>
  );
}

/* ---------------- Library (search + filters) ---------------- */

export type LibraryFilterState = {
  query: string;
  provider: string | null;
  status: "all" | "unwatched" | "unfinished" | "completed";
  maxMinutes: number | null;
  includeArchived: boolean;
};

export const DEFAULT_LIBRARY_FILTERS: LibraryFilterState = {
  query: "",
  provider: null,
  status: "all",
  maxMinutes: null,
  includeArchived: false,
};

export function toListFilters(f: LibraryFilterState): ListFilters {
  return {
    state: f.includeArchived ? "all" : "library",
    provider: (f.provider as ListFilters["provider"]) ?? undefined,
    query: f.query || undefined,
    unfinished: f.status === "unfinished" || undefined,
    completed: f.status === "completed" ? true : f.status === "unwatched" ? false : undefined,
    maxSeconds: f.maxMinutes ? f.maxMinutes * 60 : undefined,
  };
}

export function LibraryPanel({
  userId,
  now,
  filters,
  setFilters,
  onOpen,
}: {
  userId: string;
  now: Date;
  filters: LibraryFilterState;
  setFilters: (f: LibraryFilterState) => void;
  onOpen: Open;
}) {
  const list = toListFilters(filters);
  // Inbox items are library items too for search purposes: search both states.
  const q = useWatchItems(
    userId,
    { ...list, state: filters.includeArchived ? "all" : list.state },
    "saved",
  );
  const q2 = useWatchItems(userId, { ...list, state: "inbox" }, "saved");
  const items = useMemo(() => {
    const seen = new Set<string>();
    const merged: WatchItem[] = [];
    for (const it of [
      ...(q.data?.pages.flatMap((p) => p.items) ?? []),
      ...(filters.includeArchived ? [] : (q2.data?.pages.flatMap((p) => p.items) ?? [])),
    ]) {
      if (!seen.has(it.id)) {
        seen.add(it.id);
        merged.push(it);
      }
    }
    return merged.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  }, [q.data, q2.data, filters.includeArchived]);
  return (
    <div className="space-y-2">
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
        <Chip active={!filters.provider} onClick={() => setFilters({ ...filters, provider: null })}>
          all providers
        </Chip>
        {WATCH_PROVIDER_IDS.map((p) => (
          <Chip
            key={p}
            active={filters.provider === p}
            onClick={() => setFilters({ ...filters, provider: filters.provider === p ? null : p })}
          >
            {providerName(p)}
          </Chip>
        ))}
      </div>
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
        {(["all", "unwatched", "unfinished", "completed"] as const).map((s) => (
          <Chip
            key={s}
            active={filters.status === s}
            onClick={() => setFilters({ ...filters, status: s })}
          >
            {s}
          </Chip>
        ))}
        {[10, 30, 60].map((m) => (
          <Chip
            key={m}
            active={filters.maxMinutes === m}
            onClick={() =>
              setFilters({ ...filters, maxMinutes: filters.maxMinutes === m ? null : m })
            }
          >
            ≤ {m} min
          </Chip>
        ))}
        <Chip
          active={filters.includeArchived}
          onClick={() => setFilters({ ...filters, includeArchived: !filters.includeArchived })}
        >
          archived too
        </Chip>
      </div>
      {q.isLoading ? <LoadingRows /> : null}
      {q.error ? (
        <ErrorState message="Your library didn't load." onRetry={() => q.refetch()} />
      ) : null}
      {!q.isLoading && !q.error && items.length === 0 ? (
        <EmptyState
          emoji="🔍"
          title={filters.query ? "No matches" : "Nothing saved yet"}
          hint={
            filters.query
              ? "Search looks at titles, creators and your notes."
              : "Save a link to begin."
          }
        />
      ) : null}
      {items.map((it) => (
        <ItemCard key={it.id} item={it} now={now} onOpen={onOpen} />
      ))}
      {q.hasNextPage || q2.hasNextPage ? (
        <button
          type="button"
          disabled={q.isFetchingNextPage || q2.isFetchingNextPage}
          onClick={() => {
            if (q.hasNextPage) void q.fetchNextPage();
            if (q2.hasNextPage) void q2.fetchNextPage();
          }}
          className={`${GHOST} w-full`}
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}
