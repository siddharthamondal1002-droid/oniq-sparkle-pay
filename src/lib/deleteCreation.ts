import { supabase } from "@/integrations/supabase/client";
import { deleteStoryJob } from "@/components/stories/storyJobsClient";

/**
 * Deleting one thing a person made, whichever of the four kinds it is.
 *
 * ONE CALL SITE FOR FOUR KINDS, and the exhaustive `Record` is the point. The
 * creations screen renders films, songs, pictures and voice clips from four
 * different sources; a fifth kind added to that screen without a delete arm
 * would compile fine and silently do nothing when tapped. Typing this as
 * `Record<CreationKind, …>` makes the compiler refuse the omission instead.
 *
 * FILMS TAKE A DIFFERENT ROUTE, AND THAT IS NOT AN INCONSISTENCY TO TIDY.
 * `delete_story_job` is a RPC that marks the row `purged` and lets the sweep
 * collect the bytes later, because a film's row carries the video-time charge
 * and story-sweep needs `has_bytes` to stay true until the file is actually
 * gone. The other three are edge-function actions that mark `status =
 * "deleted"`, null the path and remove the object inline. Both shapes exist
 * for the same reason — the row is a spend receipt and must outlive the bytes
 * — and both are collapsed to the same result here so the UI has one thing to
 * handle.
 *
 * WHY NOTHING IS "REALLY" DELETED, stated once so nobody later "fixes" it:
 * `image_jobs`, `music_jobs` and `voice_jobs` ARE the daily-cap ledgers. The
 * house cap and the per-user cap both count rows over a rolling 24h and
 * neither filters on `status`, so a hard DELETE would let anyone reset their
 * own cap — and the house's — by deleting in a loop, which is unmetered
 * generation on the owner's key. The person's CONTENT is gone: the bytes are
 * removed and nothing lists the row again. What survives is the fact that a
 * generation happened and was charged.
 */
export type CreationKind = "film" | "song" | "picture" | "clip";

export type DeleteOutcome = { ok: true } | { ok: false; message: string };

/** Which edge function owns each of the three byte-backed kinds. */
const FUNCTION_FOR: Record<Exclude<CreationKind, "film">, string> = {
  picture: "image-generate",
  song: "music-generate",
  clip: "voice-generate",
};

const NOUN: Record<CreationKind, string> = {
  film: "film",
  song: "song",
  picture: "picture",
  clip: "voice clip",
};

/** What to say when a kind's own delete fails without a better reason. */
function generic(kind: CreationKind): string {
  return `Couldn't delete that ${NOUN[kind]}. Try again.`;
}

export async function deleteCreation(kind: CreationKind, id: string): Promise<DeleteOutcome> {
  if (!id.trim()) return { ok: false, message: generic(kind) };

  if (kind === "film") {
    // A film that is still rendering cannot be deleted — the refund question
    // is the owner's and has not been answered — so that case gets its own
    // sentence rather than the generic one, which would read as a bug.
    const res = await deleteStoryJob(id);
    if (res.ok) return { ok: true };
    return {
      ok: false,
      message:
        res.reason === "still-working"
          ? "That one is still being made — it can be deleted once it finishes."
          : generic(kind),
    };
  }

  const { data, error } = await supabase.functions.invoke(FUNCTION_FOR[kind], {
    body: { action: "delete", id },
  });
  // `invoke` reports a non-2xx as `error` with the body unparsed, so the
  // function's own wording is not reliably available here. The message is
  // written for the person rather than forwarded from the server.
  if (error) return { ok: false, message: generic(kind) };
  const deleted = (data as { deleted?: unknown } | null)?.deleted;
  if (typeof deleted !== "string") return { ok: false, message: generic(kind) };
  return { ok: true };
}
