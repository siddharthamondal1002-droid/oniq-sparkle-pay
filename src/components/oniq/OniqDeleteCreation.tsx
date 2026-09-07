/**
 * DELETE, ON THE SCREEN WHERE THE THING IS.
 *
 * The owner asked for a delete option "in image, voice and music". The first
 * attempt put one on `/app/creations` — a screen NOTHING links to. Its only
 * inbound reference in the whole app is a "back" link from a not-found page,
 * so the control existed, worked, was tested, and could not be reached by
 * anyone who had not typed the URL. That is the same failure this repo already
 * recorded for the UPI entry: a feature is where its doors are, and building
 * it somewhere else is not building it.
 *
 * Image, Voice and Music each already list what you made — all three call
 * `action: "list"` and render a card per row — so the delete belongs on those
 * cards, beside the Open link, which is where a person looking at a thing
 * reaches for it.
 *
 * ONE COMPONENT RATHER THAN THREE COPIES, and it owns its own arm/busy/error
 * state. The version on /app/creations threaded four pieces of state through
 * the parent for each card; repeating that in three more screens is four
 * places for the confirm step to drift apart, and the confirm step is the only
 * thing between a mis-tap and a deletion that cannot be undone.
 *
 * WHAT IT DOES NOT DO is decide what deleting means — `deleteCreation` owns
 * that, and the server it calls MARKS the row rather than removing it because
 * those tables are the daily-cap ledgers. Read the header of
 * `src/lib/deleteCreation.ts` before changing anything here.
 */
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { deleteCreation, type CreationKind } from "@/lib/deleteCreation";

/** "voice clip" reads as a thing; "clip" alone reads as a fragment. */
function nounFor(kind: CreationKind): string {
  return kind === "clip" ? "voice clip" : kind;
}

export function OniqDeleteCreation({
  kind,
  id,
  onDeleted,
  testId,
}: {
  kind: CreationKind;
  id: string;
  /** Remove the row from the caller's list. The server has already marked it. */
  onDeleted: () => void;
  testId: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = nounFor(kind);

  if (error) {
    return (
      <span className="text-[11px] text-destructive" data-testid={`${testId}-error`}>
        {error}
      </span>
    );
  }

  if (!armed) {
    return (
      <button
        type="button"
        data-testid={testId}
        onClick={() => setArmed(true)}
        aria-label={`Delete this ${noun}`}
        className="press ms-auto inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Delete
      </button>
    );
  }

  return (
    <span className="ms-auto flex shrink-0 items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">Delete this {noun}?</span>
      <button
        type="button"
        onClick={() => setArmed(false)}
        disabled={busy}
        className="press rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground"
      >
        Cancel
      </button>
      <button
        type="button"
        data-testid={`${testId}-confirm`}
        disabled={busy}
        onClick={() => {
          if (busy) return;
          setBusy(true);
          void deleteCreation(kind, id).then((res) => {
            setBusy(false);
            // The row leaves the list only on a real success. Removing it
            // optimistically would show the thing gone while it is still
            // there, and the person would find it again on the next load
            // with no idea which state was the true one.
            if (res.ok) onDeleted();
            else setError(res.message);
          });
        }}
        className="press inline-flex items-center gap-1 rounded-lg bg-destructive px-2 py-1 text-[11px] font-semibold text-destructive-foreground disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
        {busy ? "Deleting" : "Delete"}
      </button>
    </span>
  );
}
