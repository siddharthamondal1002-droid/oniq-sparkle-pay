/**
 * ONIQ WATCH — THE LIBRARY.
 *
 * Owner mission, 2026-09-03: one Watch system over YouTube, Vimeo, Nebula
 * and the Internet Archive (and the two players Watch already had), with the
 * personal layer that makes it ONIQ's: Continue, Inbox, Resurface, Following,
 * Collections, Threads, Movies, a smart queue, watchlist health, moments,
 * notes and "Ask ONIQ" over those notes.
 *
 * What ONIQ holds is references and the person's own organisation of them.
 * Playback is the provider's own player (src/components/watch/WatchPlayer.tsx)
 * or the provider's own page. Nothing is downloaded, proxied or scraped; the
 * tests in src/lib/watch/__tests__ hold that line.
 *
 * EVERY HOOK IS ABOVE THE COUNTRY GATE'S EARLY RETURN — rules-of-hooks is a
 * release blocker in this repo.
 */
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Plus, Search, Sparkles, Stethoscope, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { NOT_AFFILIATED_NOTICE } from "@/config/playCompliance";
import { isAvailable } from "@/data/countryRegistry";
import { WATCH_NOTICE } from "@/data/watchDirectory";
import { HealthSheet } from "@/components/watch/library/HealthSheet";
import { ItemSheet } from "@/components/watch/library/ItemSheet";
import {
  CollectionsPanel,
  ContinuePanel,
  DEFAULT_LIBRARY_FILTERS,
  FollowingPanel,
  InboxPanel,
  LibraryPanel,
  MoviesPanel,
  ResurfacePanel,
  ThreadsPanel,
  type LibraryFilterState,
} from "@/components/watch/library/panels";
import { QueueSheet } from "@/components/watch/library/QueueSheet";
import { SaveLinkSheet } from "@/components/watch/library/SaveLinkSheet";
import { Chip, GHOST, PRIMARY, SMALL } from "@/components/watch/library/shared";
import { useCountry } from "@/lib/country";
import { useSession } from "@/lib/userWatch";
import { useAnalysisPool, useCollections, useInvalidateWatch } from "@/lib/watch/hooks";
import { deleteWatchItem } from "@/lib/watch/library";
import { parseSurface, type WatchSurface } from "@/lib/watch/surfaces";
import type { WatchItem } from "@/lib/watch/types";

const SURFACES = [
  { key: "continue", label: "Continue", emoji: "▶️" },
  { key: "inbox", label: "Inbox", emoji: "📥" },
  { key: "resurface", label: "Resurface", emoji: "🌊" },
  { key: "following", label: "Following", emoji: "📺" },
  { key: "collections", label: "Collections", emoji: "🗂️" },
  { key: "threads", label: "Threads", emoji: "🧵" },
  { key: "movies", label: "Movies", emoji: "🏛️" },
] as const;
type Surface = WatchSurface;

const TAB_KEY = "oniq.watch.library.tab";

