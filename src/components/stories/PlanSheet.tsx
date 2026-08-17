import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatPaise } from "@/lib/storyPricing";
import { GROUP_CALLS_BLURB } from "@/lib/callCapacity";

/**
 * See your plan, and choose one.
 *
 * Owner directive 2026-08-16: Story time is sold by the month. Before this
 * there was nowhere in the app that said what you were on — the studio printed
 * a raw second count and nothing else, so "60s left" was the entire user-facing
 * expression of a pricing model.
 *
 * THE PLANS ARE READ FROM THE DATABASE, NOT LISTED HERE. `subscription_plans`
 * is what bills; a second copy in TypeScript is a second copy to drift. The
 * price, the included minutes and the benefit list all come off the row, so
 * changing a plan is a data change and this screen follows it.
 *
 * NOTHING HERE CAN GRANT A PLAN. `grant_subscription` is revoked from the
 * client outright — this screen shows state and opens a checkout, and the
 * checkout's server side is what decides anybody has paid.
 */

type Plan = {
  key: string;
  label: string;
  kind: string;
  price_paise: number;
  included_seconds: number;
  entitlements: string[];
  sort_order: number;
};

/**
 * Benefit keys as people would say them.
 *
 * The database stores machine keys because they are what `has_entitlement`
 * checks; a user should never see `no_watermark`. Anything not named here
 * still shows, spelled out from its key, so a benefit added to a plan row
 * cannot silently become invisible on this screen.
 */
const BENEFIT_COPY: Record<string, string> = {
  no_watermark: "No ONIQ watermark on anything you make",
  all_lenses: "Every AR lens in calls and photos",
  // Free for everyone with no room cap (owner directive, 2026-08-16), so this
  // is spelled by GROUP_CALLS_BLURB on the free card and filtered off the paid
  // ones — see roomLine below. Kept here as the fallback wording.
  group_calls: "Group audio and video calls",
};
const sayBenefit = (key: string) => BENEFIT_COPY[key] ?? key.replace(/_/g, " ");

/**
 * A balance, as a length of film.
 *
 * "480s" is what the database holds and nobody thinks in; "8 min" is what
 * somebody buying eight minutes of film expects to see. Seconds survive under
 * a minute because "0.5 min" is worse than "30s".
 */
