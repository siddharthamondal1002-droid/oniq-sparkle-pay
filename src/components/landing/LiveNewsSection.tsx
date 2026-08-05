import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, ExternalLink, Pencil, Plus, Radio, Settings, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRegion } from "@/lib/region";
import {
  LINK_OUT_LABEL,
  WATCH_NOTICE,
  channelUrl,
  watchDirectoryFor,
  type WatchGenre,
} from "@/data/watchDirectory";
import { openInApp } from "@/lib/miniapps";


type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  image?: string;
};

function relTime(iso: string): string {
  if (!iso) return "just now";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (isNaN(diffMs)) return "just now";
  const m = Math.max(1, Math.round(diffMs / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function useLiveNews() {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("news", {
          body: { category: "top" },
        });
        if (!alive) return;
        if (error) throw error;
        const list: NewsItem[] = Array.isArray(data?.items) ? data.items.slice(0, 10) : [];
        if (list.length === 0) setFailed(true);
        else setItems(list);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!items || items.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 5000);
    return () => clearInterval(t);
  }, [items]);

  return { items, failed, idx };
}

export function CompactLiveNews() {
  const { items, failed, idx } = useLiveNews();
  const navigate = useNavigate();
  // Both useMemo calls MUST stay above the `failed` early return. Below it the
  // hook count dropped to zero the moment the fetch failed, and React threw
  // "Rendered fewer hooks than expected".
  const others = useMemo(
    () => (items ? items.filter((_, i) => i !== idx) : []),
    [items, idx],
  );
  const tickerText = useMemo(
    () => others.map((it) => `${it.title}  ·  ${it.source}`).join("   •   "),
    [others],
  );
  if (failed) return null;
  const current = items?.[idx];
  return (
    <button
      onClick={() => navigate({ to: "/app/news", search: { tab: undefined } })}
      className="press fade-up group mt-5 block w-full overflow-hidden rounded-2xl border border-primary/25 text-left transition-colors"
      aria-label="Open Pulse news"
      style={{
        background:
          "linear-gradient(135deg, rgba(0,212,184,0.14) 0%, rgba(0,168,232,0.08) 55%, rgba(255,255,255,0.02) 100%), var(--gradient-card)",
        boxShadow:
          "0 0 24px rgba(0,212,184,0.18), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-center gap-3 px-4 pt-3">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-red-500/60 bg-red-500/20 px-2 py-1 text-[11px] font-black uppercase tracking-widest text-red-300 shadow-[0_0_12px_rgba(239,68,68,0.55)]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-80" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          LIVE
        </span>
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">Pulse</span>
        <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-primary/70" />
      </div>
      <div className="min-w-0 px-4 pb-2 pt-1.5">
        {!current ? (
          <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
        ) : (
          <div
            className="truncate font-display text-[17px] font-bold leading-tight tracking-tight text-foreground"
            style={{ textShadow: "0 0 18px rgba(0,212,184,0.25)" }}
          >
            {current.title}
          </div>
        )}
      </div>
      {tickerText && (
        <div className="relative overflow-hidden border-t border-white/5 bg-black/25 py-1.5">
          <div className="oniq-pulse-ticker flex min-w-max whitespace-nowrap text-[11px] font-medium uppercase tracking-wider text-muted-foreground group-hover:[animation-play-state:paused]">
            <span className="px-4">{tickerText}</span>
            <span className="px-4">{tickerText}</span>
          </div>
        </div>
      )}
      <style>{`
        @keyframes oniq-pulse-ticker-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .oniq-pulse-ticker { animation: oniq-pulse-ticker-scroll 45s linear infinite; }
      `}</style>
    </button>
  );
}

// ---- Watch: a LINK-OUT DIRECTORY, not a player ----
//
// Everything that used to live here — the IFrame API loader, the embeddable
// video/playlist ref parser, the Video and LiveGenre shapes — existed to get a
// stream playing inside ONIQ. Nothing plays inside ONIQ any more, so all of it
// is gone. See src/data/watchDirectory.ts for the reasoning.
//
// What a Watch entry is now: a name, a description, and an https link.

export type GenreId = "news" | "sports" | "entertainment" | "finance" | "influencer" | "lifestyle" | "mytv";

/** A single directory row. `url` always leaves the app. */
export type WatchLink = {
  key: string;
  name: string;
  description: string;
  url: string;
};

export type WatchSection = { id: GenreId | string; name: string; emoji: string; links: WatchLink[] };

/**
 * Validate and canonicalise a user-pasted YouTube link.
 *
 * The old parseYouTube() pulled an 11-character video id out so the player
 * could embed it, and built an i.ytimg.com thumbnail URL from it. Both are
 * gone: ONIQ neither embeds the video nor scrapes imagery from the
 * destination. All this needs to establish now is "is this actually a YouTube
 * URL", so the app never renders a link-out to somewhere unexpected.
 *
 * Returns the canonical https URL, or null.
 */
export function normalizeYouTubeLink(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^@[A-Za-z0-9._-]{1,60}$/.test(s)) return `https://www.youtube.com/${s}`;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "youtu.be" && host !== "youtube.com" && host !== "m.youtube.com") return null;
    u.protocol = "https:";
    return u.toString();
  } catch {
    return null;
  }
}

