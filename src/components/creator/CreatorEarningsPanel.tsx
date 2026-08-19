/**
 * Track B — what a creator sees about their money.
 *
 * ACCRUED AND AVAILABLE ARE TWO NUMBERS, SHOWN SEPARATELY, FROM DAY ONE.
 * Showing one number and then reducing it when a refund lands is the fastest
 * way to lose a creator: they have already told someone what they earned.
 * Accrued is "earned, still inside the 45-day hold". Available is "past the
 * hold, payable once the threshold is met".
 *
 * The payouts-off notice is deliberately explicit rather than a greyed-out
 * button. A creator whose balance is growing and who cannot see why nothing
 * has been paid assumes the worst, and they are right to.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Clock, Lock, Wallet } from "lucide-react";
import { formatPaise } from "@/lib/storyPricing";
import { BREAKEVEN_REFUND_BP, FOUNDING_LABEL, HOLD_DAYS, MIN_PAYOUT_PAISE } from "@/lib/creator/economics";

type Balance = {
  accruedPaise: number;
  availablePaise: number;
  paidPaise: number;
  netPaise: number;
};

type RefundRate = {
  charges: number;
  refunds: number;
  refundBp: number;
  breakevenBp: number;
  reviewBp: number;
  holdForReview: boolean;
};

export function CreatorEarningsPanel({ userId }: { userId: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: cfg } = useQuery<{ payouts_enabled: boolean; founding_until: string } | null>({
    queryKey: ["creator-payout-config"],
    queryFn: async () => {
      const { data } = await sb
        .from("creator_payout_config")
        .select("payouts_enabled, founding_until")
        .maybeSingle();
      return data ?? null;
    },
  });

  const { data: bal } = useQuery<Balance | null>({
    queryKey: ["creator-balance", userId],
    queryFn: async () => {
      const { data } = await sb.rpc("creator_balance", { _uid: userId });
      return (data as Balance | null) ?? null;
    },
  });

  const { data: rate } = useQuery<RefundRate | null>({
    queryKey: ["creator-refund-rate", userId],
    queryFn: async () => {
      const { data } = await sb.rpc("creator_refund_rate", { _uid: userId, _days: 30 });
      return (data as RefundRate | null) ?? null;
    },
  });

  const { data: notices = [] } = useQuery<
    { id: string; amount_paise: number; reason: string; period: string | null; notified_at: string }[]
  >({
    queryKey: ["creator-clawbacks", userId],
    queryFn: async () => {
      const { data } = await sb
        .from("creator_clawback_notices")
        .select("id, amount_paise, reason, period, notified_at")
        .order("notified_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const negative = (bal?.netPaise ?? 0) < 0;

  return (
    <section className="rounded-2xl bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Wallet className="h-4 w-4" /> Subscriptions earnings
      </h2>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-background/60 p-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" /> Accrued
          </div>
          <div className="text-lg font-semibold">{formatPaise(bal?.accruedPaise ?? 0)}</div>
          <div className="text-[11px] text-muted-foreground">
            still inside the {HOLD_DAYS}-day hold
          </div>
        </div>
        <div className="rounded-xl bg-background/60 p-3">
          <div className="text-xs text-muted-foreground">Available</div>
          <div className="text-lg font-semibold">{formatPaise(bal?.availablePaise ?? 0)}</div>
          <div className="text-[11px] text-muted-foreground">
            payable at {formatPaise(MIN_PAYOUT_PAISE)}
          </div>
        </div>
      </div>

      {negative && (
        <p className="mt-3 rounded-xl bg-background/60 p-3 text-xs text-muted-foreground">
          A refund left a balance of {formatPaise(bal?.netPaise ?? 0)} carried forward. It comes out
          of future earnings only — ONIQ never debits your bank account.
        </p>
      )}

      {/* THE GATE, IN WORDS. Not a disabled button with no explanation. */}
      {!cfg?.payouts_enabled && (
        <p className="mt-3 flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
          <Lock className="mt-[2px] h-3.5 w-3.5 shrink-0" />
          <span>
            Payouts are not switched on yet. Earnings keep accruing and nothing is lost — money
            movement stays off until ONIQ's tax registrations for creator payouts are in place.
          </span>
        </p>
      )}

      {rate && rate.charges > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Refund rate (30 days): {(rate.refundBp / 100).toFixed(1)}% of {rate.charges} charges.
          {rate.refundBp >= BREAKEVEN_REFUND_BP && (
            <span className="ml-1 inline-flex items-center gap-1 text-amber-500">
              <AlertTriangle className="h-3 w-3" /> past the {(BREAKEVEN_REFUND_BP / 100).toFixed(1)}%
              break-even
            </span>
          )}
        </p>
      )}

      {notices.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {notices.map((n) => (
            <li key={n.id}>
              −{formatPaise(n.amount_paise)} · {n.reason} · {n.period ?? ""} — refunded subscriptions
              are money that was never earned, not a penalty. Reply to dispute; a human answers
              within 7 days.
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">{FOUNDING_LABEL}</p>
    </section>
  );
}
