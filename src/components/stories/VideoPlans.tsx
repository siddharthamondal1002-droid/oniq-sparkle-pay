/**
 * VideoPlans — the finished-video-time catalogue, exactly as the owner set it
 * (owner directive 2026-08-27): free 1-minute trial, Creator ₹199/30 min,
 * Pro ₹349/60 min watermark-free, PAYG ₹29/min (+₹20/min clean export),
 * first month free for new subscribers.
 *
 * DISPLAY IS LOCAL COPY, CHARGING IS SERVER-SIDE. Prices render from
 * videoPricing.ts (consistency-tested against the migration seed); every
 * purchase path prices itself from the database under the receipt row, and
 * the client never sends an amount. CTAs appear only when the server says
 * sales are open (video_time_status().salesEnabled) — until then the card is
 * honest about what is live today: the free minute.
 *
 * PLAY POLICY: digital content is sold on the web only. The native build
 * shows the catalogue and points at the website; it never collects.
 */
import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Clapperboard } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatPaise } from "@/lib/storyPricing";
import { payForVideoMinutes } from "@/lib/razorpay";
import {
  VIDEO_CLEAN_ADDON_PAISE_PER_MINUTE,
  VIDEO_PAYG_MINUTES,
  VIDEO_PAYG_PAISE_PER_MINUTE,
  VIDEO_PLANS,
  readVideoTimeStatus,
  type VideoTimeStatus,
} from "@/lib/videoPricing";

export function VideoPlans() {
  const [status, setStatus] = useState<VideoTimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const isNative = Capacitor.isNativePlatform();

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc("video_time_status" as never);
    if (!error) setStatus(readVideoTimeStatus(data));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const salesOpen = status?.salesEnabled === true;
  const canCollect = salesOpen && !isNative;

  const startFreeMonth = useCallback(
    async (planKey: string, label: string, thenPaise: number) => {
      setBusy(true);
      try {
        const { data, error } = await supabase.rpc(
          "start_free_video_month" as never,
          { _plan_key: planKey } as never,
        );
        const r = (data ?? {}) as { ok?: boolean; reason?: string; renewsOn?: string };
        if (error || !r.ok) {
          const reason = r.reason ?? "unavailable";
          toast.error(
            reason === "already-used"
              ? "Your free month has already been used."
              : reason === "already-subscribed"
                ? "You already have a plan."
                : "That plan is not available right now.",
          );
          return;
        }
        toast.success(
          `${label} is yours — first month free. Then ${formatPaise(thenPaise)}/month${
            r.renewsOn ? ` from ${r.renewsOn}` : ""
          }. Cancel any time before then.`,
        );
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const buyMinutes = useCallback(
    async (minutes: number) => {
      setBusy(true);
      try {
        const out = await payForVideoMinutes({ minutes });
        if (out.status === "paid") {
          toast.success(`${Math.round(out.seconds / 60)} min of video time added.`);
          await refresh();
        } else if (out.status === "failed") {
          toast.error(out.message);
        }
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Clapperboard className="h-3.5 w-3.5" /> video time
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Create videos of any length. Your plan determines how much video time you can create.
      </p>

      <div className="mt-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-[11px] font-semibold text-primary">
        First month free for new subscribers.
      </div>

      <ul className="mt-2 grid grid-cols-1 gap-1.5">
        <li className="rounded-xl border border-border p-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold text-foreground">Free</span>
            <span className="text-[11px] text-muted-foreground">{formatPaise(0)}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            1 minute of video, once per account · ONIQ watermark
          </p>
        </li>
        {VIDEO_PLANS.map((p) => (
          <li key={p.key} className="rounded-xl border border-border p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold text-foreground">{p.label}</span>
              <span className="text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">{formatPaise(0)} first month</span>{" "}
                · then {formatPaise(p.pricePaise)}/month
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {p.includedSeconds / 60} minutes of video each month ·{" "}
              {p.watermarkFree ? "no watermark" : "ONIQ watermark"}
            </p>
            {canCollect && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void startFreeMonth(p.key, p.label, p.pricePaise)}
                className="mt-1.5 rounded-lg border border-primary/50 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary disabled:opacity-40"
              >
                Start free month — then {formatPaise(p.pricePaise)}/month
              </button>
            )}
          </li>
        ))}
        <li className="rounded-xl border border-border p-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold text-foreground">Pay as you go</span>
            <span className="text-[11px] text-muted-foreground">
              {formatPaise(VIDEO_PAYG_PAISE_PER_MINUTE)}/min
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            No subscription · ONIQ watermark · clean export{" "}
            {formatPaise(VIDEO_PAYG_PAISE_PER_MINUTE + VIDEO_CLEAN_ADDON_PAISE_PER_MINUTE)}
            /min
          </p>
          {canCollect && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {VIDEO_PAYG_MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={busy}
                  onClick={() => void buyMinutes(m)}
                  className="rounded-lg border border-primary/50 px-2.5 py-1 text-[11px] font-semibold text-primary disabled:opacity-40"
                >
                  {m} min · {formatPaise(VIDEO_PAYG_PAISE_PER_MINUTE * m)}
                </button>
              ))}
            </div>
          )}
        </li>
      </ul>

      {!salesOpen && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Plans and top-ups open soon. Your free minute works today.
        </p>
      )}
      {salesOpen && isNative && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Plans and top-ups are bought on{" "}
          <span className="font-semibold text-foreground">oniqhub.com</span>.
        </p>
      )}
    </div>
  );
}
