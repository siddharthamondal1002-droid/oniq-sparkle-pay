/**
 * The Creator Program strip a channel wears under its header.
 *
 * NOBODY PAYS HERE — that is the product. ONIQ funds a payout pool and
 * qualified channels earn from it by measured VIEWS (the YouTube/Instagram
 * model); of every rupee a channel generates, 70% goes to the influencer,
 * 20% to ONIQ, 10% is shared among the subscribers who watched — paid out
 * DIRECTLY through RazorpayX to each person's UPI ID, no in-app balance.
 * Since no digital content is ever purchased in-app, there is nothing for
 * Play's billing policy to apply to.
 *
 * TWO FACES. The OWNER sees the road to monetization — live progress
 * against the same thresholds channel_monetize_status enforces — and, once
 * qualified, what the program has paid them. A MEMBER of a qualified
 * channel sees that being subscribed here earns real payouts; members of
 * unqualified channels see nothing, because a program pitch on a channel
 * that cannot pay yet is noise.
 */
import { useEffect, useState } from "react";
import { BadgeCheck, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatPaise } from "@/lib/storyPricing";
import { useFormat } from "@/lib/format";

type Progress = {
  qualified: boolean;
  members: number;
  minMembers: number;
  videos: number;
  minVideos: number;
  views30: number;
  /* Optional because a cached status payload from before the million-views
     bar carries neither field; the strip then shows 0 progress, not NaN. */
  viewsTotal?: number;
  minViewsTotal?: number;
  ageDays: number;
  minAgeDays: number;
};

export function ChannelSubBar({
  conversationId,
  isOwner,
}: {
  conversationId: string;
  isOwner: boolean;
}) {
  // EVERY HOOK ABOVE EVERY EARLY RETURN. rules-of-hooks is a release blocker.
  const { number } = useFormat();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [earnedPaise, setEarnedPaise] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .rpc("channel_monetize_status" as never, { _channel_id: conversationId } as never)
      .then(({ data }) => {
        if (cancelled) return;
        const d = data as unknown as ({ ok?: boolean } & Progress) | null;
        if (d?.ok) setProgress(d);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    void supabase
      .from("creator_payouts" as never)
      .select("creator_paise")
      .eq("channel_id" as never, conversationId as never)
      .then(({ data }) => {
        if (cancelled || !Array.isArray(data)) return;
        setEarnedPaise(
          (data as { creator_paise: number }[]).reduce((s, r) => s + (r.creator_paise ?? 0), 0),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner, conversationId]);

  if (!progress) return null;
  if (!isOwner && !progress.qualified) return null;

  return (
    <div className="border-b border-border/60 bg-card/60 px-3 py-2">
      {isOwner ? (
        progress.qualified ? (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-300">
              <BadgeCheck className="h-3.5 w-3.5" /> Creator Program: qualified ·{" "}
              {number(progress.views30)} views/30d
            </span>
            <span className="text-[11px] font-semibold text-foreground">
              earned {formatPaise(earnedPaise)}
            </span>
          </div>
        ) : (
          <div className="normal-case tracking-normal">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5 text-primary" /> Road to monetization
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
              <span className={progress.members >= progress.minMembers ? "text-emerald-300" : ""}>
                {number(progress.members)}/{number(progress.minMembers)} subscribers
              </span>
              <span className={progress.videos >= progress.minVideos ? "text-emerald-300" : ""}>
                {progress.videos}/{progress.minVideos} videos
              </span>
              <span
                className={
                  (progress.viewsTotal ?? 0) >= (progress.minViewsTotal ?? 1000000)
                    ? "text-emerald-300"
                    : ""
                }
              >
                {number(progress.viewsTotal ?? 0)}/{number(progress.minViewsTotal ?? 1000000)} total
                views
              </span>
              <span>{number(progress.views30)} views/30d</span>
              <span className={progress.ageDays >= progress.minAgeDays ? "text-emerald-300" : ""}>
                {progress.ageDays}/{progress.minAgeDays} days old
              </span>
            </div>
          </div>
        )
      ) : (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <BadgeCheck className="h-3.5 w-3.5 text-emerald-300" />
          This channel earns from the ONIQ Creator Program — watching earns you a share, paid to
          your UPI.
        </div>
      )}
    </div>
  );
}
