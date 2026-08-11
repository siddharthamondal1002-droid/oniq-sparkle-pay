/**
 * The arithmetic behind the Story price chart — "do the number" as code.
 *
 * PRICING POLICY (owner directive, 2026-08-11): every tier covers its
 * generation AND infrastructure cost, and ONIQ's margin is set BY DURATION —
 * 28% on the shortest films, 26% mid, 21% on the longest. Longer films
 * deliberately carry the thinnest margin: quality at affordable prices, and
 * the discount deepens as the commitment grows. Prices are DERIVED from that
 * policy, not hand-picked — `priceFor()` below is the formula, the published
 * charts are its output rounded up to the whole rupee, and the test holds
 * every published price within 1.5 points of its mandated margin.
 *
 * WHAT COUNTS AS COST:
 * - Generation (per finished minute): 8.7 shots measured on the Aladdin
 *   build; images at ~$0.039 (gemini-2.5-flash-image list), narration +
 *   worst-case dialogue TTS ~$0.032/min; movie grade adds 60 output-seconds
 *   of video per minute at Veo list $0.15/s. INR at 84/USD.
 * - Infrastructure (per purchase): Razorpay's fee — 2% + 18% GST on the fee
 *   = 2.36% OF PRICE — plus a flat ₹3 for storage, egress and database time
 *   per film. These are what "infrastructural cost is met" pays for.
 *
 * WHAT IT IS NOT. Nothing here charges anybody — `story_price_tiers` is the
 * only thing that bills. This module justifies those rows and CI keeps the
 * two in agreement.
 */

export type StoryGrade = "classic" | "movie";

/** Named unit costs. Exported so the test and any price review read ONE set. */
export const UNIT = {
  shotsPerMinute: 8.7,
  usdPerImage: 0.039,
  usdTtsPerMinute: 0.032,
  usdPerVideoSecond: 0.15,
  inrPerUsd: 84,
  /** Razorpay 2% + 18% GST on the fee, as a fraction of price. */
  paymentFeeOfPrice: 0.0236,
  /** Storage + egress + db time per film, paise. */
  fixedInfraPaise: 300,
} as const;

/**
 * ONIQ's mandated margin by duration: 28% short, 26% mid, 21% long.
 * The higher the duration, the lower the take.
 */
export function marginTargetFor(seconds: number): number {
  if (seconds <= 30) return 0.28;
  if (seconds <= 120) return 0.26;
  return 0.21;
}

/** Generation cost of one finished minute, in paise, for a pipeline grade. */
export function costPaisePerMinute(grade: StoryGrade): number {
  const stills = UNIT.shotsPerMinute * UNIT.usdPerImage;
  const tts = UNIT.usdTtsPerMinute;
  let usd = stills + tts;
  if (grade === "movie") usd += 60 * UNIT.usdPerVideoSecond;
  return Math.round(usd * UNIT.inrPerUsd * 100);
}

/**
 * The derived price: cost recovered, payment fee recovered, mandated margin
 * on top — rounded UP to the whole rupee.
 *
 *   price = (generation + fixedInfra) / (1 - margin - paymentFee)
 */
export function priceFor(grade: StoryGrade, seconds: number): number {
  const gen = (costPaisePerMinute(grade) * seconds) / 60;
  const raw = (gen + UNIT.fixedInfraPaise) / (1 - marginTargetFor(seconds) - UNIT.paymentFeeOfPrice);
  return Math.ceil(raw / 100) * 100;
}

/** ONIQ's realised margin for a published price, 0..1 — what the test checks. */
export function oniqMarginAt(grade: StoryGrade, seconds: number, pricePaise: number): number {
  const gen = (costPaisePerMinute(grade) * seconds) / 60;
  const fee = pricePaise * UNIT.paymentFeeOfPrice;
  return (pricePaise - gen - UNIT.fixedInfraPaise - fee) / pricePaise;
}

/**
 * The movie chart at the mandated margins — `priceFor("movie", s)` for each
 * duration, frozen here so the SQL mirror test has a hand-auditable copy.
 * Rows stay INACTIVE in the database until the clip stage ships.
 */
export const MOVIE_TIERS: readonly {
  seconds: number;
  label: string;
  pricePaise: number;
  currency: "INR";
}[] = [
  { seconds: 30, label: "30 seconds — movie", pricePaise: 57000, currency: "INR" },
  { seconds: 60, label: "1 minute — movie", pricePaise: 110300, currency: "INR" },
  { seconds: 120, label: "2 minutes — movie", pricePaise: 220200, currency: "INR" },
  { seconds: 180, label: "3 minutes — movie", pricePaise: 308600, currency: "INR" },
  { seconds: 300, label: "5 minutes — movie", pricePaise: 514000, currency: "INR" },
];