export function sayLeft(seconds: number): string {
  if (seconds <= 0) return "Nothing";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m} min ${s}s`;
}

/** Whole minutes when it divides, otherwise seconds — "0.5 minutes" reads badly. */
export function sayAllowance(seconds: number): string {
  if (seconds <= 0) return "No film included";
  if (seconds % 60 === 0) {
    const m = seconds / 60;
    return `${m} minute${m === 1 ? "" : "s"} of film a month`;
  }
  return `${seconds}s of film a month`;
}

export function PlanSheet({
  open,
  onClose,
  currentPlan,
  renewsOn,
  cancelAtPeriodEnd,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  currentPlan: string;
  renewsOn: string | null;
  cancelAtPeriodEnd: boolean;
  /** Given a plan, take the user to wherever it is bought. Null = not for sale. */
  onChoose: ((plan: Plan) => void) | null;
}) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    if (!open || plans) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("key,label,kind,price_paise,included_seconds,entitlements,sort_order")
        .eq("active", true)
        .order("sort_order");
      if (cancelled) return;
      // A failed read leaves the sheet empty rather than inventing a price.
      if (error) toast.error("Could not load plans");
      else setPlans((data ?? []) as Plan[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, plans]);

  /**
   * Prepaid is not shown as a plan to pick.
   *
   * It is a base plan in the schema — the same product, bought a lump at a
   * time — but on this screen it would read as a third tier competing with the
   * two real ones. Topping up already has its own button in the studio, at the
   * moment somebody actually runs out, which is where that choice belongs.
   */
  const choosable = useMemo(
    () => (plans ?? []).filter((p) => p.kind === "free" || p.kind === "auto_renew"),
    [plans],
  );

  /**
   * What the FREE plan already gives, so a paid card can show only the extra.
   *
   * Group calls went free for everyone on 2026-08-16 and stayed on every plan
   * row — has_entitlement reads the current plan only, so stripping it from
   * Plus while adding it to Free would have taken group calls away from the
   * people paying most. The consequence is that "Group audio and video calls"
   * would otherwise appear on every card, padding the paid ones with something
   * nobody is paying for. A plan chooser should list what the money buys.
   */
  const freeGives = useMemo(
    () => new Set((plans ?? []).find((p) => p.kind === "free")?.entitlements ?? []),
    [plans],
  );

  async function cancel() {
    setCanceling(true);
    const { data, error } = await supabase.rpc("cancel_my_subscription");
    setCanceling(false);
    if (error) {
      toast.error("Could not cancel — try again");
      return;
    }
    const until = (data as { accessUntil?: string } | null)?.accessUntil;
    // The honest wording: cancelling does not take the month away.
    toast.success(until ? `Cancelled. You keep Plus until ${until}.` : "Cancelled.");
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label="Your plan"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-border bg-background pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-background px-5 py-4">
          <h2 className="font-display text-lg font-bold">Your plan</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-muted-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : null}

          {choosable.map((p) => {
            const mine = p.key === currentPlan;
            return (
              <div
                key={p.key}
                className={`rounded-2xl border p-4 ${
                  mine ? "border-primary bg-primary/5" : "border-border bg-card/60"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-base font-bold">{p.label}</span>
                  <span className="text-sm font-semibold">
                    {p.price_paise > 0 ? (
                      <>
                        {formatPaise(p.price_paise)}
                        <span className="text-xs font-normal text-muted-foreground"> / month</span>
                      </>
                    ) : (
                      "Free"
                    )}
                  </span>
                </div>

                <p className="mt-1 text-xs text-muted-foreground">
                  {sayAllowance(p.included_seconds)}
                </p>

                {(() => {
                  // Free lists everything it has; a paid plan lists only what
                  // free does not already give.
                  const isFree = p.kind === "free";
                  const shown = isFree
                    ? p.entitlements.filter((e) => e !== "group_calls")
                    : p.entitlements.filter((e) => !freeGives.has(e) && e !== "group_calls");
                  /**
                   * GROUP CALLS ARE FREE WITH NO CAP — owner directive,
                   * 2026-08-16, replacing the "free 4, Plus 8" split of
                   * earlier the same day.
                   *
                   * So room size is no longer a reason to upgrade and the
                   * paid cards must not imply it is. The line survives only
                   * on the FREE card, where it says what everybody already
                   * has; on a paid card it would be selling something that
                   * is not for sale.
                   */
                  const roomLine =
                    isFree && p.entitlements.includes("group_calls") ? GROUP_CALLS_BLURB : null;
                  if (shown.length === 0 && !roomLine) return null;
                  return (
                    <>
                      {!isFree && freeGives.size > 0 ? (
                        <p className="mt-3 text-[11px] font-semibold text-muted-foreground">
                          Everything in Free, plus
                        </p>
                      ) : null}
                      <ul
                        className={`${!isFree && freeGives.size > 0 ? "mt-1.5" : "mt-3"} flex flex-col gap-1.5`}
                      >
                        {roomLine ? (
                          <li className="flex items-start gap-2 text-xs">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                            <span className="first-letter:uppercase">{roomLine}</span>
                          </li>
                        ) : null}
                        {shown.map((e) => (
                          <li key={e} className="flex items-start gap-2 text-xs">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                            <span>{sayBenefit(e)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  );
                })()}

                {mine ? (
                  <div className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
                    {cancelAtPeriodEnd && renewsOn
                      ? `Ends ${renewsOn} — you keep it until then.`
                      : renewsOn
                        ? `Renews ${renewsOn}`
                        : "Your current plan"}
                  </div>
                ) : p.price_paise > 0 && onChoose ? (
                  <button
                    type="button"
                    onClick={() => onChoose(p)}
                    className="mt-3 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                  >
                    Get {p.label}
                  </button>
                ) : p.price_paise > 0 ? (
                  // NOT A DISABLED BUTTON. A greyed-out "Get ONIQ Plus" reads
                  // as a bug in the app; a sentence reads as a fact about the
                  // world, which is what it is.
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Not on sale in this app yet.
                  </p>
                ) : null}
              </div>
            );
          })}

          {currentPlan !== "free" && !cancelAtPeriodEnd ? (
            <button
              type="button"
              onClick={() => void cancel()}
              disabled={canceling}
              className="mt-1 self-center text-xs text-muted-foreground underline disabled:opacity-50"
            >
              {canceling ? "Cancelling…" : "Cancel subscription"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type { Plan };
