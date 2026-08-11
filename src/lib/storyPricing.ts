/**
 * The published price chart for Story time — the TypeScript copy.
 *
 * THE DATABASE IS THE ONE THAT CHARGES. `story_price_tiers` is what
 * `create_story_purchase` reads under the row that becomes the receipt, and a
 * price correction is an UPDATE there, live immediately, no deploy. This copy
 * exists because screens need a synchronous shape to render against and a
 * place to put the formatting; it is never the amount anybody is charged.
 *
 * TWO COPIES OF A PRICE IS EXACTLY THE DRIFT THAT SHOWS UP FIRST ON A BILL, so
 * the copies are not allowed to disagree: `storyPricingSql.test.ts` parses the
 * migration that seeds the table and fails the moment this array and that
 * insert say different things. Change a price by changing BOTH — the test is
 * the reminder, not the enforcement; the enforcement is that the database one
 * is the only one that bills.
 */
import { moneyIn } from "@/lib/format";

export type StoryPriceTier = {
  /** The tier key — what the client sends to `razorpay-order` as `seconds`. */
  seconds: number;
  /** Shown on the buy button. */
  label: string;
  /** Paise, because that is the integer Razorpay charges in. */
  pricePaise: number;
  currency: "INR";
};

/** Mirrors the `story_price_tiers` seed rows, in `sort_order`. */
// Repriced 2026-08-11 to the mandated margin policy (28% short / 26% mid /
// 21% long, infrastructure recovered) — see storyCostModel.priceFor(), which
// DERIVES these numbers. Exact-formula prices, not retail-pretty ones: the
// margin is the requirement, and ₹48 at 26.4% beats ₹49 at "about right".
export const PRICE_TIERS: readonly StoryPriceTier[] = [
  { seconds: 30, label: "30 seconds", pricePaise: 2700, currency: "INR" },
  { seconds: 60, label: "1 minute", pricePaise: 4800, currency: "INR" },
  { seconds: 120, label: "2 minutes", pricePaise: 9200, currency: "INR" },
  { seconds: 180, label: "3 minutes", pricePaise: 12600, currency: "INR" },
  { seconds: 300, label: "5 minutes", pricePaise: 20800, currency: "INR" },
];

/**
 * Paise to a display string, via the i18n fence. Tiers are denominated in a
 * FIXED currency (the one the Razorpay account settles in), which is exactly
 * the case `moneyIn` exists for — grouping follows the viewer's locale, the
 * currency stays pinned to the data.
 */
export function formatPaise(paise: number, currency: string = "INR"): string {
  return moneyIn(paise / 100, currency);
}

/** The purchase-surface half of `story_quota_status`. */
export type StoryPurchaseSurface = {
  purchaseEnabled: boolean;
  nativeLinkOut: boolean;
  checkoutUrl?: string | null;
};

export type StoryCheckoutTarget =
  /** Offer nothing. The reader-app posture — no buy button exists at all. */
  | { kind: "none" }
  /** A web page: checkout runs right here, via `payForStorySeconds`. */
  | { kind: "in-page" }
  /** The native app: open this URL in the system browser and collect there. */
  | { kind: "link-out"; url: string };

/**
 * Where — if anywhere — this surface may offer Story time for sale.
 *
 * THIS IS THE PLAY-POLICY LINE, CLIENT SIDE. Story time is digital content
 * consumed in the app, so the native build never collects the money: it either
 * links out to the website or shows nothing, and which of those is a CONFIG ROW
 * (`story_purchase_config.native_link_out`) because Play's position on steering
 * has moved twice in two years and an app resubmission takes days. Flipping
 * that row to false leaves the website selling exactly as before and the app
 * simply not mentioning it — the shape Play has never objected to.
 *
 * PURE, so a test can hold the whole truth table. The caller supplies
 * `isNative` (Capacitor.isNativePlatform()) and the surface fields from
 * `story_quota_status`.
 *
 * The https check is not decoration: `checkout_url` is a mutable row read by
 * the client, and a mutable redirect target is a phishing primitive if the
 * wrong role ever gets write access. The database CHECKs the same thing; this
 * repeats it because defence at the point of navigation is cheap.
 */
export function checkoutTarget(
  surface: StoryPurchaseSurface,
  isNative: boolean,
): StoryCheckoutTarget {
  if (!surface.purchaseEnabled) return { kind: "none" };
  if (!isNative) return { kind: "in-page" };
  if (!surface.nativeLinkOut) return { kind: "none" };
  const url = surface.checkoutUrl ?? "";
  if (!url.startsWith("https://")) return { kind: "none" };
  // `from=app` is how /pay/story knows to record origin=native-handoff on the
  // purchase row. Provenance for the audit trail, never authorisation.
  return { kind: "link-out", url: url + (url.includes("?") ? "&" : "?") + "from=app" };
}
