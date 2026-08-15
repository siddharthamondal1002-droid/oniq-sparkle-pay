/**
 * The arithmetic behind the Story price chart — "do the number" as code.
 *
 * PRICING POLICY (owner directive, 2026-08-15): THERE ARE NO TIERS. One
 * per-minute rate per grade, one margin — 26% — and every published price is
 * that rate times the minutes bought. The old policy (2026-08-11) set the
 * margin BY DURATION, 28/26/21, so five durations carried five different
 * takes and a price could only be reasoned about one row at a time. A single
 * rate is the thing the owner asked for and the thing a buyer can check.
 *
 * The rate ROUNDS UP to the whole rupee, so the realised margin sits at or
 * above 26% everywhere and never below it.
 *
 * WHAT COUNTS AS COST:
 * - Generation (per finished minute): ₹31.50, OWNER-SUPPLIED AND MEASURED
 *   (2026-08-15) — the real cost of one finished minute of stills and
 *   voices through the Lovable gateway. This replaces the old derivation
 *   from USD list prices (8.7 shots x $0.039 + $0.032 TTS = ₹31.19), which
 *   was an estimate of a bill nobody had seen. A measured number outranks a
 *   modelled one; the derivation is kept below only as the sanity check it
 *   now is.
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
  /**
   * THE MEASURED GENERATION COST of one finished minute — stills and voices,
   * paise. Owner-supplied 2026-08-15. Every price on the chart is built on
   * this one number.
   */
  genPaisePerMinute: 3150,
  /** The superseded derivation, retained purely to sanity-check the above. */
  shotsPerMinute: 8.7,
  usdPerImage: 0.039,
  usdTtsPerMinute: 0.032,
  /**
   * THE MOVIE GRADE IS THE IN-HOUSE ENGINE (owner directive, 2026-08-13):
   * the owned cinematography stack — multi-plane parallax, rigged
   * characters, VFX layers, dialogue voices, film look — not rented video
   * generation. Its marginal cost is the same stills and voices as classic
   * plus RENDER COMPUTE: classic measured 4.5 runner-minutes per finished
   * minute, and the richer movie composition is budgeted at 2x that,
   * priced at GitHub's overage rate so the chart stays honest even past
   * the free tier.
   */
  runnerMinutesPerFinishedMinute: 9,
  usdPerRunnerMinute: 0.008,
  inrPerUsd: 84,
  /** Razorpay 2% + 18% GST on the fee, as a fraction of price. */
  paymentFeeOfPrice: 0.0236,
  /** Storage + egress + db time per film, paise. */
  fixedInfraPaise: 300,
} as const;

/**
 * ONIQ's mandated margin — one number, every duration (owner, 2026-08-15).
 * Kept as a function so the call sites read the same as before and so a
 * future duration policy has somewhere to live again.
 */
export const MARGIN_TARGET = 0.26;
export function marginTargetFor(_seconds?: number): number {
  return MARGIN_TARGET;
}

/** Generation cost of one finished minute, in paise, for a pipeline grade. */
export function costPaisePerMinute(grade: StoryGrade): number {
  // Stills and voices: the MEASURED figure. Render compute is ONIQ's own
  // runner time, billed by GitHub rather than by the gateway, so it is still
  // derived and still added only for the movie grade.
  let paise = UNIT.genPaisePerMinute;
  if (grade === "movie") {
    paise += UNIT.runnerMinutesPerFinishedMinute * UNIT.usdPerRunnerMinute * UNIT.inrPerUsd * 100;
  }
  return Math.round(paise);
}

/**
 * THE PUBLISHED RATE: what one minute of film costs a buyer, paise.
 *
 * The flat per-film infrastructure cost is recovered inside the rate rather
 * than as a separate line, because the owner asked for a per-minute price and
 * a two-part tariff is not one. The consequence is deliberate and worth
 * naming: a five-minute film recovers that ₹3 five times over, so its
 * realised margin lands ABOVE the 26% mandate rather than on it. The mandate
 * is a floor.
 */
export function pricePaisePerMinute(grade: StoryGrade): number {
  const raw =
    (costPaisePerMinute(grade) + UNIT.fixedInfraPaise) /
    (1 - MARGIN_TARGET - UNIT.paymentFeeOfPrice);
  return Math.ceil(raw / 100) * 100;
}

/**
 * The derived price: cost recovered, payment fee recovered, mandated margin
 * on top — rounded UP to the whole rupee.
 *
 *   price = (generation + fixedInfra) / (1 - margin - paymentFee)
 */
export function priceFor(grade: StoryGrade, seconds: number): number {
  // Strictly linear in the rate — that IS the no-tiers policy. Nothing here
  // may special-case a duration; if it ever does, tiers are back.
  return Math.round((pricePaisePerMinute(grade) * seconds) / 60);
}

/** ONIQ's realised margin for a published price, 0..1 — what the test checks. */
export function oniqMarginAt(grade: StoryGrade, seconds: number, pricePaise: number): number {
  const gen = (costPaisePerMinute(grade) * seconds) / 60;
  const fee = pricePaise * UNIT.paymentFeeOfPrice;
  return (pricePaise - gen - UNIT.fixedInfraPaise - fee) / pricePaise;
}

/**
 * The movie durations at the published rate — `priceFor("movie", s)` for
 * each, frozen here so the SQL mirror test has a hand-auditable copy.
 */
export const MOVIE_TIERS: readonly {
  seconds: number;
  label: string;
  pricePaise: number;
  currency: "INR";
}[] = [
  // Every row is priceFor("movie", seconds) — ₹57/min, nothing hand-set.
  { seconds: 60, label: "1 minute — movie", pricePaise: 5700, currency: "INR" },
  { seconds: 120, label: "2 minutes — movie", pricePaise: 11400, currency: "INR" },
  { seconds: 180, label: "3 minutes — movie", pricePaise: 17100, currency: "INR" },
  { seconds: 300, label: "5 minutes — movie", pricePaise: 28500, currency: "INR" },
];
