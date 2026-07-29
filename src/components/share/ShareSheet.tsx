import { toast } from "sonner";
import { X, Link2 } from "lucide-react";
import { shareTargets, type SharePayload } from "@/lib/share";

/**
 * In-app share fallback for WebViews without a system share sheet.
 * Grid of the apps Gen Z actually forwards to, plus copy-link.
 */
export function ShareSheet({ payload, onClose }: { payload: SharePayload; onClose: () => void }) {
  const targets = shareTargets(payload);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(payload.url);
      toast.success("Link copied 🔗");
    } catch {
      // Older WebViews: textarea fallback
      const ta = document.createElement("textarea");
      ta.value = payload.url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast.success("Link copied 🔗");
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl border-t border-border bg-card p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">share it ✨</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-3">
          {targets.map((t) => (
            <a
              key={t.id}
              href={t.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="press flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-background/60 py-3"
            >
              <span className="text-2xl leading-none">{t.emoji}</span>
              <span className="text-[10px] font-semibold text-muted-foreground">{t.label}</span>
            </a>
          ))}
          <button
            onClick={copyLink}
            className="press flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-background/60 py-3"
          >
            <Link2 className="h-6 w-6 text-primary" />
            <span className="text-[10px] font-semibold text-muted-foreground">Copy link</span>
          </button>
        </div>
      </div>
    </div>
  );
}
