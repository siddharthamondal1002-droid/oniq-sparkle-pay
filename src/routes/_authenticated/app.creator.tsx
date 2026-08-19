/**
 * Creator Studio — the Creator Program's two dashboards, each side in ITS
 * OWN model. The INFLUENCER face is the creator model: what the channel
 * produced (subscribers, videos, views received) charted per day, the
 * qualification road, and what the program has paid. The SUBSCRIBER face is
 * the inverse model: what the viewer consumed — their own watching charted
 * per day, their road to earning per channel, and their payout receipts.
 * Both charts draw from content_views, the same measured ledger the payout
 * run divides money by, so the analytics never disagree with the money.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { ArrowLeft, BadgeCheck, Clapperboard, TrendingUp, Wallet } from "lucide-react";
import { formatPaise } from "@/lib/storyPricing";
import { useFormat } from "@/lib/format";
import { homeFormat } from "@/lib/format";
import { ProgramCriteria, useProgramBars } from "@/components/chat/ProgramInfoSheet";
import { CreatorEarningsPanel } from "@/components/creator/CreatorEarningsPanel";

export const Route = createFileRoute("/_authenticated/app/creator")({
  component: CreatorStudio,
});

type SeriesPoint = { day: string; views: number };

type MonetizeStatus = {
  ok: boolean;
  qualified: boolean;
  members: number;
  minMembers: number;
  videos: number;
  minVideos: number;
  views30: number;
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

type Channel = { id: string; name: string | null; avatar_url: string | null };

type PayoutRow = {
  id: string;
  kind: string;
  status: string;
  amount_paise: number;
  created_at: string;
};

/** Tiny dependency-free bar chart: one bar per day, height ∝ views. */
function Spark({ series }: { series: SeriesPoint[] }) {
  const max = Math.max(1, ...series.map((p) => p.views));
  return (
    <div className="flex h-16 items-end gap-[2px]">
      {series.map((p) => (
        <div
          key={p.day}
          title={`${p.day}: ${p.views}`}
          className={`flex-1 rounded-t ${p.views > 0 ? "bg-primary/80" : "bg-muted"}`}
          style={{ height: `${Math.max(4, Math.round((p.views / max) * 100))}%` }}
        />
      ))}
    </div>
  );
}

