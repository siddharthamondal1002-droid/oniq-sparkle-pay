/**
 * The arithmetic behind the Story price chart — "do the number" as code.
 *
 * WHAT THIS IS. Every price in `story_price_tiers` should be defensible from
 * unit costs, and the unit costs should be written down where a price review
 * can see them. This module is that: the per-minute cost of each pipeline
 * grade, computed from named assumptions, and the margin each published tier
 * carries. `storyCostModel.test.ts` asserts the published charts actually
 * clear the margin floor, so a unit-cost update that silently makes a tier
 * loss-making fails CI instead of showing up on a bill.
 *
 * WHAT IT IS NOT. Nothing here charges anybody. The database chart
 * (`story_price_tiers`) is the only thing that bills, and it is hand-written
 * in the migration — this module justifies those numbers, it does not
 * generate them.
 *
 * THE ASSUMPTIONS, marked and revisable:
 * - Shots per minute: 8.7 measured on the Aladdin build (60 shots / 6:54),
 *   see storyPlan.ts. Classic renders one still per shot; movie grade adds
 *   one ~10s video clip per shot.
 * - Image generation (gemini-2.5-flash-image): ~$0.039 per image at list.
 * - TTS narration (gemini-2.5-flash-preview-tts): ~$0.016 per finished
 *   minute at list. Dialogue adds at most one extra short TTS call per shot —
 *   pennies, absorbed.
 * - Veo video: $0.15 per OUTPUT SECOND (Veo 3 Fast list price on the Gemini
 *   API, 2026). veo-3.1-lite through the Lovable gateway may be cheaper;
 *   until measured, the list price is the honest planning number. This is
 *   THE number that separates the grades: ~$9/minute of finished movie
 *   video before anything else.
 * - INR per USD: 84. Update when it moves materially; the margin floor test
 *   has headroom for drift.
 */

export type StoryGrade = "classic" | "movie";

/** Named unit costs. Exported so the test and any price review read ONE set. */
export const UNIT = {
  shotsPerMinute: 8.7,
  usdPerImage: 0.039,
  usdTtsPerMinute: 0.016,
  usdPerVideoSecond: 0.15,
  clipSecondsPerShot: 10,
  inrPerUsd: 84,
} as const;

/** Cost of one finished minute, in paise, for a pipeline grade. */
export function costPaisePerMinute(grade: StoryGrade): number {
  const stills = UNIT.shotsPerMinute * UNIT.usdPerImage;
  const tts = UNIT.usdTtsPerMinute * 2; // narration + worst-case dialogue
  let usd = stills + tts;
  if (grade === "movie") {
    // One clip per shot; a shot's clip covers its slice of the minute, so the
    // video cost is simply 60 output-seconds' worth per finished minute.
    usd += 60 * UNIT.usdPerVideoSecond;
  }
  return Math.round(usd * UNIT.inrPerUsd * 100);
}

/** Margin a tier carries at these unit costs, 0..1. */
export function tierMargin(grade: StoryGrade, seconds: number, pricePaise: number): number {
  const cost = (costPaisePerMinute(grade) * seconds) / 60;
  return (pricePaise - cost) / pricePaise;
}

/**
 * The movie chart, derived and rounded to price points. Mirrors the
 * `grade='movie'` seed rows (inactive until the clip stage ships) the same
 * way PRICE_TIERS mirrors the classic ones — and the SQL test holds the two
 * together. At list Veo pricing these carry ~55–62% margin; the classic
 * tiers at the same arithmetic carry ~60–70%.
 */
export const MOVIE_TIERS: readonly {
  seconds: number;
  label: string;
  pricePaise: number;
  currency: "INR";
}[] = [
  { seconds: 30, label: "30 seconds — movie", pricePaise: 99900, currency: "INR" },
  { seconds: 60, label: "1 minute — movie", pricePaise: 189900, currency: "INR" },
  { seconds: 120, label: "2 minutes — movie", pricePaise: 349900, currency: "INR" },
  { seconds: 180, label: "3 minutes — movie", pricePaise: 499900, currency: "INR" },
  { seconds: 300, label: "5 minutes — movie", pricePaise: 799900, currency: "INR" },
];