export function useSession() {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setUserId(data.session?.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);
  return userId;
}

/**
 * My TV — the user's own saved channels, as links.
 *
 * This used to call the `videos` action, which returned recent uploads parsed
 * out of each channel's RSS so the player had something to play. Nothing plays
 * now, so the videos action is gone and this reads the saved channel rows
 * directly. Fewer moving parts and no video ids anywhere.
 */
export function useMyTv() {
  const userId = useSession();
  const q = useQuery({
    queryKey: ["my-tv-channels", userId],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_channels")
        .select("channel_id, name")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as { channel_id: string; name: string }[];
    },
  });
  const links: WatchLink[] = (q.data ?? []).map((c) => ({
    key: c.channel_id,
    name: c.name,
    description: "Saved to your My TV",
    url: `https://www.youtube.com/channel/${c.channel_id}`,
  }));
  return { links, isLoggedIn: !!userId };
}

type UserGenreRow = { id: string; name: string; position: number };
type UserChannelRowFull = { id: string; genre_id: string; name: string; youtube_url: string; position: number };

function useUserGenres(userId: string | null) {
  return useQuery({
    queryKey: ["user-watch-genres", userId],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_watch_genres")
        .select("id, name, position")
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as UserGenreRow[];
    },
  });
}

function useUserChannels(userId: string | null, genreDbId: string | null) {
  return useQuery({
    queryKey: ["user-watch-channels", userId, genreDbId],
    enabled: !!userId && !!genreDbId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_watch_channels")
        .select("id, genre_id, name, youtube_url, position")
        .eq("genre_id", genreDbId as string)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as UserChannelRowFull[];
    },
  });
}

/** User rows → link rows. Anything that isn't a YouTube URL is dropped. */
function channelsToLinks(rows: UserChannelRowFull[]): WatchLink[] {
  const out: WatchLink[] = [];
  for (const r of rows) {
    const url = normalizeYouTubeLink(r.youtube_url);
    if (!url) continue;
    out.push({ key: r.id, name: r.name, description: "Your channel", url });
  }
  return out;
}

const BUILT_IN_GENRES: { id: WatchGenre; name: string; emoji: string }[] = [
  { id: "news", name: "News", emoji: "📰" },
  { id: "sports", name: "Sports", emoji: "⚽" },
  { id: "entertainment", name: "Entertainment", emoji: "🎬" },
  { id: "finance", name: "Finance", emoji: "💹" },
  { id: "influencer", name: "Influencer", emoji: "🔥" },
  { id: "lifestyle", name: "Lifestyle", emoji: "🌿" },
];

