import { Phone, HeartHandshake, X } from "lucide-react";
import { CRISIS_LINES } from "@/lib/selfHarm";

/**
 * Supportive interstitial (L4). Shown when a user's own draft suggests they
 * may be struggling. Non-blocking and non-punitive: the post still goes
 * through, nothing is deleted or reported, and dismissing is one tap.
 */
export function CrisisSupportSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl border-t border-border bg-card p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/15 text-primary">
            <HeartHandshake className="h-5 w-5" />
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 className="mt-3 font-display text-lg font-bold">you matter. fr. 💙</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          If things feel heavy right now, you don't have to carry it alone. These lines are
          free, confidential, and answer 24×7 — in your language.
        </p>
        <div className="mt-4 space-y-2">
          {CRISIS_LINES.map((l) => (
            <a
              key={l.tel}
              href={`tel:${l.tel}`}
              className="flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-3"
            >
              <span>
                <span className="block text-sm font-semibold">{l.name}</span>
                <span className="block text-xs text-muted-foreground">{l.alt}</span>
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                <Phone className="h-3.5 w-3.5" /> call
              </span>
            </a>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Your post was shared as normal — this is just us checking in, not a moderation action.
        </p>
        <button
          onClick={onClose}
          className="mt-3 w-full rounded-2xl border border-border py-3 text-sm text-muted-foreground"
        >
          I'm okay — close
        </button>
      </div>
    </div>
  );
}
