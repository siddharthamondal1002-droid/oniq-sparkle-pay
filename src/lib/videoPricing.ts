/**
 * The published price chart for FINISHED VIDEO TIME — the TypeScript copy.
 *
 * Owner directive 2026-08-27 (the monetization master loop): the catalogue
 * below is the owner's, verbatim. THE DATABASE IS THE ONE THAT CHARGES —
 * `video_sale_config` prices PAYG minutes and `subscription_plans` prices the
 * plans, both read server-side under the row that becomes the receipt. This
 * copy exists because screens need a synchronous shape to render against;
 * it is never the amount anybody is charged, and `videoPricingSql.test.ts`
 * fails the moment this file and the migration seed disagree.
 *
 * THE CUSTOMER UNIT IS FINISHED VIDEO TIME. Nothing here — and nothing on
 * any screen — speaks in GPU seconds, provider runtime, or internal credits.
 */

/** PAYG: ₹29 per finished minute, watermarked. Integer paise. */
export const VIDEO_PAYG_PAISE_PER_MINUTE = 2900;

/** Clean export addon: +₹20 per finished minute (so ₹49/min clean). */
export const VIDEO_CLEAN_ADDON_PAISE_PER_MINUTE = 2000;

/** The minute bundles on offer — priced rate × minutes, nothing hand-picked. */
export const VIDEO_PAYG_MINUTES: readonly number[] = [1, 2, 5, 10];

export type VideoPlanCopy = {
  key: string;
  label: string;
  pricePaise: number;
  /** Finished video seconds included per month. */
  includedSeconds: number;
  watermarkFree: boolean;
};

/** Mirrors the `subscription_plans` seed rows in the monetization migration. */
export const VIDEO_PLANS: readonly VideoPlanCopy[] = [
  {
    key: "creator_monthly",
    label: "Creator",
    pricePaise: 19900,
    includedSeconds: 1800,
    watermarkFree: false,
  },
  {
    key: "pro_monthly",
    label: "Pro",
    pricePaise: 34900,
    includedSeconds: 3600,
    watermarkFree: true,
  },
];

/** The once-per-account free trial: one minute of finished video. */
export const VIDEO_TRIAL_SECONDS = 60;

/** What the server's video_time_status() returns, read defensively. */
export type VideoTimeStatus = {
  admin: boolean;
  salesEnabled: boolean;
  trialEnabled: boolean;
  trialRemainingMs: number;
  plan: string;
  planRemainingMs: number;
  paidMs: number;
  watermarkFree: boolean;
};

export function readVideoTimeStatus(payload: unknown): VideoTimeStatus | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const num = (k: string) => (typeof p[k] === "number" && p[k] >= 0 ? (p[k] as number) : 0);
  return {
    admin: p.admin === true,
    salesEnabled: p.salesEnabled === true,
    trialEnabled: p.trialEnabled === true,
    trialRemainingMs: num("trialRemainingMs"),
    plan: typeof p.plan === "string" ? p.plan : "free",
    planRemainingMs: num("planRemainingMs"),
    paidMs: num("paidMs"),
    watermarkFree: p.watermarkFree === true,
  };
}

/** Total milliseconds a status says are still spendable. */
export function totalRemainingMs(s: VideoTimeStatus): number {
  return s.trialRemainingMs + s.planRemainingMs + s.paidMs;
}

/**
 * Milliseconds as customer copy: "0:47" style minutes:seconds, floor —
 * never a decimal, never a GPU number.
 */
export function sayVideoTime(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
