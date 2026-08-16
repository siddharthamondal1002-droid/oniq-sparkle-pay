/**
 * My TV and user-made genres — the reader half.
 *
 * Owner directive, 2026-08-16 (evening): "check for that my tv in genre list,
 * add genre". Both existed before Watch was removed at d879305b and both are
 * recovered here from that commit's parent rather than reinvented. The caps
 * below (10 My TV channels, 20 genres, 50 channels per genre) are the ORIGINAL
 * numbers read out of that code — they are not new limits chosen here, which
 * would be an owner call under CLAUDE.md.
 *
 * THREE TABLES SURVIVED THE REMOVAL, WITH THEIR ROW-LEVEL SECURITY INTACT:
 *
 *   user_channels        — My TV. (user_id, channel_id, name). 11 rows across
 *                          6 accounts on 2026-08-16, every channel_id a valid
 *                          `UC…`. Real people curated these and lost sight of
 *                          them when Watch went away; nothing was deleted.
 *   user_watch_genres    — a user's own genre names. Empty.
 *   user_watch_channels  — the links inside those genres. Empty.
 *
 * WHAT IS DELIBERATELY NOT RESTORED: the `my-tv` edge function. It resolved a
 * pasted reference by fetching YouTube with a spoofed browser User-Agent and a
 * consent cookie, and its own comments admitted a bare @handle could not be
 * resolved without either the Data API or a scrape. None of that is needed. A
 * URL that contains a channel id already contains the answer, so the id is
 * read out of the string here — no request, no key, no scrape — and a paste
 * with no id in it is refused with a message saying what to paste instead,
 * which is exactly what that function decided to do in the end.
 *
 * NO THUMBNAILS, and this is a change from the original. The old
 * channelsToVideos built `i.ytimg.com/vi/<id>/hqdefault.jpg` for every row,
 * which fires a request to Google's thumbnail host the moment a LIST renders,
 * for every entry, with no user decision involved. That is further than the
 * embed goes and it is declared as not happening in playCompliance.ts. Cards
 * carry a glyph, the same as the rest of Watch.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { playableOfChannelId, type Playable } from "@/data/watchDirectory";

/** Original caps, recovered from d879305b^. Not set here. */
export const MAX_MYTV_CHANNELS = 10;
export const MAX_USER_GENRES = 20;
export const MAX_CHANNELS_PER_GENRE = 50;

/** A user genre's chip id. Namespaced so it can never collide with a built-in. */
export const USER_GENRE_PREFIX = "ug:";
/** The My TV chip's id. */
export const MYTV_GENRE_ID = "mytv";

export type UserGenreRow = { id: string; name: string; position: number };
export type UserChannelRow = {
  id: string;
  genre_id: string;
  name: string;
  youtube_url: string;
  position: number;
};
export type MyTvRow = { channel_id: string; name: string };

/**
 * Parse a YouTube URL / id into an embeddable ref. Verbatim from d879305b^.
 *
 * Returns { kind: 'video', id } or { kind: 'list', id }, or null if unusable.
 * A channel PAGE returns null on purpose: there is nothing to autoplay at a
 * channel's front door, and the original said so in the error it showed.
 */
export function parseYouTube(raw: string): { kind: "video" | "list"; id: string } | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const bare = /^[\w-]{11}$/.exec(s);
  if (bare) return { kind: "video", id: s };
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id && /^[\w-]{11}$/.test(id)) return { kind: "video", id };
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "watch") {
        const v = u.searchParams.get("v");
        if (v && /^[\w-]{11}$/.test(v)) return { kind: "video", id: v };
      }
      if ((parts[0] === "live" || parts[0] === "embed" || parts[0] === "shorts") && parts[1]) {
        const id = parts[1];
        if (/^[\w-]{11}$/.test(id)) return { kind: "video", id };
      }
      if (parts[0] === "playlist") {
        const list = u.searchParams.get("list");
        if (list) return { kind: "list", id: list };
      }
      const list = u.searchParams.get("list");
      if (list && !u.searchParams.get("v")) return { kind: "list", id: list };
    }
  } catch {
    /* noop */
  }
  return null;
}

/**
 * A channel id out of whatever the user pasted — WITHOUT asking YouTube.
 *
 * The id is 24 characters starting `UC`, and it appears literally in a
 * /channel/ URL. A pasted @handle has no id in it, so this returns null and
 * the caller says what to paste instead. That refusal is the honest failure;
 * the old edge function's scrape was the bug.
 */
export function channelIdFrom(raw: string): string | null {
  const m = (raw ?? "").trim().match(/(UC[A-Za-z0-9_-]{22})/);
  return m ? m[1] : null;
}

/** A user-genre channel row as something the player can take. */
export function playableOfUserChannel(row: UserChannelRow): Playable | null {
  const parsed = parseYouTube(row.youtube_url);
  if (!parsed) return null;
  return parsed.kind === "list"
    ? { kind: "playlist", list: parsed.id, name: row.name }
    : { kind: "video", videoId: parsed.id, name: row.name };
}

/** A My TV row as something the player can take. */
export function playableOfMyTv(row: MyTvRow): Playable | null {
  return playableOfChannelId(row.channel_id, row.name);
}

/**
 * The signed-in user's id.
 *
 * `getSession` rather than `getUser`: the former reads the stored session,
 * the latter makes a network round-trip that can hang, and this gates UI.
 */
export function useSession(): string | null {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setUserId(data.session?.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return userId;
}

/** My TV. Row-level security scopes it to the caller; no user_id filter needed. */
export function useMyTv(userId: string | null) {
  return useQuery({
    queryKey: ["my-tv-channels", userId],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_channels")
        .select("channel_id, name")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MyTvRow[];
    },
  });
}

export function useUserGenres(userId: string | null) {
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

export function useUserChannels(userId: string | null, genreDbId: string | null) {
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
      return (data ?? []) as UserChannelRow[];
    },
  });
}
