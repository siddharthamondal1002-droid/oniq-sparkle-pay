/**
 * Watch — the channel DIRECTORY. Resurfaced 2026-08-16 (owner directive),
 * India-only, and still not a player.
 *
 * WHAT THIS SCREEN MAY NOT DO, and why it is worth saying in the file rather
 * than only in the data module it reads:
 *
 *   - IT MUST NOT PLAY, EMBED OR PROXY ANYTHING. Streaming rights are
 *     territorial, so serving a stream is infringement by ONIQ rather than by
 *     the platform, and an embed re-imposes YouTube's player terms on top.
 *     The whole of Watch is a list of names, descriptions and https links;
 *     the tests in src/data/__tests__/watchDirectory.test.ts assert the
 *     ABSENCE of a player rather than the correctness of one.
 *
 *   - IT MUST NOT LOAD YOUTUBE THUMBNAILS. This one is easy to add by reflex
 *     and it would undo a Play data-safety decision: an <img> pointed at
 *     i.ytimg.com fires the moment the list renders, sending every viewer's
 *     IP and user-agent to Google with no user decision involved — exactly
 *     the "automatic request" entry that was REMOVED from
 *     src/config/playCompliance.ts when the embed went. A destination the
 *     user taps is not a request ONIQ makes; an image the list fetches is.
 *     Hence the genre glyph instead of artwork.
 *
 * INDIA-ONLY is enforced in src/data/countryRegistry.ts, not here, so the
 * Home tile and this route agree by construction. The gate is a product
 * decision, not a rights control — nothing here is territorially licensed
 * precisely because nothing plays.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Search, X } from "lucide-react";
import {
  LINK_OUT_LABEL,
  WATCH_NOTICE,
  channelUrl,
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
              <Row key={e.channelId ?? e.handle ?? e.name} entry={e} />
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

function Row({ entry }: { entry: WatchEntry }) {
  // channelUrl returns null for an entry with neither an id nor a handle.
  // Those are unlinkable, so they are not rendered at all rather than shown
  // as a row that does nothing when tapped.
  const url = channelUrl(entry);
  if (!url) return null;
  return (
    <li>
      <button
        type="button"
        data-testid="watch-link"
        onClick={() => openInApp(url)}
        aria-label={`${entry.name} — ${LINK_OUT_LABEL}`}
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
            {LINK_OUT_LABEL} <ExternalLink className="size-3" />
          </div>
        </div>
      </button>
    </li>
  );
}
