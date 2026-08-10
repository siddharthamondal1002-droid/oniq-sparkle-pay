/**
 * Reading and collecting a user's Stories, shared by the studio and the library.
 *
 * ONE COPY, because the two screens ask the same questions and a second copy
 * would answer them differently. The studio needs "is the thing I just started
 * still running", the library needs "what have I got", and both need the same
 * three-step collection dance — and that dance is the part with a purge at the
 * end of it, which is not a thing to reimplement twice.
 *
 * WHY THE CASTS. `story_jobs` is not in the generated Supabase types yet: the
 * migration that creates it has been applied to the live project, but
 * `src/integrations/supabase/types.ts` is generated and has not been
 * regenerated. Narrowed to this file rather than smeared across two components,
 * and to be deleted the moment the types catch up — if it outlives that, it is
 * hiding a real name mismatch rather than a timing one.
 */
import { supabase } from "@/integrations/supabase/client";

/** Every state a Story can be in that is not gone. */
export const OPEN_STATUSES = [
  "queued",
  "generating",
  "assembling",
  "ready",
  "delivering",
] as const;

/** Statuses where nothing more will change without the user doing something. */
export const SETTLED: ReadonlySet<string> = new Set([
  "ready",
  "delivering",
  "delivered",
  "purged",
  "failed",
]);

/** A Story is collectable when there are bytes to collect. */
export function isWatchable(status: string): boolean {
  return status === "ready" || status === "delivering";
}

/**
 * What the user is told while they wait.
 *
 * Named per status rather than one spinner because these steps take minutes —
 * about 4.5 minutes of render per minute of film, measured — and a progress
 * message that never changes is indistinguishable from a hang.
 */
export const PROGRESS: Record<string, string> = {
  queued: "Waiting for a free renderer…",
  generating: "Ting is writing your film, and drawing every shot…",
  assembling: "Putting it together — this is the slow part.",
};

export type StoryJobRow = {
  id: string;
  status: string;
  prompt: string | null;
  requested_seconds: number | null;
  shot_count: number | null;
  error: string | null;
  created_at: string;
};

type Q = {
  from: (t: string) => {
    select: (c: string) => Record<string, (...a: never[]) => unknown>;
  };
};

function jobs() {
  return (supabase as unknown as Q).from("story_jobs");
}

const COLUMNS = "id,status,prompt,requested_seconds,shot_count,error,created_at";

/**
 * Every Story of the caller's that still exists, newest first.
 *
 * `purged` is excluded because a purged row is a receipt, not a video — its
 * bytes are gone by definition and listing it would offer the user a play
 * button for nothing. `delivered` is excluded for the same reason: it means
 * saved-and-deleted, which is the successful end of the story.
 *
 * RLS scopes this to the caller. There is deliberately no user_id filter here —
 * adding one would imply the policy might not hold, and a client-side filter is
 * not what keeps other people's films out of this list.
 */
export async function listStories(limit = 20): Promise<StoryJobRow[]> {
  const q = jobs().select(COLUMNS) as unknown as {
    in: (c: string, v: readonly string[]) => {
      order: (c: string, o: { ascending: boolean }) => {
        limit: (n: number) => Promise<{ data: unknown }>;
      };
    };
  };
  const { data } = await q
    .in("status", [...OPEN_STATUSES, "failed"])
    .order("created_at", { ascending: false })
    .limit(limit);
  return Array.isArray(data) ? (data as StoryJobRow[]) : [];
}

/** One job by id, for the studio watching the Story it just started. */
export async function readJobRow(id: string): Promise<StoryJobRow | null> {
  const q = jobs().select(COLUMNS) as unknown as {
    eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> };
  };
  const { data } = await q.eq("id", id).maybeSingle();
  return (data as StoryJobRow | null) ?? null;
}

/** The newest Story still in flight or waiting to be collected. */
export async function latestOpenJob(): Promise<StoryJobRow | null> {
  const q = jobs().select(COLUMNS) as unknown as {
    in: (c: string, v: readonly string[]) => {
      order: (c: string, o: { ascending: boolean }) => {
        limit: (n: number) => {
          maybeSingle: () => Promise<{ data: unknown }>;
        };
      };
    };
  };
  const { data } = await q
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as StoryJobRow | null) ?? null;
}

type DeliverAction = "start" | "done" | "cancel";

async function deliver(action: DeliverAction, jobId: string) {
  const { data, error } = await supabase.functions.invoke("story-deliver", {
    body: { action, jobId },
  });
  const payload = (data ?? {}) as { url?: string; error?: string };
  if (error || payload.error) {
    throw new Error(payload.error ?? error?.message ?? "Could not reach your film.");
  }
  return payload;
}

/**
 * Open a finished Story and get a short-lived URL for it.
 *
 * Moves the job `ready -> delivering`. ONE URL serves both the preview and the
 * save, because they are the same bytes and issuing two would be two chances to
 * leak the same film.
 */
export async function openStory(jobId: string): Promise<string> {
  const { url } = await deliver("start", jobId);
  if (!url) throw new Error("No link came back for that film.");
  return url;
}

/** Put a Story back so a dropped download does not cost somebody their film. */
export async function releaseStory(jobId: string): Promise<void> {
  await deliver("cancel", jobId).catch(() => undefined);
}

/**
 * Save a Story to the device, then delete it from ours — in that order.
 *
 * FETCHED AS A BLOB, NOT LINKED. A cross-origin href ignores the `download`
 * attribute and opens the video in a tab instead, which on a phone means it was
 * never saved at all.
 *
 * The purge is not a background job: the screen promises deletion BEFORE anyone
 * spends a second of their allowance, and a promise made before the action has
 * to be kept by the action.
 */
export async function saveStoryToDevice(jobId: string, url: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `oniq-story-${jobId.slice(0, 8)}.mp4`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
  await deliver("done", jobId);
}
