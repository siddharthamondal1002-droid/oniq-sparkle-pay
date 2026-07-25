// Funky, heartfelt "bring ONIQ to your area" notification card.
// Forward the invite by email or mobile message, or check live availability
// (20 verified partners unlock a region).

import { useState } from "react";
import { Mail, MessageSquare, MapPin, Share2, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { buildInviteMessage, emailShareUrl, smsShareUrl, nativeShare } from "@/lib/shareInvite";
import { getRegionStatus, REGION_PROVIDER_TARGET, type RegionStatus } from "@/lib/regionService";

const DISMISS_KEY = "oniq.earn.inviteCard.dismissed";

export function InviteNotification({
  regionLabel,
  regionKey,
  providerCount,
}: {
  /** Human-readable region, e.g. "Kolkata" or "Singur". */
  regionLabel: string;
  /** Canonical region key for the availability check. */
  regionKey: string;
  /** Last-known provider count, woven into the message when present. */
  providerCount?: number;
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<RegionStatus | null>(null);

  if (dismissed) return null;

  const message = buildInviteMessage(regionLabel, providerCount);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const shareEmail = () => {
    window.location.href = emailShareUrl(message);
  };

  const shareSms = async () => {
    // Native share sheet first (lets them pick WhatsApp etc.); sms: fallback.
    const handled = await nativeShare(message);
    if (!handled) window.location.href = smsShareUrl(message);
  };

  const checkArea = async () => {
    setChecking(true);
    const status = await getRegionStatus(regionKey);
    setChecked(status);
    setChecking(false);
    if (status.state === "unavailable") {
      toast.error("couldn't check right now — try again in a bit");
    }
  };

  return (
    <div
      data-testid="invite-notification"
      className="relative overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/15 via-card to-[#25D366]/10 p-4"
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 animate-pulse rounded-full bg-primary/20 blur-2xl" />
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-center gap-2 pr-8">
        <span className="text-xl">💌</span>
        <div className="font-display text-sm font-bold">
          bring ONIQ services home to {regionLabel || "your area"}
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        someone you love earns with their hands — a tutor, a cook, an electrician, a mehndi artist.
        when {REGION_PROVIDER_TARGET} of them register as partners, ONIQ services switch on for your
        whole area, with 100% free booking. forward this to the one person you thought of just now
        💚
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          onClick={shareEmail}
          data-testid="invite-email"
          className="press flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-2.5 text-[11px] font-semibold"
        >
          <Mail className="h-3.5 w-3.5" /> email
        </button>
        <button
          onClick={shareSms}
          data-testid="invite-sms"
          className="press flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-2.5 text-[11px] font-semibold"
        >
          <MessageSquare className="h-3.5 w-3.5" /> message
        </button>
        <button
          onClick={checkArea}
          disabled={checking}
          data-testid="invite-check-area"
          className="press flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-60"
        >
          {checking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MapPin className="h-3.5 w-3.5" />
          )}{" "}
          my area
        </button>
      </div>

      {checked && checked.state === "ready" && (
        <div className="mt-3 rounded-xl bg-background/60 p-2.5 text-center text-xs">
          {checked.enabled ? (
            <span className="font-semibold text-[#25D366]">
              🎉 {regionLabel}: services are LIVE — {checked.providerCount} partners ready
            </span>
          ) : (
            <span>
              <b>
                {checked.providerCount}/{REGION_PROVIDER_TARGET}
              </b>{" "}
              partners in {regionLabel} — <b>{checked.remaining}</b> more and services go live. keep
              forwarding 💪
            </span>
          )}
        </div>
      )}
      {checked && checked.state === "unavailable" && (
        <div className="mt-3 rounded-xl bg-background/60 p-2.5 text-center text-xs text-muted-foreground">
          couldn't reach the availability service — check your connection and try again
        </div>
      )}

      <button
        onClick={async () => {
          const ok = await nativeShare(message);
          if (!ok) toast("long-press to copy, or use email / message above");
        }}
        className="press mx-auto mt-2.5 flex items-center gap-1 text-[10px] font-semibold text-primary"
      >
        <Share2 className="h-3 w-3" /> more ways to share
      </button>
    </div>
  );
}
