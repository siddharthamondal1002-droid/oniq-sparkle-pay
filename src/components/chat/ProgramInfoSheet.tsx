/**
 * "How does anyone earn here?" — the Creator Program explained in one sheet.
 *
 * OWNER DIRECTIVE (2026-08-12): subscribers and influencers must be able to
 * FIND the qualification criteria, not deduce them from a progress strip.
 * This sheet is opened from the channel strip (both faces) and lives inline
 * in Creator Studio.
 *
 * NUMBERS COME FROM THE DATABASE — channel_monetize_config and
 * creator_program_config are both readable by any signed-in user — with the
 * shipped defaults as fallback, so a config tweak (say the bar rises again)
 * changes this sheet with no app release.
 */
import { useEffect, useState } from "react";
import { BadgeCheck, TrendingUp, Wallet, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useFormat } from "@/lib/format";

type Bars = {
  minMembers: number;
  minVideos: number;
  minTotalViews: number;
  minAgeDays: number;
  creatorPct: number;
  oniqPct: number;
  subscriberPct: number;
  subMinWatched: number;
  subMinMemberDays: number;
};

const DEFAULTS: Bars = {
  minMembers: 10000,
  minVideos: 50,
  minTotalViews: 1000000,
  minAgeDays: 14,
  creatorPct: 70,
  oniqPct: 20,
  subscriberPct: 10,
  subMinWatched: 50,
  subMinMemberDays: 14,
};

export function useProgramBars(): Bars {
  const [bars, setBars] = useState<Bars>(DEFAULTS);
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    void Promise.all([
      sb.from("channel_monetize_config").select("*").limit(1).maybeSingle(),
      sb.from("creator_program_config").select("*").limit(1).maybeSingle(),
    ]).then(
      ([m, p]: [
        { data: Record<string, number> | null },
        { data: Record<string, number> | null },
      ]) => {
        if (cancelled) return;
        const mc = m.data ?? {};
        const pc = p.data ?? {};
        setBars({
          minMembers: mc.min_members ?? DEFAULTS.minMembers,
          minVideos: mc.min_videos ?? DEFAULTS.minVideos,
          minTotalViews: mc.min_total_views ?? DEFAULTS.minTotalViews,
          minAgeDays: mc.min_channel_age_days ?? DEFAULTS.minAgeDays,
          creatorPct: pc.creator_pct ?? DEFAULTS.creatorPct,
          oniqPct: pc.oniq_pct ?? DEFAULTS.oniqPct,
          subscriberPct: pc.subscriber_pct ?? DEFAULTS.subscriberPct,
          subMinWatched: pc.sub_min_watched_videos ?? DEFAULTS.subMinWatched,
          subMinMemberDays: pc.sub_min_member_days ?? DEFAULTS.subMinMemberDays,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return bars;
}

/** The criteria, as reusable content — the sheet and Creator Studio share it. */
export function ProgramCriteria({ bars }: { bars: Bars }) {
  const { number } = useFormat();
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-2xl border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5 text-primary" /> A channel qualifies with
        </div>
        <ul className="mt-2 space-y-1 text-[13px]">
          <li>• {number(bars.minMembers)} subscribers</li>
          <li>• {bars.minVideos} videos posted</li>
          <li>• {number(bars.minTotalViews)} total views in ONIQ</li>
          <li>• at least {bars.minAgeDays} days old</li>
        </ul>
      </div>
      <div className="rounded-2xl border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <BadgeCheck className="h-3.5 w-3.5 text-emerald-300" /> A subscriber earns by watching
        </div>
        <ul className="mt-2 space-y-1 text-[13px]">
          <li>• be subscribed to the channel</li>
          <li>• {bars.subMinWatched} of its videos watched</li>
          <li>• subscribed for {bars.subMinMemberDays}+ days</li>
        </ul>
      </div>
      <div className="rounded-2xl border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Wallet className="h-3.5 w-3.5 text-primary" /> Where the money goes
        </div>
        <p className="mt-2 text-[13px]">
          Nobody pays to watch. ONIQ funds a pool; each qualified channel&apos;s share follows its
          measured views. Of every rupee: {bars.creatorPct}% to the creator, {bars.subscriberPct}%
          shared among its qualified watchers, {bars.oniqPct}% to ONIQ — paid straight to each
          person&apos;s UPI ID by Razorpay, no in-app balance.
        </p>
      </div>
    </div>
  );
}

export function ProgramInfoSheet({ onClose }: { onClose: () => void }) {
  const bars = useProgramBars();
  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-border bg-background p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Creator Program — how it works</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ProgramCriteria bars={bars} />
        <p className="mt-3 text-[11px] text-muted-foreground">
          Add your UPI ID in Profile so payouts have somewhere to land. Track your own progress in
          Creator Studio.
        </p>
      </div>
    </div>
  );
}
