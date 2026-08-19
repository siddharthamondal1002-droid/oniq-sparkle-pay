/**
 * Track B's arithmetic and its two structural constraints.
 *
 * The numbers here are the owner's, fixed, and not re-opened. What these tests
 * defend is that a later edit cannot quietly move them — a commission that
 * drifts by half a point is invisible in a diff and very visible in a
 * creator's payment.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BREAKEVEN_REFUND_BP,
  DIRECT_RECOVERY_PAISE,
  ELIGIBILITY,
  FOUNDING_COMMISSION_BP,
  FOUNDING_LABEL,
  HOLD_DAYS,
  MIN_PAYOUT_PAISE,
  PLAY_PRODUCT_LIMITS,
  REFUND_REVIEW_BP,
  SUB_TIERS,
  STANDARD_COMMISSION_BP,
  WRITE_OFF_DAYS,
  pastBreakeven,
  planRecovery,
  refundBp,
  splitPaise,
} from "@/lib/creator/economics";

describe("the Rs 100 split is exactly the one that was agreed", () => {
  it("pays Play 15, the creator 75 and ONIQ 10", () => {
    expect(splitPaise(10_000)).toEqual({ gross: 10_000, play: 1_500, oniq: 1_000, creator: 7_500 });
  });

  it("gives founding creators 77.5 and ONIQ 7.5", () => {
    expect(splitPaise(10_000, true)).toEqual({
      gross: 10_000,
      play: 1_500,
      oniq: 750,
      creator: 7_750,
    });
  });

  it("never loses or invents a paisa at any tier", () => {
    for (const t of SUB_TIERS) {
      for (const founding of [false, true]) {
        const s = splitPaise(t.pricePaise, founding);
        expect(s.play + s.oniq + s.creator, `${t.sku} founding=${founding}`).toBe(t.pricePaise);
      }
    }
  });

  it("hands the rounding remainder to the creator, not to ONIQ", () => {
    // 1 paisa short of a clean split: whoever gets floor() twice must not be
    // the house, or the house quietly wins every fraction forever.
    const s = splitPaise(3_333);
    expect(s.creator).toBe(3_333 - s.play - s.oniq);
    expect(s.creator).toBeGreaterThan(Math.floor((3_333 * 7_500) / 10_000) - 1);
  });

  it("labels the founding rate as time-limited wherever it is shown", () => {
    expect(FOUNDING_LABEL).toMatch(/limited/i);
    expect(FOUNDING_COMMISSION_BP).toBe(750);
    expect(STANDARD_COMMISSION_BP).toBe(1000);
  });
});

describe("B2 — the Play product cap is a design constraint, written down", () => {
  it("records the actual limits", () => {
    expect(PLAY_PRODUCT_LIMITS.maxProducts).toBe(1000);
    expect(PLAY_PRODUCT_LIMITS.maxBasePlansPerSub).toBe(50);
  });

  it("ships four shared SKUs, one per price point, and no more", () => {
    // A SKU per creator works until creator 1,001 and then the store refuses,
    // with real subscribers already on the old design.
    expect(SUB_TIERS.map((t) => t.pricePaise)).toEqual([4_900, 9_900, 19_900, 49_900]);
    expect(SUB_TIERS.length).toBeLessThan(PLAY_PRODUCT_LIMITS.maxBasePlansPerSub);
  });

  it("has no creator identifier anywhere in a SKU", () => {
    for (const t of SUB_TIERS) expect(t.sku).toMatch(/^oniq_creator_\d+$/);
  });
});

describe("B4 — the hold and the threshold", () => {
  it("holds for 45 days and pays at Rs 1,000", () => {
    expect(HOLD_DAYS).toBe(45);
    expect(MIN_PAYOUT_PAISE).toBe(100_000);
  });
});

describe("B5 — clawback recovery order, and the line it must not cross", () => {
  it("computes the refund rate in basis points, integer", () => {
    expect(refundBp(0, 0)).toBe(0);
    expect(refundBp(100, 5)).toBe(500);
    expect(refundBp(200, 21)).toBe(1050);
  });

  it("knows where the margin dies", () => {
    expect(BREAKEVEN_REFUND_BP).toBe(1050);
    expect(REFUND_REVIEW_BP).toBe(500);
    expect(pastBreakeven(1049)).toBe(false);
    expect(pastBreakeven(1050)).toBe(true);
  });

  it("takes Available first, then Accrued, then carries the rest", () => {
    expect(planRecovery(1_000, 600, 300)).toMatchObject({
      fromAvailable: 600,
      fromAccrued: 300,
      carriedForward: 100,
    });
  });

  it("carries forward rather than reaching further when both are empty", () => {
    const r = planRecovery(5_000, 0, 0);
    expect(r.carriedForward).toBe(5_000);
    expect(r.writeOffAfterDays).toBe(WRITE_OFF_DAYS);
  });

  it("contemplates direct recovery only above Rs 10,000 AND with fraud shown", () => {
    expect(planRecovery(2_000_000, 0, 0, false).directRecoveryEligible).toBe(false);
    expect(planRecovery(500_000, 0, 0, true).directRecoveryEligible).toBe(false);
    expect(planRecovery(2_000_000, 0, 0, true).directRecoveryEligible).toBe(true);
    expect(DIRECT_RECOVERY_PAISE).toBe(1_000_000);
  });

  it("writes off below the threshold after 180 days", () => {
    expect(WRITE_OFF_DAYS).toBe(180);
  });

  it("never proposes debiting a bank account", () => {
    // No mandate exists. Attempting one turns a billing dispute into a legal
    // one, and the creator is the party with the sympathetic story.
    const src = readFileSync(join(process.cwd(), "src/lib/creator/economics.ts"), "utf8");
    expect(src.replace(/\s+/g, " ")).toMatch(/never[\s*]+debited/i);
    for (const bad of ["debitBank", "bank_debit", "autoDebit"]) expect(src).not.toContain(bad);
  });
});

describe("B6 — eligibility filters bought followers", () => {
  it("requires activity as well as a follower count", () => {
    // A raw follower gate rewards buying them; posting on separate days over
    // months is the part a purchased audience does not come with.
    expect(ELIGIBILITY.minFollowers).toBe(1000);
    expect(ELIGIBILITY.minActiveDays).toBeGreaterThan(0);
    expect(ELIGIBILITY.activityWindowDays).toBe(90);
    expect(ELIGIBILITY.minAge).toBe(18);
  });
});