function OwnedChannelCard({ ch }: { ch: Channel }) {
  // EVERY HOOK ABOVE EVERY EARLY RETURN.
  const { number } = useFormat();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: status = null } = useQuery<MonetizeStatus | null>({
    queryKey: ["studio-status", ch.id],
    queryFn: async () => {
      const { data } = await sb.rpc("channel_monetize_status", { _channel_id: ch.id });
      const d = data as MonetizeStatus | null;
      return d?.ok ? d : null;
    },
  });

  const { data: series = [] } = useQuery<SeriesPoint[]>({
    queryKey: ["studio-series", ch.id],
    queryFn: async () => {
      const { data } = await sb.rpc("channel_views_series", { _channel_id: ch.id, _days: 30 });
      return Array.isArray(data) ? (data as SeriesPoint[]) : [];
    },
  });

  const { data: pays = [] } = useQuery<
    {
      creator_paise: number;
      subscriber_paise: number;
      subscriber_count: number;
      created_at: string;
    }[]
  >({
    queryKey: ["studio-pays", ch.id],
    queryFn: async () => {
      const { data } = await sb
        .from("creator_payouts")
        .select("creator_paise, subscriber_paise, subscriber_count, created_at")
        .eq("channel_id", ch.id)
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const earned = pays.reduce((s, r) => s + (r.creator_paise ?? 0), 0);
  const name = ch.name ?? "channel";

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {ch.avatar_url ? (
            <img src={ch.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-bold text-primary-foreground">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="truncate text-sm font-semibold">{name}</div>
        </div>
        {status?.qualified ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-300">
            <BadgeCheck className="h-3.5 w-3.5" /> qualified
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-muted-foreground">on the road</span>
        )}
      </div>

      {status && (
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          {(
            [
              ["subscribers", status.members],
              ["videos", status.videos],
              ["views/30d", status.views30],
              ["total views", status.viewsTotal ?? 0],
            ] as const
          ).map(([label, val]) => (
            <div key={label} className="rounded-xl bg-muted/30 p-2">
              <div className="text-sm font-bold">{number(val)}</div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          views per day — last 30
        </div>
        <Spark series={series} />
      </div>

      {status && !status.qualified && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
          <span className={status.members >= status.minMembers ? "text-emerald-300" : ""}>
            {number(status.members)}/{number(status.minMembers)} subscribers
          </span>
          <span className={status.videos >= status.minVideos ? "text-emerald-300" : ""}>
            {status.videos}/{status.minVideos} videos
          </span>
          <span
            className={
              (status.viewsTotal ?? 0) >= (status.minViewsTotal ?? 1000000)
                ? "text-emerald-300"
                : ""
            }
          >
            {number(status.viewsTotal ?? 0)}/{number(status.minViewsTotal ?? 1000000)} total views
          </span>
          <span className={status.ageDays >= status.minAgeDays ? "text-emerald-300" : ""}>
            {status.ageDays}/{status.minAgeDays} days old
          </span>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
        <span className="text-[11px] text-muted-foreground">earned from the program</span>
        <span className="text-sm font-bold">{formatPaise(earned)}</span>
      </div>
      {pays.slice(0, 3).map((p) => (
        <div
          key={p.created_at}
          className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground"
        >
          <span>
            {homeFormat().dateTime(p.created_at)} · {number(p.subscriber_count)} subscribers shared{" "}
            {formatPaise(p.subscriber_paise)}
          </span>
          <span className="font-semibold text-foreground">{formatPaise(p.creator_paise)}</span>
        </div>
      ))}
    </div>
  );
}

function MemberChannelCard({ ch }: { ch: Channel }) {
  const { number } = useFormat();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data: earn = null } = useQuery<EarnStatus | null>({
    queryKey: ["studio-earn", ch.id],
    queryFn: async () => {
      const { data } = await sb.rpc("subscriber_earn_status", { _channel_id: ch.id });
      const d = data as EarnStatus | null;
      return d?.ok ? d : null;
    },
  });
  const name = ch.name ?? "channel";

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-sm font-semibold">{name}</div>
        {earn?.qualified ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-300">
            <BadgeCheck className="h-3.5 w-3.5" /> earning
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-muted-foreground">Road to earning</span>
        )}
      </div>
      {earn && !earn.qualified && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
          <span className={earn.watchedVideos >= earn.minWatchedVideos ? "text-emerald-300" : ""}>
            {number(earn.watchedVideos)}/{number(earn.minWatchedVideos)} videos watched
          </span>
          <span className={earn.memberDays >= earn.minMemberDays ? "text-emerald-300" : ""}>
            {earn.memberDays}/{earn.minMemberDays} days subscribed
          </span>
        </div>
      )}
    </div>
  );
}

function CreatorStudio() {
  // EVERY HOOK ABOVE EVERY EARLY RETURN. rules-of-hooks is a release blocker.
  const { number } = useFormat();
  const bars = useProgramBars();
  const [me, setMe] = useState<string | null>(null);
  const [tab, setTab] = useState<"influencer" | "subscriber">("influencer");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  const { data: owned = [] } = useQuery<Channel[]>({
    queryKey: ["studio-owned", me],
    enabled: !!me,
    queryFn: async () => {
      const { data } = await sb
        .from("conversation_members")
        .select("conversations!inner(id, name, avatar_url, type)")
        .eq("user_id", me)
        .eq("role", "owner")
        .eq("conversations.type", "channel")
        .limit(12);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((r) => r.conversations as Channel);
    },
  });

  const { data: memberOf = [] } = useQuery<Channel[]>({
    queryKey: ["studio-member", me],
    enabled: !!me,
    queryFn: async () => {
      const { data } = await sb
        .from("conversation_members")
        .select("conversations!inner(id, name, avatar_url, type)")
        .eq("user_id", me)
        .neq("role", "owner")
        .eq("conversations.type", "channel")
        .limit(12);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((r) => r.conversations as Channel);
    },
  });

  const { data: myPayouts = [] } = useQuery<PayoutRow[]>({
    queryKey: ["studio-my-payouts", me],
    enabled: !!me,
    queryFn: async () => {
      const { data } = await sb
        .from("payout_queue")
        .select("id, kind, status, amount_paise, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const { data: watchSeries = [] } = useQuery<SeriesPoint[]>({
    queryKey: ["studio-watch-series", me],
    enabled: !!me,
    queryFn: async () => {
      const { data } = await sb.rpc("viewer_views_series", { _days: 30 });
      return Array.isArray(data) ? (data as SeriesPoint[]) : [];
    },
  });

  const paidPaise = myPayouts
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount_paise, 0);
  const waitingPaise = myPayouts
    .filter((p) => p.status === "queued" || p.status === "no_method")
    .reduce((s, p) => s + p.amount_paise, 0);
  const watched30 = watchSeries.reduce((s, p) => s + p.views, 0);

  return (
    <div className="mx-auto min-h-screen w-full max-w-md px-4 pb-28 pt-12">
      <div className="flex items-center gap-2">
        <Link
          to="/app/profile"
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl font-bold">Creator Studio 📊</h1>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        you&apos;re both. Every creator is a subscriber, every subscriber can be a creator — earn
        from channels you run and from channels you watch, both paid to the same UPI.
      </p>

      <details className="mt-3 rounded-2xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          How the program works — the exact bars 📖
        </summary>
        <div className="mt-3">
          <ProgramCriteria bars={bars} />
        </div>
      </details>

      <div className="mt-4 grid grid-cols-2 rounded-2xl border border-border bg-card p-1 text-xs">
        {(
          [
            ["influencer", "influencer 🎥"],
            ["subscriber", "subscriber 💰"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-xl py-2 font-semibold ${tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "influencer" ? (
        <div className="mt-4 space-y-3">
          {/* Subscriptions money sits above the channel cards: it is the part a
              creator checks daily, and Accrued/Available must be the first
              numbers they see rather than a total they have to work out. */}
          {me && <CreatorEarningsPanel userId={me} />}
          {owned.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              <Clapperboard className="mx-auto mb-2 h-6 w-6" />
              no channels yet — create one in Chat and the road to monetization starts here.
            </div>
          ) : (
            owned.map((ch) => <OwnedChannelCard key={ch.id} ch={ch} />)
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" /> your payouts
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-muted/30 p-2">
                <div className="text-sm font-bold">{formatPaise(paidPaise)}</div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  paid to your UPI
                </div>
              </div>
              <div className="rounded-xl bg-muted/30 p-2">
                <div className="text-sm font-bold">{formatPaise(waitingPaise)}</div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  waiting
                </div>
              </div>
            </div>
            {myPayouts.slice(0, 5).map((p) => (
              <div
                key={p.id}
                className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground"
              >
                <span>
                  {homeFormat().dateTime(p.created_at)} · {p.kind} ·{" "}
                  {p.status === "no_method" ? "add a UPI ID in Profile" : p.status}
                </span>
                <span className="font-semibold text-foreground">{formatPaise(p.amount_paise)}</span>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" /> your watching — views per day
            </div>
            <div className="mt-2">
              <Spark series={watchSeries} />
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {number(watched30)} views in the last 30 days. Watching qualified channels is what
              earns your share.
            </div>
          </div>

          {memberOf.length > 0 && (
            <>
              <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                your channels
              </div>
              {memberOf.map((ch) => (
                <MemberChannelCard key={ch.id} ch={ch} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
