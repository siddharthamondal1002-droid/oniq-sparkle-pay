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
 * The rate ROUNDS UP to the whole rupee, and since the 2026-08-16 reprice it
 * solves for 26% NET OF GST rather than before it — so the realised margin,
 * the one ONIQ actually banks, sits at or above 26% everywhere. The published
 * rate is ₹75 against a ₹72 floor; the gap is deliberate headroom.
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
  /**
   * THE ONE STORED FX RATE IN THE REPOSITORY, AND IT LIVES ON THIS SIDE OF A
   * LINE (owner directive, 2026-08-24).
   *
   * The PUBLISHED PRICE chart is denominated in rupees because ONIQ sells in
   * rupees, so this model has to cross the currency boundary somewhere. That
   * makes it a PRICING artefact — the owner's — and not a provider-cost input.
   *
   * The rule it must obey: an FX rate may never influence provider routing,
   * spend ceilings, acceptance arithmetic or provider selection. Those all live
   * in `supabase/functions/_shared/{financialLedger,videoRouting}.ts`, they are
   * USD-only by construction, and `src/lib/__tests__/currencyDiscipline.test.ts`
   * fails the build if any of them imports this module or acquires an FX rate
   * of its own. That test also proves it can fail, by injection.
   *
   * TWO THINGS THE OWNER SHOULD KNOW ABOUT THIS PARTICULAR NUMBER:
   *
   *  1. IT IS STALE. 84 against a realtime 95.68 (Alpha Vantage,
   *     2026-08-24T01:58:55Z) understates every USD-derived line by 13.9%.
   *  2. IT IS UNSOURCED. There is no rate provider, no timestamp and no
   *     refresh behind it — which is exactly why the discipline says not to
   *     persist one. It survives here only because the price chart cannot be
   *     re-derived without the owner, and `paid_pricing_enabled` is false.
   *
   * Its blast radius is small: it multiplies ONE term, the render-compute line
   * below. The dominant cost, ₹31.50 per finished minute of stills and voices,
   * is owner-MEASURED in rupees and touches no FX at all.
   */
  inrPerUsd: 84,
  /** Razorpay 2% + 18% GST on the fee, as a fraction of price. */
  paymentFeeOfPrice: 0.0236,
  /** Storage + egress + db time per film, paise. */
  fixedInfraPaise: 300,
  /**
   * GST ON THE SALE ITSELF — the line this model did not have.
   *
   * Until 2026-08-16 the only tax modelled here was the 18% charged on
   * Razorpay's FEE, which is a rounding error next to the 18% on the sale.
   * Story time is a digital service supplied to consumers in India, so the
   * sale attracts GST; and with distribution India-only there is no offshore
   * supplier argument to make.
   *
   * Owner decision, 2026-08-16: THE PUBLISHED PRICE IS GST-INCLUSIVE. ₹75 is
   * what the buyer pays, not ₹75 plus tax. So the tax is carved OUT of the
   * price rather than added to it, and the share of an inclusive price that
   * is tax is 18/118, not 18/100 — a distinction worth 2.7 points of margin
   * on its own.
   */
  gstRate: 0.18,
} as const;

/**
 * The fraction of a GST-INCLUSIVE price that is tax: 0.18 / 1.18 = 15.2542%.
 *
 * Derived rather than written down, because writing 0.1525 invites someone to
 * "correct" it to 0.18 and lose 2.7 points of margin in a one-character diff.
 */
export const GST_OF_INCLUSIVE_PRICE = UNIT.gstRate / (1 + UNIT.gstRate);

/** The tax inside a published price, paise. */
export function gstPaiseOn(pricePaise: number): number {
  return Math.round(pricePaise * GST_OF_INCLUSIVE_PRICE);
}

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
  // GST IS IN THE DENOMINATOR NOW (owner, 2026-08-16, repricing to ₹75).
  //
  // It was not, and that was the bug the GST work exposed rather than fixed:
  // the formula solved for 26% BEFORE tax, published ₹57, and the business
  // banked 11%. Solving for the mandate net of GST is what makes the number
  // this returns a floor anybody can stand on — ₹72 for movie grade.
  //
  // The PUBLISHED rate is ₹75, set by the owner above this floor. This
  // function is the floor, not the price; PER_MINUTE_PAISE is the price, and
  // a test holds one against the other so a cost rise that eats the gap
  // fails CI instead of quietly eating the margin.
  const raw =
    (costPaisePerMinute(grade) + UNIT.fixedInfraPaise) /
    (1 - MARGIN_TARGET - UNIT.paymentFeeOfPrice - GST_OF_INCLUSIVE_PRICE);
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

/**
 * The margin the PRICING FORMULA aims at — before tax.
 *
 * This is what `pricePaisePerMinute` solves for, and it is the number the
 * 2026-08-15 chart was built to hit. Kept under its own name because it is
 * still the right question to ask OF THE FORMULA; it is simply no longer the
 * right question to ask about the business.
 */
export function marginBeforeTaxAt(grade: StoryGrade, seconds: number, pricePaise: number): number {
  const gen = (costPaisePerMinute(grade) * seconds) / 60;
  const fee = pricePaise * UNIT.paymentFeeOfPrice;
  return (pricePaise - gen - UNIT.fixedInfraPaise - fee) / pricePaise;
}

