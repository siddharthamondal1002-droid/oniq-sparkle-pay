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
 * channel sees the INVERSE MODEL: the creator qualified by producing, the
 * subscriber qualifies by consuming — videos watched and days subscribed,
 * mirroring the creator's bar — and until they cross it they see their own
 * road to earning. EVERY face opens the ProgramInfoSheet, because criteria
 * nobody can find are criteria nobody can chase (owner directive,
 * 2026-08-12); members of channels still on the road get a one-line pitch
 * with the rules behind it instead of silence.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BadgeCheck, Info, TrendingUp } from "lucide-react";
import { ProgramInfoSheet } from "@/components/chat/ProgramInfoSheet";
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

type EarnStatus = {
  ok: boolean;
  member: boolean;
  qualified: boolean;
  watchedVideos: number;
  minWatchedVideos: number;
  memberDays: number;
  minMemberDays: number;
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
  const [earn, setEarn] = useState<EarnStatus | null>(null);
  const [showInfo, setShowInfo] = useState(false);

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
    if (isOwner) return;
    let cancelled = false;
    void supabase
      .rpc("subscriber_earn_status" as never, { _channel_id: conversationId } as never)
      .then(({ data }) => {
        if (cancelled) return;
        const d = data as unknown as EarnStatus | null;
        if (d?.ok) setEarn(d);
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner, conversationId]);

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

  return (
    <div className="border-b border-border/60 bg-card/60 px-3 py-2">
      {isOwner ? (
        /* The strip is the door: tapping the owner's progress opens the full
           Creator Studio dashboard; the ⓘ answers "what are the bars?". */
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowInfo(true)}
            aria-label="How the Creator Program works"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
          <Link to="/app/creator" className="block min-w-0 flex-1">
            {progress.qualified ? (
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
                  <span
                    className={progress.members >= progress.minMembers ? "text-emerald-300" : ""}
                  >
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
                    {number(progress.viewsTotal ?? 0)}/{number(progress.minViewsTotal ?? 1000000)}{" "}
                    total views
                  </span>
                  <span>{number(progress.views30)} views/30d</span>
                  <span
                    className={progress.ageDays >= progress.minAgeDays ? "text-emerald-300" : ""}
                  >
                    {progress.ageDays}/{progress.minAgeDays} days old
                  </span>
                </div>
              </div>
            )}
          </Link>
        </div>
      ) : progress.qualified && earn && earn.member && !earn.qualified ? (
        <button
          type="button"
          onClick={() => setShowInfo(true)}
          className="block w-full text-start normal-case tracking-normal"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-primary" /> Road to earning
            <Info className="h-3 w-3" />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
            <span className={earn.watchedVideos >= earn.minWatchedVideos ? "text-emerald-300" : ""}>
              {number(earn.watchedVideos)}/{number(earn.minWatchedVideos)} videos watched
            </span>
            <span className={earn.memberDays >= earn.minMemberDays ? "text-emerald-300" : ""}>
              {earn.memberDays}/{earn.minMemberDays} days subscribed
            </span>
          </div>
        </button>
      ) : progress.qualified ? (
        <button
          type="button"
          onClick={() => setShowInfo(true)}
          className="flex w-full items-center gap-1.5 text-start text-[11px] normal-case tracking-normal text-muted-foreground"
        >
          <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
          This channel earns from the ONIQ Creator Program — watching earns you a share, paid to
          your UPI.{earn?.qualified ? " You qualify." : ""}
        </button>
      ) : (
        /* Members of a channel still on the road see the pitch and the rules
           — the criteria used to be findable by nobody but the owner. */
        <button
          type="button"
          onClick={() => setShowInfo(true)}
          className="flex w-full items-center gap-1.5 text-start text-[11px] normal-case tracking-normal text-muted-foreground"
        >
          <Info className="h-3.5 w-3.5 shrink-0 text-primary" />
          Creator Program: this channel can earn — and watching can pay you. How it works
        </button>
      )}
      {showInfo && <ProgramInfoSheet onClose={() => setShowInfo(false)} />}
    </div>
  );
}