export function WatchLibrary({
  initialSurface,
  openSave = false,
}: {
  /** From Home's library row (?surface=), else the last surface used here. */
  initialSurface?: WatchSurface;
  /** ?save=1 from Home: land with the Save-a-link sheet already open. */
  openSave?: boolean;
} = {}) {
  const navigate = useNavigate();
  const [home] = useCountry();
  const userId = useSession();
  const invalidate = useInvalidateWatch();
  const [tab, setTab] = useState<Surface>(() => {
    if (initialSurface) return initialSurface;
    if (typeof window === "undefined") return "continue";
    try {
      return parseSurface(localStorage.getItem(TAB_KEY)) ?? "continue";
    } catch {
      return "continue";
    }
  });
  const [filters, setFilters] = useState<LibraryFilterState>(DEFAULT_LIBRARY_FILTERS);
  const [open, setOpen] = useState<WatchItem | null>(null);
  const [saveOpen, setSaveOpen] = useState(openSave);
  const [queueOpen, setQueueOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [removing, setRemoving] = useState<WatchItem | null>(null);
  // One clock per render pass, so every card agrees on "today".
  const now = useMemo(() => new Date(), [tab, open, saveOpen, queueOpen, healthOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const pool = useAnalysisPool(userId);
  const collections = useCollections(userId);
  const siblings = useMemo(
    () =>
      open?.duplicate_group_id
        ? (pool.data ?? []).filter(
            (i) => i.duplicate_group_id === open.duplicate_group_id && i.id !== open.id,
          )
        : [],
    [open, pool.data],
  );

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* noop */
    }
  }, [tab]);

  // A deep link from Home while this screen is already mounted still lands
  // on the surface it named, and still opens the sheet it asked for.
  useEffect(() => {
    if (initialSurface) setTab(initialSurface);
  }, [initialSurface]);
  useEffect(() => {
    if (openSave) setSaveOpen(true);
  }, [openSave]);

  // EVERY HOOK IS ABOVE THIS RETURN.
  if (!isAvailable("watch", home)) {
    return (
      <div className="min-h-dvh bg-background pb-24 text-foreground">
        <Header onBack={() => navigate({ to: "/app/watch" })} />
        <div className="mx-auto max-w-2xl px-4">
          <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
            Watch isn&apos;t in ONIQ where you are yet 🌍
          </div>
        </div>
      </div>
    );
  }

  const searching = tab === "library";
  const openItem = (item: WatchItem) => setOpen(item);

  return (
    <div className="min-h-dvh bg-background pb-24 text-foreground">
      <Header onBack={() => navigate({ to: "/app/watch" })} />
      <div className="mx-auto max-w-2xl px-4">
        {/* SEARCH — the person's own library, nothing else. */}
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filters.query}
            onChange={(e) => {
              setFilters({ ...filters, query: e.target.value });
              if (e.target.value && tab !== "library") setTab("library");
            }}
            onFocus={() => setTab("library")}
            placeholder="Search your saved videos, creators, notes"
            aria-label="Search your Watch library"
            data-testid="watch-library-search"
            className="min-h-11 w-full rounded-full border border-border bg-card py-2.5 ps-9 pe-9 text-sm outline-none focus:border-primary"
          />
          {filters.query ? (
            <button
              type="button"
              onClick={() => setFilters({ ...filters, query: "" })}
              aria-label="Clear search"
              className="absolute end-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            data-testid="watch-library-save"
            onClick={() => setSaveOpen(true)}
            className={PRIMARY}
          >
            <Plus className="me-1 size-4" /> Save a link
          </button>
          <button
            type="button"
            data-testid="watch-library-queue"
            onClick={() => setQueueOpen(true)}
            className={GHOST}
          >
            <Sparkles className="me-1 size-4" /> What should I watch?
          </button>
          <button
            type="button"
            data-testid="watch-library-health"
            onClick={() => setHealthOpen(true)}
            className={GHOST}
          >
            <Stethoscope className="me-1 size-4" /> Health
          </button>
        </div>

        {/* PRIMARY NAVIGATION — one row, every surface one tap away. */}
        <div
          className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Watch library"
        >
          {SURFACES.map((s) => (
            <Chip key={s.key} active={tab === s.key} onClick={() => setTab(s.key)}>
              {s.emoji} {s.label}
            </Chip>
          ))}
          <Chip active={searching} onClick={() => setTab("library")}>
            🔍 All
          </Chip>
        </div>

        <div className="mt-3">
          {!userId ? (
            <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
              Sign in to keep a Watch library.
            </div>
          ) : tab === "continue" ? (
            <ContinuePanel userId={userId} now={now} onOpen={openItem} />
          ) : tab === "inbox" ? (
            <InboxPanel userId={userId} now={now} onOpen={openItem} onRemove={setRemoving} />
          ) : tab === "resurface" ? (
            <ResurfacePanel
              userId={userId}
              pool={pool.data ?? []}
              loading={pool.isLoading}
              error={!!pool.error}
              now={now}
              onOpen={openItem}
            />
          ) : tab === "following" ? (
            <FollowingPanel userId={userId} onManage={() => navigate({ to: "/app/watch" })} />
          ) : tab === "collections" ? (
            <CollectionsPanel userId={userId} now={now} onOpen={openItem} />
          ) : tab === "threads" ? (
            <ThreadsPanel userId={userId} now={now} onOpen={openItem} />
          ) : tab === "movies" ? (
            <MoviesPanel userId={userId} onOpen={openItem} />
          ) : (
            <LibraryPanel
              userId={userId}
              now={now}
              filters={filters}
              setFilters={setFilters}
              onOpen={openItem}
            />
          )}
        </div>

        <p className="mt-6 text-[11px] leading-snug text-muted-foreground">{WATCH_NOTICE}</p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {NOT_AFFILIATED_NOTICE}
        </p>
      </div>

      {open && userId ? (
        <ItemSheet
          key={open.id}
          userId={userId}
          item={open}
          siblings={siblings}
          onClose={() => {
            setOpen(null);
            invalidate();
          }}
        />
      ) : null}
      {saveOpen && userId ? (
        <SaveLinkSheet
          userId={userId}
          collections={collections.data ?? []}
          onClose={() => setSaveOpen(false)}
          onSaved={(item) => {
            invalidate();
            setTab("inbox");
            setOpen(item);
          }}
        />
      ) : null}
      {queueOpen ? (
        <QueueSheet
          pool={pool.data ?? []}
          now={now}
          onClose={() => setQueueOpen(false)}
          onOpen={(it) => {
            setQueueOpen(false);
            setOpen(it);
          }}
        />
      ) : null}
      {healthOpen ? (
        <HealthSheet
          pool={pool.data ?? []}
          now={now}
          onClose={() => setHealthOpen(false)}
          onOpen={(it) => {
            setHealthOpen(false);
            setOpen(it);
          }}
        />
      ) : null}
      {removing ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-label="Remove from Watch"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-4">
            <div className="text-sm font-semibold">Remove &ldquo;{removing.title}&rdquo;?</div>
            <p className="mt-1 text-xs text-muted-foreground">
              This deletes your saved reference, notes and moments for it. The video itself is
              untouched on{" "}
              {removing.provider === "internet_archive"
                ? "the Internet Archive"
                : removing.provider}
              .
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setRemoving(null)} className={GHOST}>
                cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await deleteWatchItem(removing.id);
                    invalidate();
                    toast.success("Removed");
                  } catch {
                    toast.error("Couldn't remove it.");
                  }
                  setRemoving(null);
                }}
                className={`${SMALL} border-red-500/50 text-red-300`}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <div className="mx-auto mb-4 max-w-2xl px-4 pt-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground"
      >
        <ArrowLeft className="size-4" /> Channels
      </button>
      <div className="mt-3 text-[11px] uppercase tracking-wider text-primary/80">watch 📺</div>
      <h1 className="font-display text-2xl font-bold">your library</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything you saved from YouTube, Vimeo, Nebula, the Internet Archive and more — with what
        you thought of it.
      </p>
    </div>
  );
}