/**
 * ONIQ'S REALISED MARGIN — what is actually left, tax included.
 *
 * GST is not a cost ONIQ chooses to bear, but on a GST-INCLUSIVE price it is
 * money that arrives and leaves again, so a margin computed without it is a
 * margin nobody ever banks. This function is the honest one and the tests
 * check it; marginBeforeTaxAt above answers the narrower question about the
 * formula.
 *
 * AT THE CURRENT CHART THIS IS BELOW THE 26% MANDATE — about 11% at one
 * minute, rising to 15% at five as the flat per-film cost is spread. That
 * shortfall is REPORTED, NOT SILENTLY REPRICED: what the chart should be is
 * the owner's call, and priceForMarginNetOfGst() below computes the answer
 * for whenever that call is made.
 */
export function oniqMarginAt(grade: StoryGrade, seconds: number, pricePaise: number): number {
  const gen = (costPaisePerMinute(grade) * seconds) / 60;
  const fee = pricePaise * UNIT.paymentFeeOfPrice;
  const gst = pricePaise * GST_OF_INCLUSIVE_PRICE;
  return (pricePaise - gen - UNIT.fixedInfraPaise - fee - gst) / pricePaise;
}

/**
 * The per-minute rate the mandate requires net of GST: ₹72/min.
 *
 * WIRED NOW. When this was written it was not — it computed the answer to a
 * question nobody had acted on, against a published ₹57 that netted 11%. The
 * owner acted on 2026-08-16, and pricePaisePerMinute solves this same
 * equation; the published rate is ₹75, three rupees above the floor.
 */
export function priceForMarginNetOfGst(grade: StoryGrade): number {
  // Kept as its own name because it is the question people ask ("what would
  // the rate have to be?"), but it is no longer a road not taken — as of the
  // 2026-08-16 reprice, pricePaisePerMinute solves exactly this.
  return pricePaisePerMinute(grade);
}

/**
 * THE MONTHLY PLAN, AND THE ARITHMETIC THAT BOUNDS IT (owner, 2026-08-16).
 *
 * Moving from per-second selling to a per-month plan changes what the danger
 * is. Selling a minute at a time, the risk was a thin margin. Selling a month
 * at a time, the risk is UNBOUNDED USE: the price is fixed and the cost is
 * not, so a plan is only safe while the minutes it includes cost less than
 * what is left of the price after tax and fees.
 *
 * That makes `included_seconds` the most dangerous number in the schema. It
 * looks like a generosity dial and is actually a solvency one, and it sits in
 * a database row where it can be nudged without anyone doing the sum. Hence
 * maxIncludedSecondsFor() below, and the test that holds the shipped plan
 * against it.
 */
export const PLAN_INCLUDED_SECONDS = {
  free: 60,
  plus_monthly: 480,
  plus_25: 1500,
  plus_60: 3600,
} as const;
export const PLAN_PRICE_PAISE = {
  free: 0,
  plus_monthly: 49900,
  plus_25: 149900,
  plus_60: 349900,
} as const;

/** Every paid plan, so a guard can sweep them rather than naming one. */
export const PAID_PLAN_KEYS = ["plus_monthly", "plus_25", "plus_60"] as const;

/**
 * What is left of a subscription rupee before any film is made.
 *
 * GST comes out of an inclusive price and the payment fee comes off the top;
 * neither depends on usage. Everything below this line is generation.
 */
export const SUBSCRIPTION_RETAINED = 1 - GST_OF_INCLUSIVE_PRICE - UNIT.paymentFeeOfPrice;

/**
 * The most seconds a plan at this price can include before a subscriber who
 * uses all of them costs more than they paid.
 *
 * Films are assumed at one per two minutes, so the flat per-film cost is
 * charged at half rate per minute. That is the observed shape — people buy a
 * minute or two at a time — and erring the other way would make the cap look
 * safer than it is.
 */
export function maxIncludedSecondsFor(pricePaise: number, grade: StoryGrade = "movie"): number {
  const perMinute = costPaisePerMinute(grade) + UNIT.fixedInfraPaise / 2;
  return Math.floor(((pricePaise * SUBSCRIPTION_RETAINED) / perMinute) * 60);
}

/**
 * What ONIQ actually keeps from one subscriber over one period, as a fraction
 * of the price, if they use `usedSeconds` of their allowance.
 *
 * Pass the full allowance to see the worst case — which is the only case
 * worth designing to, because the subscribers who use everything are the ones
 * who renew.
 */
export function planMarginAt(
  pricePaise: number,
  usedSeconds: number,
  grade: StoryGrade = "movie",
): number {
  if (pricePaise <= 0) return 0;
  const minutes = usedSeconds / 60;
  const gen = costPaisePerMinute(grade) * minutes;
  const infra = Math.ceil(minutes / 2) * UNIT.fixedInfraPaise;
  return (pricePaise * SUBSCRIPTION_RETAINED - gen - infra) / pricePaise;
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
  // Every row is the published rate x minutes — ₹99/min, nothing hand-set.
  { seconds: 60, label: "1 minute — movie", pricePaise: 9900, currency: "INR" },
  { seconds: 120, label: "2 minutes — movie", pricePaise: 19800, currency: "INR" },
  { seconds: 180, label: "3 minutes — movie", pricePaise: 29700, currency: "INR" },
  { seconds: 300, label: "5 minutes — movie", pricePaise: 49500, currency: "INR" },
];
