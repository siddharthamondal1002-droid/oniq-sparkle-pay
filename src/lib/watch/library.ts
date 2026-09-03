/**
 * ONIQ Watch library — the data layer.
 *
 * Every read and write goes through the user's own Supabase session, so
 * row-level security (supabase/migrations/20260903150000_watch_library.sql)
 * scopes all of it to the caller. Lists are keyset-paginated: a page carries
 * the cursor for the next one, and nothing here ever loads a whole library.
 */
import { supabase } from "@/integrations/supabase/client";
import type { WatchProviderId } from "@/lib/watch/providers";
import type {
  SaveReason,
  WatchCollection,
  WatchItem,
  WatchMoment,
  WatchState,
  WatchThread,
} from "@/lib/watch/types";

export const PAGE_SIZE = 40;
/** The most rows a health or resurface pass reads; above this the screen says it is a sample. */
export const ANALYSIS_CAP = 1000;

export type ListOrder = "saved" | "watched";

export type ListFilters = {
  state?: WatchState | "all";
  provider?: WatchProviderId;
  unfinished?: boolean;
  completed?: boolean;
  minSeconds?: number;
  maxSeconds?: number;
  query?: string;
  reason?: SaveReason;
  priorityMin?: number;
  savedAfter?: string;
  /** Restrict to these ids (a collection's or thread's members). Empty = nothing. */
  ids?: string[];
};

export type Cursor = { savedAt: string; id: string } | null;

export type Page = { items: WatchItem[]; next: Cursor };

