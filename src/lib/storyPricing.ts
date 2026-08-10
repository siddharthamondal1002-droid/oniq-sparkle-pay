/**
 * What a Story costs to make, and what it is sold for.
 *
 * THE COST SIDE IS DERIVED, NOT GUESSED. Everything here is computed from
 * `planStory` and from figures measured during the build, so changing the shot
 * rate or the render speed moves the cost automatically instead of leaving a
 * hardcoded number to rot:
 *
 *   shots         8.5 per minute — measured, 60 shots across 6:54 of Episode 3
 *   generations   two per shot — one still, one narration line
 *   render        0.264x realtime — measured on the live runner, 1010 frames
 *                 in 127.3s. A minute of film is ~3.8 minutes of runner.
 *   boot          ~75s per job before a frame is drawn: checkout, npm install
 *                 and a 91.9 MB Chromium download. Fixed, so it hurts short
 *                 films far more than long ones — which is why a 30-second
 *                 Story is not a sixth of the cost of a three-minute one.
 *
 * WHERE THE RATES COME FROM IS THE WEAK PART, and it is marked rather than
 * hidden. The runner rate is GitHub's published list price. The Gemini rates
 * are PLACEHOLDERS: I did not have the rate card, and inventing provider prices
 * that later get quoted as fact is worse than an obvious gap. Replace
 * DEFAULT_RATES with the real numbers before pricing anything publicly — every
 * function here takes rates as an argument precisely so that is a one-line
 * change and not a search.
 *
 * PLAY BILLING, NOT RAZORPAY. A Story is digital content consumed inside the
 * app. Google Play requires Play Billing for that and forbids third-party
 * processors; the Razorpay work is scoped to physical goods and its schema
 * comment says so explicitly. This module prices the thing; it deliberately
 * knows nothing about how the money is collected, because the answer differs
 * per platform — Play Billing on Android, StoreKit on iOS, Razorpay only on the
 * web.
 *
 * PURE. No network, no clock, no Supabase — same as storyPlan and
 * shotAllocation, and for the same reason: money decisions derived in two
 * places drift, and the drift is only visible on a bill.
 */
import { planStory } from "./storyPlan.ts";

/**
 * Every unit price, in paise, so nothing here touches a float.
 *
 * Paise rather than rupees is not fussiness: 249.90 * 100 is
 * 24989.999999999996 in IEEE 754, and a price that is a fraction of a paise out
 * is a price that fails a checksum somewhere downstream.
 */
export type StoryCostRates = {
  /** One 9:16 still from gemini-2.5-flash-image. */
  imagePaise: number;
  /** One second of narration from gemini-2.5-flash-preview-tts. */
  ttsPaisePerSecond: number;
  /** One call to story-plot. Roughly fixed per Story, per Claude's token cost. */
  plotPaise: number;
  /** One minute of a 2-core GitHub Actions Linux runner. */
  runnerPaisePerMinute: number;
};

/**
 * PLACEHOLDER RATES. Two of these are real; two are not.
 *
 * VERIFIED:
 *   runnerPaisePerMinute — GitHub's list price for a 2-core Linux runner is
 *   $0.008/min. At ~₹84/$ that is 67 paise. Check it against your plan's
 *   included minutes: the first 2,000 a month are free on Pro, so the true
 *   marginal cost is zero until that is spent and 67 paise after.
 *
 * NOT VERIFIED — replace before charging anybody:
 *   imagePaise, ttsPaisePerSecond, plotPaise. I did not have Google's or
 *   Anthropic's current rate card and did not want to invent numbers that would
 *   later be quoted back as measured. They are deliberately round so that
 *   nobody mistakes them for observations.
 */
export const DEFAULT_RATES: StoryCostRates = {
  imagePaise: 300,
  ttsPaisePerSecond: 15,
  plotPaise: 500,
  runnerPaisePerMinute: 67,
};

/** Measured on the live runner: 1010 frames in 127.3s. */
export const RENDER_REALTIME_FACTOR = 0.264;

/** Measured: checkout, npm install and a 91.9 MB Chromium download. */
export const RUNNER_BOOT_SECONDS = 75;

export type StoryCost = {
  seconds: number;
  shots: number;
  /** Paise, itemised so a surprising total can be explained rather than argued. */
  breakdown: { plot: number; images: number; narration: number; runner: number };
  totalPaise: number;
};

/**
 * What one Story costs us to produce.
 *
 * The runner term includes the fixed boot, and that is the whole reason short
 * Stories are disproportionately expensive: 75 seconds of Chromium download is
 * charged whether the film is thirty seconds or five minutes.
 */
