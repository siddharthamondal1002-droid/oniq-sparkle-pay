/**
 * SHARE AND DOWNLOAD, on the result screens the reference draws.
 *
 * THESE ARE THE TWO ACTIONS THAT ARE REAL. The reference draws four —
 * Share, Download, Save, and a contextual one — and this ships the two that
 * do something different from each other, for the same reason Create — Music
 * has no Duration row: a button that does nothing, or that duplicates its
 * neighbour, is worse than an absent one.
 *
 *   Share    -> shareFile: the native share sheet on device, navigator.share
 *               with a real File on the web, and a download as the last
 *               resort so the button is never a dead end.
 *   Download -> deliverFile: the same delivery WITHOUT offering to share. On
 *               native an <a download> cannot save anything from inside a
 *               Capacitor WebView, which is why this goes through the plugin
 *               path rather than an anchor.
 *   Save     -> NOT SHIPPED. On every platform ONIQ targets it is the same
 *               call as Download; two buttons implying a distinction that
 *               does not exist is its own kind of lie. What a person actually
 *               wants to know — that the thing is kept — is stated as a fact
 *               beside these buttons instead, because it is already true the
 *               moment the result exists.
 *
 * THE BYTES ARE FETCHED HERE, not handed over as a URL, because both helpers
 * take a Blob: the signed URL expires and a share sheet that hands somebody a
 * dead link is worse than one that fails loudly now.
 *
 * A CONTEXTUAL FOURTH TILE goes in `children` — the reference draws one on
 * every result screen (Edit on a picture, "Use in Video" on a song). Only the
 * ones with somewhere real to go are passed in; RESULT_TILE is exported so the
 * caller's tile is the same object as these two rather than a near-copy.
 */

import { useState, type ReactNode } from "react";
import { Download, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { deliverFile, isShareCancelled, shareFile } from "@/lib/saveFile";
import { cn } from "@/lib/utils";

/**
 * The tile. Exported so a contextual action passed in as `children` matches
 * exactly — a fourth tile half a pixel off the other three is the sort of
 * thing that only ever gets noticed on somebody's phone.
 *
 * BORDERED, NOT FILLED, and that is a measurement rather than a taste. White
 * on the `create` gradient is 1.81:1 at its cyan end (#22d3ee), measured in a
 * browser 2026-09-04 — a WCAG failure the app carries app-wide on its filled
 * primary buttons. These tiles put the world's colour on the ICON and leave
 * the label in `text-foreground` on the card, which passes comfortably in both
 * themes and still reads as the accent.
 */
export const RESULT_TILE =
  "press inline-flex min-w-[92px] flex-col items-center gap-1.5 rounded-2xl border border-border-strong px-4 py-3 text-[11px] font-semibold normal-case tracking-normal text-foreground disabled:opacity-50";

export function OniqResultActions({
  url,
  filename,
  mime,
  title,
  className,
  children,
}: {
  /** The signed URL the result is served from. */
  url: string;
  filename: string;
  mime: string;
  /** What the share sheet calls it. */
  title: string;
  className?: string;
  /** A contextual fourth tile. Style it with RESULT_TILE. */
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState<"share" | "download" | null>(null);

  const run = async (which: "share" | "download") => {
    if (busy) return;
    setBusy(which);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`http ${res.status}`);
      const blob = await res.blob();
      if (which === "share") await shareFile(filename, mime, blob, { title });
      else await deliverFile(filename, mime, blob);
    } catch (e) {
      // A dismissed share sheet is not a failure and must not be reported as
      // one — the person chose to stop.
      if (!isShareCancelled(e)) {
        toast.error(which === "share" ? "Couldn't share that one." : "Couldn't download that one.");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      {(
        [
          ["share", "Share", Share2],
          ["download", "Download", Download],
        ] as const
      ).map(([id, label, Icon]) => (
        <button
          key={id}
          type="button"
          data-testid={`result-${id}`}
          disabled={busy !== null}
          onClick={() => void run(id)}
          className={RESULT_TILE}
        >
          {busy === id ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            <Icon className="h-5 w-5 text-world" aria-hidden="true" />
          )}
          {label}
        </button>
      ))}
      {children}
    </div>
  );
}
