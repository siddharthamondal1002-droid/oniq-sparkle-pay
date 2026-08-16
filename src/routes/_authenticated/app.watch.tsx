/**
 * Watch — channels PLAY here now. Owner directive, 2026-08-16 (evening),
 * reversing the link-only posture set earlier the same day. India-only.
 *
 * THE ONE DISTINCTION THE WHOLE SCREEN RESTS ON. Playing means an iframe
 * holding YOUTUBE'S OWN player: YouTube serves the video, serves its ads,
 * enforces its own geo-restrictions and age gates, and the channel owner
 * decides whether embedding is allowed at all. That is a supported use of
 * their player and it leaves ONIQ out of the delivery path entirely.
 *
 * What it must never become is the retired `live-channels` shape: resolving a
 * stream URL server-side — with a spoofed browser User-Agent and a consent
 * cookie, as that function did — and feeding it to a player of ONIQ's own.
 * That strips YouTube's ads, puts ONIQ in the delivery path, and breaks their
 * terms. watchDirectory.test.ts fails if a stream URL is ever fetched, stored
 * or played, which is the line worth guarding rather than "no player".
 *
 * STILL NO THUMBNAILS FROM THE DESTINATION. Easy to add by reflex and it
 * would go further than the embed does: an <img> on the destination's
 * thumbnail host fires the moment the LIST renders, for every row, with no
 * user decision involved. The embed only loads once somebody taps a channel.
 * Both are declared in playCompliance.ts, and the difference between "the
 * user chose this" and "the list did it" is the whole of that declaration.
 * Hence the genre glyph.
 *
 * INDIA-ONLY is enforced in src/data/countryRegistry.ts, not here, so the
 * Home tile and this route agree by construction.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Play, Search, X } from "lucide-react";
import {
  LINK_OUT_LABEL,
  WATCH_NOTICE,
  channelUrl,
  embedUrl,
  watchDirectoryFor,
  type WatchEntry,
  type WatchGenre,
} from "@/data/watchDirectory";
import { openInApp } from "@/lib/miniapps";
import { isAvailable } from "@/data/countryRegistry";
import { useCountry } from "@/lib/country";

export const Route = createFileRoute("/_authenticated/app/watch")({
  component: WatchPage,
});

/**
 * The genre glyph, standing in for artwork we deliberately do not fetch.
 * Order is the order of the filter row.
 */
const GENRES: { key: WatchGenre; label: string; emoji: string }[] = [
  { key: "news", label: "News", emoji: "📰" },
  { key: "sports", label: "Sports", emoji: "🏏" },
  { key: "entertainment", label: "Entertainment", emoji: "🎬" },
  { key: "finance", label: "Finance", emoji: "📈" },
  { key: "influencer", label: "Creators", emoji: "✨" },
  { key: "lifestyle", label: "Lifestyle", emoji: "🌿" },
];

const EMOJI_BY_GENRE = new Map(GENRES.map((g) => [g.key, g.emoji]));