export function costOf(seconds: number, rates: StoryCostRates = DEFAULT_RATES): StoryCost {
  const plan = planStory(seconds);
  const shots = plan.shots.length;

  const renderSeconds = plan.seconds / RENDER_REALTIME_FACTOR;
  const runnerMinutes = (RUNNER_BOOT_SECONDS + renderSeconds) / 60;

  const breakdown = {
    plot: rates.plotPaise,
    images: shots * rates.imagePaise,
    // Narration covers the whole film: every second of finished video is a
    // second somebody was reading.
    narration: Math.round(plan.seconds * rates.ttsPaisePerSecond),
    runner: Math.round(runnerMinutes * rates.runnerPaisePerMinute),
  };

  return {
    seconds: plan.seconds,
    shots,
    breakdown,
    totalPaise: breakdown.plot + breakdown.images + breakdown.narration + breakdown.runner,
  };
}

/**
 * The margin every published price must clear.
 *
 * 2.0 is not a profit target, it is a safety factor. The Gemini rates above are
 * unverified, generation occasionally retries, and a failed Story is refunded
 * to the user but still cost us the images it bought before it died. A price at
 * cost is a price that loses money the first time anything goes wrong.
 */
export const MIN_MARGIN = 2.0;

export type PriceTier = {
  seconds: number;
  label: string;
  /** What the user pays, in paise. */
  pricePaise: number;
};

/**
 * The price chart. ROUNDED TO SOMETHING A PERSON WOULD SAY.
 *
 * EVERY NUMBER HERE WAS SET AFTER RUNNING costOf, not before. The first draft
 * of this file guessed ₹29 / ₹49 / ₹89 / ₹199, and the margin test rejected all
 * four — the five-minute tier was ₹199 against a cost of ₹192.53, a 3% margin
 * on a job that buys 43 images. That is the entire reason the test exists, and
 * it is worth knowing that the guess was wrong by a factor of two, not by a
 * rounding error, before anyone edits these by eye again.
 *
 * PER STORY, NOT A FLAT PER-MINUTE RATE. Cost is not linear in length, so one
 * rate per minute would either overcharge the long film or lose money on the
 * short one. `perMinutePaise` is derived FOR DISPLAY — it is what the chart
 * shows, never what anything computes with.
 *
 * The per-minute figure is flat across the first minute (₹98 then ₹99) and only
 * starts falling after it. That is not a slip: below a minute the shot count is
 * still climbing faster than the clock — 4 shots at 30s but 9 at 60s — so there
 * is genuinely no economy of scale to pass on yet. It appears past a minute,
 * where the shot rate settles and the fixed runner boot is spread wider.
 */
export const PRICE_TIERS: readonly PriceTier[] = [
  { seconds: 30, label: "30 seconds", pricePaise: 4900 },
  { seconds: 60, label: "1 minute", pricePaise: 9900 },
  { seconds: 120, label: "2 minutes", pricePaise: 17900 },
  { seconds: 180, label: "3 minutes", pricePaise: 24900 },
  { seconds: 300, label: "5 minutes", pricePaise: 39900 },
] as const;

// NO FORMATTER HERE, DELIBERATELY. A first draft exported a `rupees()` helper
// and the currency fence rejected it, correctly: this module knows amounts, not
// how to render them. Callers pass `paise / 100` to the project's moneyIn() /
// useFormat().money(), which already knows the user's locale — a hardcoded ₹
// would be wrong for every user outside India, and ONIQ ships to seven
// countries.

export type PricedTier = PriceTier & {
  cost: StoryCost;
  /** price / cost. Below MIN_MARGIN is a tier that should not ship. */
  margin: number;
  /** Derived for the chart only. */
  perMinutePaise: number;
};

/** The chart with its economics attached, so a price can be justified. */
export function priceChart(rates: StoryCostRates = DEFAULT_RATES): PricedTier[] {
  return PRICE_TIERS.map((tier) => {
    const cost = costOf(tier.seconds, rates);
    return {
      ...tier,
      cost,
      margin: cost.totalPaise === 0 ? Infinity : tier.pricePaise / cost.totalPaise,
      perMinutePaise: Math.round((tier.pricePaise / tier.seconds) * 60),
    };
  });
}

/**
 * What a given length costs the user.
 *
 * Rounds UP to the next tier rather than interpolating. Somebody asking for 90
 * seconds gets the two-minute price and a two-minute allowance — which is the
 * honest way round, because interpolating would mean quoting a price for a
 * length no tier was costed against.
 */
export function priceFor(seconds: number): PriceTier | null {
  return PRICE_TIERS.find((t) => seconds <= t.seconds) ?? null;
}
