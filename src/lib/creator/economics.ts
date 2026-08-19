// Track B — the economics, in one place, in integers.
//
// FIXED BY THE OWNER, NOT RE-OPENED HERE. On Rs 100: Play takes Rs 15, the
// creator takes Rs 75, ONIQ's gross is Rs 10 and its net is about Rs 8.20
// once payment and support costs come out. The founding-creator rate is 7.5%
// and it is TIME-LIMITED — every surface that shows it must say so, because a
// rate that quietly becomes 10% later is the kind of surprise that costs a
// creator relationship permanently.
//
// Basis points, not percentages, and integer paise throughout: a float
// somewhere in a money path is a rounding difference that turns up months
// later as a reconciliation that will not close.
//
// These constants MIRROR public.creator_payout_config. The database is the
// authority — nothing here decides what is paid, it only decides what is
// SHOWN, so a stale copy is a display bug rather than a money bug.

export const PLAY_FEE_BP = 1500;
export const STANDARD_COMMISSION_BP = 1000;
export const FOUNDING_COMMISSION_BP = 750;

/** Founding rate is time-limited and every label must say so. */
export const FOUNDING_LABEL = "Founding creator rate — 7.5%, limited time";

/** B4 — the hold, the threshold, and the two numbers shown separately. */
export const HOLD_DAYS = 45;
export const MIN_PAYOUT_PAISE = 100_000; // Rs 1,000

/**
 * B5 — at a 10% commission one unrecovered refund wipes the margin on nine
 * others, so break-even sits at about a 10.5% unrecovered refund rate. It is
 * surfaced in the studio rather than living in a spreadsheet.
 */
export const BREAKEVEN_REFUND_BP = 1050;
export const REFUND_REVIEW_BP = 500;

/** The only price points that exist. See PLAY_PRODUCT_LIMITS for why. */
export const SUB_TIERS = [
  { sku: "oniq_creator_49", pricePaise: 4_900, label: "₹49" },
  { sku: "oniq_creator_99", pricePaise: 9_900, label: "₹99" },
  { sku: "oniq_creator_199", pricePaise: 19_900, label: "₹199" },
  { sku: "oniq_creator_499", pricePaise: 49_900, label: "₹499" },
] as const;

/**
 * B2, THE ARCHITECTURAL CONSTRAINT, WRITTEN DOWN SO IT IS NOT REDISCOVERED.
 *
 * Play caps an app at 1,000 in-app products and 50 base plans per
 * subscription. A product per creator is therefore not a thing that can be
 * built — it works for the first few hundred creators and then the store
 * simply refuses to create the next one, at which point the design has to
 * change with real subscribers already on it.
 *
 * So: a handful of SHARED SKUs by price point. The creator being paid rides
 * along in obfuscatedAccountId at purchase, and the ENTITLEMENT LIVES IN
 * ONIQ'S DATABASE. Play knows only the tier.
 */
export const PLAY_PRODUCT_LIMITS = { maxProducts: 1000, maxBasePlansPerSub: 50 } as const;

export type Split = { gross: number; play: number; oniq: number; creator: number };

/** Integer-only split. Remainder paise land with the creator, never with us. */
export function splitPaise(grossPaise: number, founding = false): Split {
  const play = Math.floor((grossPaise * PLAY_FEE_BP) / 10_000);
  const oniq = Math.floor(
    (grossPaise * (founding ? FOUNDING_COMMISSION_BP : STANDARD_COMMISSION_BP)) / 10_000,
  );
  return { gross: grossPaise, play, oniq, creator: grossPaise - play - oniq };
}

/** Basis points of refunds to charges, integer, 0 when there is nothing yet. */
export function refundBp(charges: number, refunds: number): number {
  if (charges <= 0) return 0;
  return Math.floor((refunds * 10_000) / charges);
}

/** Above this, the margin is gone — the studio says so in words. */
export function pastBreakeven(bp: number): boolean {
  return bp >= BREAKEVEN_REFUND_BP;
}

/**
 * B5 — recovery order, as a decision function so it is testable and so nobody
 * has to infer it from the ledger.
 *
 * Offset Available, then Accrued, then CARRY THE REST FORWARD. Direct recovery
 * is contemplated only above Rs 10,000 and only with fraud established; below
 * that it is written off after 180 days. A creator's bank account is NEVER
 * debited — no mandate exists for it, and attempting one turns a billing
 * dispute into a legal one.
 */
export const DIRECT_RECOVERY_PAISE = 1_000_000;
export const WRITE_OFF_DAYS = 180;

export type Recovery = {
  fromAvailable: number;
  fromAccrued: number;
  carriedForward: number;
  directRecoveryEligible: boolean;
  writeOffAfterDays: number | null;
};

export function planRecovery(
  amountPaise: number,
  availablePaise: number,
  accruedPaise: number,
  fraudEstablished = false,
): Recovery {
  const fromAvailable = Math.max(0, Math.min(amountPaise, availablePaise));
  const afterAvailable = amountPaise - fromAvailable;
  const fromAccrued = Math.max(0, Math.min(afterAvailable, accruedPaise));
  const carriedForward = afterAvailable - fromAccrued;
  return {
    fromAvailable,
    fromAccrued,
    carriedForward,
    // Fraud AND size. Either alone is not enough: chasing a small balance is
    // a legal cost with no recovery, and chasing a large one without evidence
    // is a claim that cannot be substantiated.
    directRecoveryEligible: fraudEstablished && carriedForward > DIRECT_RECOVERY_PAISE,
    writeOffAfterDays: carriedForward > 0 ? WRITE_OFF_DAYS : null,
  };
}

/**
 * Clawback recovers money that was never genuinely earned — a refunded charge
 * was not income. It is NOT a penalty, and it must never be used as one: if
 * earnings were legitimate and later conduct was bad, future earnings are
 * suspended (creator_accounts.earnings_suspended) and past ones stand.
 */
export const CLAWBACK_IS_NOT_A_PENALTY = true;

/** B6 — the gate. The activity requirement is what filters bought followers. */
export const ELIGIBILITY = {
  minFollowers: 1000,
  minActiveDays: 10,
  activityWindowDays: 90,
  minAge: 18,
} as const;