function WatchPage() {
  const [home] = useCountry();
  const [genre, setGenre] = useState<WatchGenre | null>(null);
  const [q, setQ] = useState("");
  /** The channel currently open in the player, or null for the list. */
  const [playing, setPlaying] = useState<WatchEntry | null>(null);

  /**
   * The FULL verified roster, not the India slice.
   *
   * `watchDirectoryFor(null)` returns every verified entry; passing "IN"
   * would drop channels tagged for other markets. The owner gated the SURFACE
   * to India (2026-08-16), not the shelf — an Indian user can still open a
   * British or American channel, which is the whole point of a directory.
   */
  const all = useMemo(() => watchDirectoryFor(null), []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((e) => {
      if (genre && e.genre !== genre) return false;
      if (!needle) return true;
      return (
        e.name.toLowerCase().includes(needle) || e.description.toLowerCase().includes(needle)
      );
    });
  }, [all, genre, q]);

  /** Counts come from the unfiltered roster, so a tab never reads "0" mid-search. */
  const countFor = useMemo(() => {
    const m = new Map<WatchGenre, number>();
    for (const e of all) m.set(e.genre, (m.get(e.genre) ?? 0) + 1);
    return m;
  }, [all]);

  // HOOKS ARE ALL ABOVE THIS RETURN. rules-of-hooks is a release blocker in
  // this repo, and a country check is exactly the kind of early return that
  // tempts a hook underneath it.
  if (!isAvailable("watch", home)) {
    return (
      <div className="min-h-dvh bg-background pb-24 text-foreground">
        <Header />
        <div className="mx-auto max-w-2xl px-4">
          <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
            Watch isn&apos;t in ONIQ where you are yet 🌍
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background pb-24 text-foreground">
      <Header />

      {playing && <Player entry={playing} onClose={() => setPlaying(null)} />}

      <div className="mx-auto max-w-2xl px-4">
        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search channels"
            aria-label="Search channels"
            data-testid="watch-search"
            className="w-full rounded-full border border-border bg-card py-2.5 ps-9 pe-9 text-sm outline-none focus:border-primary"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Genre filter */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          <Chip active={genre === null} onClick={() => setGenre(null)}>
            All {all.length}
          </Chip>
          {GENRES.map((g) => (
            <Chip key={g.key} active={genre === g.key} onClick={() => setGenre(g.key)}>
              {g.emoji} {g.label} {countFor.get(g.key) ?? 0}
            </Chip>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
            nothing here for that 🔍
          </div>
        ) : (
          <ul className="mt-4 space-y-2" data-testid="watch-list">
            {shown.map((e) => (
              <Row
                key={e.channelId ?? e.handle ?? e.name}
                entry={e}
                onPlay={() => setPlaying(e)}
              />
            ))}
          </ul>
        )}

        <p className="mt-4 text-[11px] leading-snug text-muted-foreground">{WATCH_NOTICE}</p>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="mx-auto mb-4 max-w-2xl px-4 pt-4">
      <Link to="/app" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> Home
      </Link>
      <div className="mt-3 text-[11px] uppercase tracking-wider text-primary/80">watch 📺</div>
      <h1 className="font-display text-2xl font-bold">channels, not a channel</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything opens where it lives. ONIQ keeps the list, not the stream.
      </p>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"
      }`}
    >
      {children}
    </button>
  );
}

function Row({ entry, onPlay }: { entry: WatchEntry; onPlay: () => void }) {
  // channelUrl returns null for an entry with neither an id nor a handle.
  // Those are unlinkable, so they are not rendered at all rather than shown
  // as a row that does nothing when tapped.
  const url = channelUrl(entry);
  // An entry known only by @handle cannot have its uploads playlist derived,
  // so it stays link-out and the row says so instead of offering a play
  // button that would open an empty player.
  const canPlay = embedUrl(entry) !== null;
  if (!url) return null;
  return (
    <li>
      <button
        type="button"
        data-testid={canPlay ? "watch-play" : "watch-link"}
        onClick={() => (canPlay ? onPlay() : openInApp(url))}
        aria-label={canPlay ? `Play ${entry.name}` : `${entry.name} — ${LINK_OUT_LABEL}`}
        className="press flex w-full items-start gap-3 rounded-2xl border border-border bg-card p-3 text-left"
      >
        {/* A GLYPH, NOT ARTWORK — see the file header for why the
            destination's own thumbnail host must never appear here. */}
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-lg">
          {EMOJI_BY_GENRE.get(entry.genre) ?? "📺"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{entry.name}</div>
          <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {entry.description}
          </div>
          <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-primary">
            {canPlay ? (
              <>
                Watch here <Play className="size-3" />
              </>
            ) : (
              <>
                {LINK_OUT_LABEL} <ExternalLink className="size-3" />
              </>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

/**
 * YouTube's own player, in a frame, and nothing else.
 *
 * NOTHING HERE TOUCHES THE VIDEO. No stream URL is resolved, stored or
 * proxied; ONIQ hands YouTube a playlist id and gets out of the way. The
 * player's own controls stay intact and nothing is drawn over it — both are
 * conditions of using the embed, and both are the kind of thing a later
 * "improvement" breaks by accident, so they are stated here.
 *
 * `allow` deliberately omits `autoplay`: a directory that starts making noise
 * when you tap it is a bug, and muted-autoplay to dodge that is worse.
 */
function Player({ entry, onClose }: { entry: WatchEntry; onClose: () => void }) {
  const src = embedUrl(entry);
  const url = channelUrl(entry);

  // Escape closes it, and the page behind must not scroll while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`${entry.name} — now playing`}
    >
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close player"
          className="rounded-full bg-white/10 p-2 text-white"
        >
          <X className="size-5" />
        </button>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
          {entry.name}
        </div>
        {url && (
          <button
            type="button"
            onClick={() => openInApp(url)}
            className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white"
          >
            YouTube <ExternalLink className="size-3" />
          </button>
        )}
      </div>

      {/* 16:9, and NOTHING layered on top of the frame. */}
      <div className="mx-auto w-full max-w-3xl px-4">
        <div className="relative w-full overflow-hidden rounded-2xl bg-black pt-[56.25%]">
          <iframe
            data-testid="watch-embed"
            src={src}
            title={entry.name}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        <p className="mt-3 text-[11px] leading-snug text-white/60">{WATCH_NOTICE}</p>
      </div>
    </div>
  );
}