/**
 * One directory row. The whole tile is the link, and it always leaves ONIQ.
 *
 * `openInApp` hands the URL to the system browser / destination app rather
 * than a WebView, so the user lands in a real browser with a real address bar
 * and YouTube's own session, age-gating and territorial rules apply to them
 * directly. Nothing about the destination renders inside ONIQ — no thumbnail,
 * no title scraped from the page, no preview.
 */
function WatchLinkRow({ link }: { link: WatchLink }) {
  return (
    <li>
      <button
        type="button"
        data-testid="watch-link"
        onClick={() => openInApp(link.url)}
        aria-label={`${link.name} — ${LINK_OUT_LABEL}`}
        className="press flex w-full items-start gap-3 rounded-2xl border border-border bg-card p-3 text-left"
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-lg">
          📺
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{link.name}</div>
          <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {link.description}
          </div>
          <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-primary">
            {LINK_OUT_LABEL} <ExternalLink className="size-3" />
          </div>
        </div>
      </button>
    </li>
  );
}

export function WatchLive() {
  const [genreId, setGenreId] = useState<string>(() => {
    if (typeof window === "undefined") return "news";
    try { return localStorage.getItem("oniq.watch.lastGenre") || "news"; } catch { return "news"; }
  });
  const [manageOpen, setManageOpen] = useState(false);
  const [addGenreOpen, setAddGenreOpen] = useState(false);
  const [addChannelForGenre, setAddChannelForGenre] = useState<{ id: string; name: string } | null>(null);
  const userId = useSession();
  // Region is RELEVANCE ONLY here — see watchDirectoryFor. Hook stays above
  // every early return.
  const [region] = useCurrentRegion();
  const { links: myTvLinks } = useMyTv();
  const userGenresQ = useUserGenres(userId);
  const queryClient = useQueryClient();

  const activeUserGenreId = genreId.startsWith("ug:") ? genreId.slice(3) : null;
  const activeUserChannelsQ = useUserChannels(userId, activeUserGenreId);

  const sections = useMemo<WatchSection[]>(() => {
    const out: WatchSection[] = BUILT_IN_GENRES.map((g) => ({
      id: g.id,
      name: g.name,
      emoji: g.emoji,
      links: watchDirectoryFor(region, g.id).map((e) => ({
        key: e.channelId ?? e.handle ?? e.name,
        name: e.name,
        description: e.description,
        url: channelUrl(e) ?? "",
      })).filter((l) => l.url !== ""),
      // A built-in genre with nothing in it is a dead chip, so it is dropped
      // rather than shown empty. This bites outside India: entertainment and
      // finance are entirely India-scoped rosters, so a viewer in the US used
      // to get a tab that led nowhere. Under the old embed model an empty
      // genre was correct fail-closed behaviour; for a directory it is just a
      // bad directory. User genres are exempt below — they legitimately start
      // empty and carry their own "add channel" affordance.
    })).filter((s) => s.links.length > 0);
    if (myTvLinks.length > 0) {
      out.push({ id: "mytv", name: "My TV", emoji: "📺", links: myTvLinks });
    }
    for (const g of userGenresQ.data ?? []) {
      const rows = activeUserGenreId === g.id ? (activeUserChannelsQ.data ?? []) : [];
      out.push({ id: `ug:${g.id}`, name: g.name, emoji: "🎯", links: channelsToLinks(rows) });
    }
    return out;
  }, [region, myTvLinks, userGenresQ.data, activeUserGenreId, activeUserChannelsQ.data]);

  const activeSection = sections.find((s) => s.id === genreId) ?? sections[0] ?? null;
  const links = activeSection?.links ?? [];
  const isUserGenre = typeof activeSection?.id === "string" && activeSection.id.startsWith("ug:");
  const activeUserGenreDbId = isUserGenre ? (activeSection!.id as string).slice(3) : null;
  const activeUserGenreRow = activeUserGenreDbId
    ? (userGenresQ.data ?? []).find((g) => g.id === activeUserGenreDbId) ?? null
    : null;
  const activeUserChannelRows = isUserGenre ? (activeUserChannelsQ.data ?? []) : [];

  useEffect(() => {
    try {
      if (activeSection?.id) localStorage.setItem("oniq.watch.lastGenre", String(activeSection.id));
    } catch { /* noop */ }
  }, [activeSection?.id]);

  const invalidateUserWatch = () => {
    queryClient.invalidateQueries({ queryKey: ["user-watch-genres"] });
    queryClient.invalidateQueries({ queryKey: ["user-watch-channels"] });
  };

  const renameUserGenre = async (row: UserGenreRow) => {
    const next = window.prompt("Rename genre", row.name)?.trim();
    if (!next || next === row.name) return;
    const { error } = await supabase
      .from("user_watch_genres")
      .update({ name: next.slice(0, 40) })
      .eq("id", row.id);
    if (error) { toast.error("couldn't rename"); return; }
    invalidateUserWatch();
  };

  const deleteUserGenre = async (row: UserGenreRow) => {
    if (!window.confirm(`Delete "${row.name}" and its channels?`)) return;
    const { error } = await supabase.from("user_watch_genres").delete().eq("id", row.id);
    if (error) { toast.error("couldn't delete"); return; }
    setGenreId("news");
    invalidateUserWatch();
  };

  const renameUserChannel = async (row: UserChannelRowFull) => {
    const next = window.prompt("Rename channel", row.name)?.trim();
    if (!next || next === row.name) return;
    const { error } = await supabase
      .from("user_watch_channels")
      .update({ name: next.slice(0, 80) })
      .eq("id", row.id);
    if (error) { toast.error("couldn't rename"); return; }
    invalidateUserWatch();
  };

  const deleteUserChannel = async (row: UserChannelRowFull) => {
    const { error } = await supabase.from("user_watch_channels").delete().eq("id", row.id);
    if (error) { toast.error("couldn't remove"); return; }
    invalidateUserWatch();
  };

  return (
    <div>
      <div className="no-scrollbar mb-3 flex items-center gap-2 overflow-x-auto">
        {sections.map((g) => {
          const active = g.id === activeSection?.id;
          const isUser = typeof g.id === "string" && g.id.startsWith("ug:");
          const userRow = isUser ? (userGenresQ.data ?? []).find((u) => `ug:${u.id}` === g.id) ?? null : null;
          return (
            <div key={g.id} className="relative inline-flex">
              <button
                onClick={() => setGenreId(g.id as string)}
                className={`press whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow-[0_0_16px_-4px_var(--primary)]"
                    : "bg-surface text-muted-foreground border-border hover:text-foreground"
                }`}
              >
                {g.emoji} {g.name}
              </button>
              {isUser && userRow && active && (
                <div className="ms-1 inline-flex items-center gap-0.5">
                  <button
                    onClick={() => renameUserGenre(userRow)}
                    className="press grid h-6 w-6 place-items-center rounded-full bg-surface text-muted-foreground hover:text-foreground border border-border"
                    aria-label={`Rename ${userRow.name}`}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => deleteUserGenre(userRow)}
                    className="press grid h-6 w-6 place-items-center rounded-full bg-surface text-muted-foreground hover:text-red-400 border border-border"
                    aria-label={`Delete ${userRow.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {userId && (
          <button
            data-testid="user-genre-add"
            onClick={() => setAddGenreOpen(true)}
            className="press whitespace-nowrap rounded-full border border-dashed border-border bg-surface px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            aria-label="Add genre"
          >
            <Plus className="h-3 w-3" /> genre
          </button>
        )}
        {userId && (
          <button
            data-testid="mytv-manage"
            onClick={() => setManageOpen(true)}
            className="press whitespace-nowrap rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            aria-label="Manage My TV"
          >
            <Settings className="h-3 w-3" /> My TV
          </button>
        )}
      </div>

      {isUserGenre && activeUserGenreRow && (
        <button
          data-testid="user-channel-add"
          onClick={() => setAddChannelForGenre({ id: activeUserGenreRow.id, name: activeUserGenreRow.name })}
          className="press mb-2 inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground"
          aria-label="Add channel"
        >
          <Plus className="h-3 w-3" /> add channel
        </button>
      )}

      {links.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          {isUserGenre ? "no channels yet — add ur first 📺" : "nothing listed here yet 📺"}
        </div>
      ) : (
        <ul className="space-y-2">
          {links.map((l, i) => {
            const row = isUserGenre ? activeUserChannelRows[i] : null;
            return (
              <div key={l.key} className="relative">
                <WatchLinkRow link={l} />
                {row && (
                  <div className="absolute end-2 top-2 flex gap-1">
                    <button
                      onClick={() => renameUserChannel(row)}
                      className="press grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white hover:text-primary"
                      aria-label={`Rename ${row.name}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => deleteUserChannel(row)}
                      className="press grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white hover:text-red-400"
                      aria-label={`Remove ${row.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-[11px] leading-snug text-muted-foreground">{WATCH_NOTICE}</p>
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground/70">
        ONIQ is not affiliated with these channels and does not host, stream or embed their
        content. Rights-holders can reach us via{" "}
        <Link to="/app/privacy/grievance" className="underline">Privacy → Grievance</Link>{" "}
        (category: Content takedown).
      </p>

      {manageOpen && userId && <MyTvManageSheet onClose={() => setManageOpen(false)} />}
      {addGenreOpen && userId && (
        <AddGenreSheet
          userId={userId}
          existingCount={(userGenresQ.data ?? []).length}
          onClose={() => setAddGenreOpen(false)}
          onCreated={(row) => {
            invalidateUserWatch();
            setGenreId(`ug:${row.id}`);
          }}
        />
      )}
      {addChannelForGenre && userId && (
        <AddChannelSheet
          userId={userId}
          genre={addChannelForGenre}
          existingCount={activeUserChannelRows.length}
          onClose={() => setAddChannelForGenre(null)}
          onAdded={() => { invalidateUserWatch(); }}
        />
      )}
    </div>
  );
}


function AddGenreSheet({
  userId, existingCount, onClose, onCreated,
}: {
  userId: string;
  existingCount: number;
  onClose: () => void;
  onCreated: (row: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const nm = name.trim();
    if (!nm) return;
    if (existingCount >= 20) { toast.error("that's enough genres bestie 😭"); return; }
    setBusy(true);
    const { data, error } = await supabase
      .from("user_watch_genres")
      .insert({ user_id: userId, name: nm.slice(0, 40), position: existingCount })
      .select("id, name")
      .single();
    setBusy(false);
    if (error || !data) { toast.error("couldn't add"); return; }
    toast.success(`${data.name} added 🎯`);
    onCreated(data);
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass w-full max-w-lg rounded-t-3xl border border-border bg-card p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg font-bold">new genre 🎯</div>
          <button onClick={onClose} className="press grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          data-testid="user-genre-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. F1, cooking, chess…"
          maxLength={40}
          className="w-full rounded-full border border-border bg-surface px-4 py-2 text-sm outline-none focus:border-primary"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="press rounded-full border border-border bg-surface px-4 py-2 text-sm">cancel</button>
          <button
            data-testid="user-genre-save"
            onClick={submit}
            disabled={busy || !name.trim()}
            className="press rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "…" : "add"}
          </button>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">{existingCount}/20 genres</div>
      </div>
    </div>
  );
}

function AddChannelSheet({
  userId, genre, existingCount, onClose, onAdded,
}: {
  userId: string;
  genre: { id: string; name: string };
  existingCount: number;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const nm = name.trim();
    const u = url.trim();
    if (!nm || !u) return;
    if (existingCount >= 50) { toast.error("50 channels max per genre — trim it 🧹"); return; }
    const link = normalizeYouTubeLink(u);
    if (!link) { toast.error("paste a YouTube link — it'll open in YouTube 📺"); return; }
    setBusy(true);
    const { error } = await supabase.from("user_watch_channels").insert({
      user_id: userId,
      genre_id: genre.id,
      name: nm.slice(0, 80),
      // Store the canonicalised link, not the raw paste.
      youtube_url: link,
      position: existingCount,
    });
    setBusy(false);
    if (error) { toast.error("couldn't add channel"); return; }
    toast.success(`${nm} added 📺`);
    onAdded();
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass w-full max-w-lg rounded-t-3xl border border-border bg-card p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg font-bold">add to {genre.name} 📺</div>
          <button onClick={onClose} className="press grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2">
          <input
            data-testid="user-channel-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="name (e.g. F1 highlights)"
            maxLength={80}
            className="w-full rounded-full border border-border bg-surface px-4 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            data-testid="user-channel-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="paste youtu.be / youtube.com watch or live link"
            className="w-full rounded-full border border-border bg-surface px-4 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="press rounded-full border border-border bg-surface px-4 py-2 text-sm">cancel</button>
          <button
            data-testid="user-channel-save"
            onClick={submit}
            disabled={busy || !name.trim() || !url.trim()}
            className="press rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "…" : "add"}
          </button>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">{existingCount}/50 in this genre</div>
      </div>
    </div>
  );
}


type UserChannelRow = { channel_id: string; name: string };

function MyTvManageSheet({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const list = useQuery({
    queryKey: ["my-tv-channels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_channels")
        .select("channel_id, name")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as UserChannelRow[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["my-tv-channels"] });
    queryClient.invalidateQueries({ queryKey: ["my-tv-videos"] });
  };

  const addMutation = useMutation({
    mutationFn: async (raw: string) => {
      const existing = list.data ?? [];
      if (existing.length >= 10) throw new Error("cap");
      const { data, error } = await supabase.functions.invoke("my-tv", {
        body: { action: "resolve", input: raw },
      });
      if (error) throw error;
      if (!data?.channelId || !data?.name) throw new Error("notfound");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("auth");
      const { error: insErr } = await supabase
        .from("user_channels")
        .insert({ user_id: u.user.id, channel_id: data.channelId, name: data.name });
      if (insErr) throw insErr;
      return { name: data.name as string };
    },
    onSuccess: ({ name }) => {
      toast.success(`${name} added to My TV 📺`);
      setInput("");
      invalidate();
    },
    onError: (e: any) => {
      if (e?.message === "cap") toast.error("Cap is 10 channels — remove one first");
      else if (e?.message === "notfound") toast.error("Couldn't find that channel — paste the full link");
      else if (e?.code === "23505") toast.error("Already in your My TV");
      else toast.error("Couldn't add that channel");
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (channelId: string) => {
      const { error } = await supabase.from("user_channels").delete().eq("channel_id", channelId);
      if (error) throw error;
    },
    onSuccess: () => { toast("Removed"); invalidate(); },
    onError: () => toast.error("Couldn't remove"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass w-full max-w-lg rounded-t-3xl border border-border bg-card p-5 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg font-bold">My TV 📺</div>
          <button onClick={onClose} className="press grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex gap-2">
          <input
            data-testid="mytv-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="paste a YouTube channel link or @handle"
            className="flex-1 rounded-full border border-border bg-surface px-4 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            data-testid="mytv-add"
            onClick={() => input.trim() && addMutation.mutate(input.trim())}
            disabled={addMutation.isPending || !input.trim()}
            className="press rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {addMutation.isPending ? "…" : "Add"}
          </button>
        </div>
        <div className="mt-4 max-h-72 overflow-y-auto">
          {list.isLoading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">loading…</div>
          ) : (list.data?.length ?? 0) === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Build your own lineup — paste any channel link ✨
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {list.data!.map((c) => (
                <li key={c.channel_id} className="flex items-center justify-between py-2.5">
                  <span className="truncate text-sm text-foreground">{c.name}</span>
                  <button
                    onClick={() => removeMutation.mutate(c.channel_id)}
                    className="press grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-red-400"
                    aria-label={`Remove ${c.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          {(list.data?.length ?? 0)}/10 channels
        </div>
      </div>
    </div>
  );
}



export function LiveNewsSection() {
  const { items, failed, idx } = useLiveNews();

  const tickerItems = useMemo(() => (items ? items.slice(1) : []), [items]);
  const tickerText = useMemo(
    () => tickerItems.map((it) => `${it.title}  ·  ${it.source}`).join("   •   "),
    [tickerItems],
  );

  if (failed) return null;

  const current = items?.[idx];

  const open = (url: string) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="relative overflow-hidden py-16 md:py-20">
      <div className="pointer-events-none absolute -left-24 top-10 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-10 h-72 w-72 rounded-full bg-fuchsia-500/15 blur-3xl" />

      <div className="relative mx-auto max-w-6xl px-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            LIVE
          </span>
          <h2 className="font-display text-2xl font-bold md:text-3xl">
            Pulse <span aria-hidden>📰</span>{" "}
            <span className="text-muted-foreground">— happening right now</span>
          </h2>
        </div>

        <div className="mt-6 rounded-3xl border border-border bg-[image:var(--gradient-card)] p-6 md:p-8 shadow-card">
          {!items ? (
            <div className="animate-pulse space-y-4">
              <div className="h-4 w-32 rounded bg-muted" />
              <div className="h-8 w-3/4 rounded bg-muted" />
              <div className="h-8 w-2/3 rounded bg-muted" />
              <div className="h-4 w-40 rounded bg-muted" />
            </div>
          ) : (
            current && (
              <div className="min-h-[9rem] flex gap-6">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 font-semibold text-primary">
                      <Radio className="h-3 w-3" /> {current.source}
                    </span>
                    <span className="text-muted-foreground">{relTime(current.publishedAt)}</span>
                  </div>
                  <button
                    key={idx}
                    onClick={() => open(current.link)}
                    className="mt-4 block w-full text-left font-display text-2xl font-bold leading-snug tracking-tight animate-fade-in md:text-4xl hover:text-primary transition-colors"
                  >
                    {current.title}
                  </button>
                  <div className="mt-6 flex items-center gap-1.5">
                    {items.map((_, i) => (
                      <span
                        key={i}
                        className={`h-1 rounded-full transition-all ${
                          i === idx ? "w-6 bg-primary" : "w-1.5 bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                </div>
                {current.image && (
                  <img
                    key={current.image}
                    src={current.image}
                    alt=""
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    className="hidden md:block h-40 w-56 shrink-0 rounded-2xl object-cover animate-fade-in"
                  />
                )}
              </div>
            )
          )}
        </div>

        {/* Watch Live */}
        <div className="mt-8">
          <div className="mb-3 text-sm font-semibold text-foreground">
            Watch Live <span aria-hidden>📺</span>
          </div>
          <WatchLive />
        </div>

        {tickerText && (
          <div
            className="group relative mt-6 overflow-hidden rounded-full border border-border bg-surface/60 py-2.5"
            aria-label="More headlines"
          >
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-background to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-background to-transparent" />
            <div className="oniq-ticker-track flex min-w-max whitespace-nowrap text-sm text-muted-foreground group-hover:[animation-play-state:paused]">
              {[0, 1].map((k) => (
                <div key={k} className="flex shrink-0 items-center gap-6 px-6" aria-hidden={k === 1}>
                  {tickerItems.map((it, i) => (
                    <button
                      key={`${k}-${i}`}
                      onClick={() => open(it.link)}
                      className="hover:text-primary transition-colors"
                    >
                      <span className="font-medium text-foreground">{it.title}</span>
                      <span className="ml-2 text-primary">· {it.source}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-center">
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 glow"
          >
            Read it all in ONIQ <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <style>{`
        @keyframes oniq-ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .oniq-ticker-track { animation: oniq-ticker 45s linear infinite; }
      `}</style>
    </section>
  );
}