/** PostgREST filter values cannot carry these safely; a query is words, not syntax. */
function scrub(q: string): string {
  return q
    .replace(/[,()%\\"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function listWatchItems(
  filters: ListFilters,
  cursor: Cursor,
  order: ListOrder = "saved",
  limit = PAGE_SIZE,
): Promise<Page> {
  if (filters.ids && filters.ids.length === 0) return { items: [], next: null };
  let q = supabase.from("watch_items").select("*");
  if (filters.ids) q = q.in("id", filters.ids.slice(0, 500));
  if (filters.state && filters.state !== "all") q = q.eq("state", filters.state);
  if (filters.provider) q = q.eq("provider", filters.provider);
  if (filters.unfinished) q = q.gt("position_seconds", 0).is("completed_at", null);
  if (filters.completed === true) q = q.not("completed_at", "is", null);
  if (filters.completed === false) q = q.is("completed_at", null);
  if (filters.minSeconds) q = q.gte("duration_seconds", filters.minSeconds);
  if (filters.maxSeconds) q = q.lte("duration_seconds", filters.maxSeconds);
  if (filters.reason) q = q.eq("reason", filters.reason);
  if (filters.priorityMin) q = q.gte("priority", filters.priorityMin);
  if (filters.savedAfter) q = q.gte("saved_at", filters.savedAfter);
  const words = filters.query ? scrub(filters.query) : "";
  if (words) {
    q = q.or(`title.ilike.%${words}%,creator.ilike.%${words}%,notes.ilike.%${words}%`);
  }
  const col = order === "watched" ? "last_watched_at" : "saved_at";
  if (cursor) {
    q = q.or(`${col}.lt.${cursor.savedAt},and(${col}.eq.${cursor.savedAt},id.lt.${cursor.id})`);
  }
  if (order === "watched") q = q.not("last_watched_at", "is", null);
  const { data, error } = await q
    .order(col, { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) throw error;
  const rows = (data ?? []) as WatchItem[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const next: Cursor =
    rows.length > limit && last
      ? {
          savedAt: (order === "watched" ? last.last_watched_at : last.saved_at) as string,
          id: last.id,
        }
      : null;
  return { items: page, next };
}

/** Everything a person has started and not finished, most recent first. */
export async function listContinue(limit = 30): Promise<WatchItem[]> {
  const { data, error } = await supabase
    .from("watch_items")
    .select("*")
    .gt("position_seconds", 0)
    .is("completed_at", null)
    .neq("state", "archived")
    .order("last_watched_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as WatchItem[];
}

/** A bounded slice of the active library for the pure analyses (resurface, queue, health). */
export async function listAnalysisPool(limit = ANALYSIS_CAP): Promise<WatchItem[]> {
  const { data, error } = await supabase
    .from("watch_items")
    .select("*")
    .neq("state", "archived")
    .order("saved_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as WatchItem[];
}

export async function getWatchItem(id: string): Promise<WatchItem | null> {
  const { data, error } = await supabase.from("watch_items").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as WatchItem | null) ?? null;
}

export type SaveInput = {
  provider: WatchProviderId;
  contentId: string;
  canonicalUrl: string;
  title: string;
  creator?: string | null;
  durationSeconds?: number | null;
  thumbnailUrl?: string | null;
  reason?: SaveReason | null;
  rights?: unknown;
  metadata?: Record<string, unknown>;
  state?: WatchState;
};

export type SaveOutcome = { item: WatchItem; existed: boolean };

/**
 * Save a reference. The unique key (user, provider, content id) turns a
 * second save of the same thing into the existing row rather than a twin —
 * the one kind of duplicate the database itself refuses.
 */
export async function saveWatchItem(userId: string, input: SaveInput): Promise<SaveOutcome> {
  const row = {
    user_id: userId,
    provider: input.provider,
    content_id: input.contentId,
    canonical_url: input.canonicalUrl,
    title: input.title.trim().slice(0, 200),
    creator: input.creator?.trim().slice(0, 120) || null,
    duration_seconds:
      input.durationSeconds && input.durationSeconds > 0 ? Math.round(input.durationSeconds) : null,
    thumbnail_url: input.thumbnailUrl?.slice(0, 500) || null,
    reason: input.reason ?? null,
    rights: (input.rights as never) ?? null,
    metadata: (input.metadata ?? {}) as never,
    state: input.state ?? "inbox",
  };
  const { data, error } = await supabase.from("watch_items").insert(row).select("*").single();
  if (!error) return { item: data as WatchItem, existed: false };
  if (error.code === "23505") {
    const { data: existing, error: e2 } = await supabase
      .from("watch_items")
      .select("*")
      .eq("provider", input.provider)
      .eq("content_id", input.contentId)
      .maybeSingle();
    if (e2) throw e2;
    if (existing) return { item: existing as WatchItem, existed: true };
  }
  throw error;
}

export type ItemPatch = Partial<
  Pick<
    WatchItem,
    | "title"
    | "creator"
    | "duration_seconds"
    | "state"
    | "reason"
    | "priority"
    | "notes"
    | "tags"
    | "topics"
    | "duplicate_group_id"
    | "completed_at"
    | "position_seconds"
    | "last_watched_at"
    | "resurface_dismissed_at"
    | "resurface_dismissals"
  >
> & { rights?: unknown; metadata?: Record<string, unknown> };

export async function updateWatchItem(id: string, patch: ItemPatch): Promise<WatchItem> {
  const { data, error } = await supabase
    .from("watch_items")
    .update(patch as never)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as WatchItem;
}

export async function deleteWatchItem(id: string): Promise<void> {
  const { error } = await supabase.from("watch_items").delete().eq("id", id);
  if (error) throw error;
}

/** Past this fraction of the length, a video counts as finished. */
export const COMPLETE_AT = 0.95;

/** Record where playback is. Completes the item when it is effectively over. */
export async function setWatchProgress(
  item: Pick<WatchItem, "id" | "duration_seconds" | "completed_at">,
  positionSeconds: number,
  durationSeconds?: number | null,
): Promise<WatchItem> {
  const duration =
    durationSeconds && durationSeconds > 0 ? Math.round(durationSeconds) : item.duration_seconds;
  const position = Math.max(0, Math.round(positionSeconds));
  const done = !!duration && position >= duration * COMPLETE_AT;
  return updateWatchItem(item.id, {
    position_seconds: done ? (duration ?? position) : position,
    duration_seconds: duration ?? null,
    last_watched_at: new Date().toISOString(),
    completed_at: done ? (item.completed_at ?? new Date().toISOString()) : null,
  });
}

export async function markCompleted(id: string, completed: boolean): Promise<WatchItem> {
  return updateWatchItem(id, {
    completed_at: completed ? new Date().toISOString() : null,
    last_watched_at: new Date().toISOString(),
    ...(completed ? {} : { position_seconds: 0 }),
  });
}

export async function dismissResurface(item: WatchItem): Promise<WatchItem> {
  return updateWatchItem(item.id, {
    resurface_dismissed_at: new Date().toISOString(),
    resurface_dismissals: item.resurface_dismissals + 1,
  });
}

/** Group (or ungroup, with null) items the user confirmed are the same video. */
export async function setDuplicateGroup(ids: string[], groupId: string | null): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("watch_items")
    .update({ duplicate_group_id: groupId })
    .in("id", ids);
  if (error) throw error;
}

/* ---------------- collections ---------------- */

export async function listCollections(): Promise<WatchCollection[]> {
  const { data, error } = await supabase
    .from("watch_collections")
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as WatchCollection[];
}

export async function createCollection(userId: string, name: string): Promise<WatchCollection> {
  const { data, error } = await supabase
    .from("watch_collections")
    .insert({ user_id: userId, name: name.trim().slice(0, 60) })
    .select("*")
    .single();
  if (error) throw error;
  return data as WatchCollection;
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from("watch_collections")
    .update({ name: name.trim().slice(0, 60) })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCollection(id: string): Promise<void> {
  const { error } = await supabase.from("watch_collections").delete().eq("id", id);
  if (error) throw error;
}

export type Link = { parentId: string; itemId: string; position: number };

/** Every collection membership of the caller, bounded. Small rows, so one read serves counts and toggles. */
export async function listCollectionLinks(): Promise<Link[]> {
  const { data, error } = await supabase
    .from("watch_collection_items")
    .select("collection_id,item_id,position")
    .limit(5000);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    parentId: r.collection_id,
    itemId: r.item_id,
    position: r.position,
  }));
}

export async function addToCollection(
  userId: string,
  collectionId: string,
  itemId: string,
): Promise<void> {
  const { error } = await supabase
    .from("watch_collection_items")
    .upsert(
      { user_id: userId, collection_id: collectionId, item_id: itemId },
      { onConflict: "collection_id,item_id" },
    );
  if (error) throw error;
}

export async function removeFromCollection(collectionId: string, itemId: string): Promise<void> {
  const { error } = await supabase
    .from("watch_collection_items")
    .delete()
    .eq("collection_id", collectionId)
    .eq("item_id", itemId);
  if (error) throw error;
}

/* ---------------- threads ---------------- */

export async function listThreads(): Promise<WatchThread[]> {
  const { data, error } = await supabase
    .from("watch_threads")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as WatchThread[];
}

export async function createThread(
  userId: string,
  name: string,
  description?: string,
): Promise<WatchThread> {
  const { data, error } = await supabase
    .from("watch_threads")
    .insert({
      user_id: userId,
      name: name.trim().slice(0, 80),
      description: description?.trim().slice(0, 1000) || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as WatchThread;
}

export async function deleteThread(id: string): Promise<void> {
  const { error } = await supabase.from("watch_threads").delete().eq("id", id);
  if (error) throw error;
}

export async function listThreadLinks(): Promise<Link[]> {
  const { data, error } = await supabase
    .from("watch_thread_items")
    .select("thread_id,item_id,position")
    .limit(5000);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    parentId: r.thread_id,
    itemId: r.item_id,
    position: r.position,
  }));
}

export async function addToThread(
  userId: string,
  threadId: string,
  itemId: string,
  position: number,
): Promise<void> {
  const { error } = await supabase
    .from("watch_thread_items")
    .upsert(
      { user_id: userId, thread_id: threadId, item_id: itemId, position },
      { onConflict: "thread_id,item_id" },
    );
  if (error) throw error;
}

export async function removeFromThread(threadId: string, itemId: string): Promise<void> {
  const { error } = await supabase
    .from("watch_thread_items")
    .delete()
    .eq("thread_id", threadId)
    .eq("item_id", itemId);
  if (error) throw error;
}

/* ---------------- moments ---------------- */

export async function listMoments(itemId: string): Promise<WatchMoment[]> {
  const { data, error } = await supabase
    .from("watch_moments")
    .select("*")
    .eq("item_id", itemId)
    .order("at_seconds", { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as WatchMoment[];
}

export async function addMoment(
  userId: string,
  itemId: string,
  atSeconds: number,
  note: string | null,
  collectionId: string | null,
): Promise<WatchMoment> {
  const { data, error } = await supabase
    .from("watch_moments")
    .insert({
      user_id: userId,
      item_id: itemId,
      at_seconds: Math.max(0, Math.round(atSeconds)),
      note: note?.trim().slice(0, 500) || null,
      collection_id: collectionId,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as WatchMoment;
}

export async function deleteMoment(id: string): Promise<void> {
  const { error } = await supabase.from("watch_moments").delete().eq("id", id);
  if (error) throw error;
}

/* ---------------- edge functions ---------------- */

export type ResolvedMeta = {
  resolved: boolean;
  reason?: string;
  title?: string;
  creator?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  /** Raw Archive rights fields, classified on the client by src/lib/watch/rights.ts. */
  archive?: { licenseurl?: string; rights?: string; possibleCopyrightStatus?: string };
  metadata?: Record<string, unknown>;
};

/** Server-side metadata lookup on the provider's own public endpoint. */
export async function resolveWatchRef(
  provider: WatchProviderId,
  contentId: string,
): Promise<ResolvedMeta> {
  const { data, error } = await supabase.functions.invoke("watch-resolve", {
    body: { action: "resolve", provider, contentId },
  });
  if (error) return { resolved: false, reason: "lookup unavailable" };
  return (data ?? { resolved: false, reason: "empty" }) as ResolvedMeta;
}

export type ArchiveBrowseRow = {
  identifier: string;
  title: string;
  creator?: string;
  year?: string;
  licenseurl?: string;
  rights?: string;
  possibleCopyrightStatus?: string;
};

export async function browseArchive(category: string): Promise<ArchiveBrowseRow[]> {
  const { data, error } = await supabase.functions.invoke("watch-resolve", {
    body: { action: "browse", category },
  });
  if (error) throw error;
  const rows = (data as { rows?: ArchiveBrowseRow[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

export type AskResult = {
  ok: boolean;
  answer?: string;
  reason?: string;
  basis?: { items: number; notes: boolean; moments: number };
};

export async function askWatch(body: {
  mode: "item" | "library";
  itemId?: string;
  question: string;
  task?: "ask" | "summarize";
}): Promise<AskResult> {
  const { data, error } = await supabase.functions.invoke("watch-ask", { body });
  if (error) return { ok: false, reason: "unavailable" };
  return (data ?? { ok: false, reason: "empty" }) as AskResult;
}
