/**
 * CURRENCY DISCIPLINE — the ledger is USD, and FX never reaches a decision.
 *
 * Owner directive, 2026-08-24. Google's published USD price is the canonical
 * provider-cost input. An FX rate is a SECOND, independently-moving number:
 * let one into a routing decision and the router's answer changes on a day when
 * nothing about the providers changed, and nobody can tell afterwards which of
 * the two inputs moved.
 *
 * So: store `usd_per_generated_second`, `usd_per_attempt`,
 * `usd_per_accepted_second`. Never store `USD_INR` or an INR-denominated cost.
 * FX may not influence chooseTier(), provider routing, spend ceilings,
 * acceptance calculations or provider selection. An INR presentation is a
 * REPORTING-TIME conversion carrying its own source and timestamp.
 *
 * This file is the barrier. It fails the build if that discipline is broken.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_VIDEO_SURFACE,
  compareGoogleSurfaces,
  expectedAttempts,
  usdPerAcceptedSecond,
  usdPerAttempt,
  usdPerGeneratedSecond,
  VIDEO_RATES,
} from "../../../supabase/functions/_shared/videoRouting.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Comments describe code; they are not code. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

/**
 * The modules a cost decision passes through. If FX gets into any of these, it
 * is influencing a decision, whatever the comment above it says.
 */
const DECISION_MODULES = [
  "supabase/functions/_shared/financialLedger.ts",
  "supabase/functions/_shared/videoRouting.ts",
  "supabase/functions/_shared/videoAudio.ts",
  "supabase/functions/_shared/searchGuard.ts",
  "supabase/functions/_shared/searchBudget.ts",
  "supabase/functions/story-clip/index.ts",
];

const LEDGER_SQL = "supabase/migrations/20260824120000_provider_spend_ledger.sql";

/** A stored or applied FX rate, under any of the names it tends to arrive as. */
const FX_IDENTIFIER =
  /\b(usdInr|USD_INR|inrPerUsd|INR_PER_USD|usdToInr|inrToUsd|fxRate|FX_RATE|exchangeRate|EXCHANGE_RATE|inrPer[A-Z]\w*|[a-z]\w*Inr\b|inr_[a-z_]+|[a-z_]+_inr\b)/;

/** The rupee sign itself. A cost in ₹ inside a decision module is the bug. */
const RUPEE = /₹/;

describe("no FX rate reaches a cost decision", () => {
  it("finds the modules at all — a passing test on an empty set proves nothing", () => {
    for (const m of DECISION_MODULES) expect(read(m).length, m).toBeGreaterThan(500);
    expect(read(LEDGER_SQL).length).toBeGreaterThan(2000);
  });

  it("no decision module stores or applies an FX rate", () => {
    for (const m of DECISION_MODULES) {
      expect(code(m), `${m} carries an FX identifier`).not.toMatch(FX_IDENTIFIER);
    }
  });

  it("no decision module carries a rupee figure — not even in a comment", () => {
    // Comments are NOT stripped here on purpose. A comment that quotes a cost
    // in rupees is a comment that will be read as the cost, and the next person
    // to touch the file will reach for an FX rate to keep it up to date.
    for (const m of DECISION_MODULES) {
      expect(read(m), `${m} quotes a rupee figure`).not.toMatch(RUPEE);
    }
  });

  it("the ledger migration is USD-denominated and has no INR column", () => {
    const sql = read(LEDGER_SQL);
    for (const col of [
      "daily_usd_cap",
      "request_usd_cap",
      "job_usd_cap",
      "estimated_usd",
      "actual_usd",
      "reserved_usd",
      "settled_usd",
      "charged_usd",
      "usd_per_accepted_unit",
    ]) {
      expect(sql, `${col} missing`).toMatch(new RegExp(col));
    }
    expect(sql).not.toMatch(/_inr\b|\binr_|₹/i);
    expect(sql).not.toMatch(FX_IDENTIFIER);
  });

  it("the one stored FX rate in the repository cannot reach the ledger or the router", () => {
    // src/lib/storyCostModel.ts carries `inrPerUsd` because the PUBLISHED PRICE
    // chart is denominated in rupees and is the owner's. That is a pricing
    // artefact, not a provider-cost input, and it must stay on its own side of
    // the line: nothing in the decision path may import it.
    expect(read("src/lib/storyCostModel.ts")).toMatch(/inrPerUsd/);
    for (const m of DECISION_MODULES) {
      expect(code(m), `${m} imports the price chart`).not.toMatch(/storyCostModel/);
    }
    // And no video rate has been wired into the price chart either. Comments
    // are stripped: the chart's own comment NAMES these modules to explain the
    // boundary it must not cross, and explaining a boundary is not crossing it.
    expect(code("src/lib/storyCostModel.ts")).not.toMatch(
      /videoRouting|usdPerSecondWithAudio|financialLedger/,
    );
  });

  it("routing functions take no FX argument", () => {
    // A signature is the honest place to look: a function that cannot be handed
    // a rate cannot be influenced by one.
    const routing = code("supabase/functions/_shared/videoRouting.ts");
    for (const sig of routing.match(/export function [\s\S]*?\)/g) ?? []) {
      expect(sig).not.toMatch(/fx|rate\s*:\s*number\s*,\s*\w*inr/i);
      expect(sig).not.toMatch(FX_IDENTIFIER);
    }
  });
});

describe("the three canonical USD metrics", () => {
  const LITE = "veo-3.1-lite-generate-preview";
  const FAST = "veo-3.1-fast-generate-preview";

  it("usd_per_generated_second is the billed rate on the active surface", () => {
    expect(ACTIVE_VIDEO_SURFACE).toBe("google-ai-studio");
    expect(usdPerGeneratedSecond(LITE, "ONIQ_SOUND")).toBeCloseTo(0.05, 6);
    expect(usdPerGeneratedSecond(FAST, "ONIQ_SOUND")).toBeCloseTo(0.1, 6);
    // VIDEO_ONLY is billed identically here — the surface cannot decline audio.
    expect(usdPerGeneratedSecond(LITE, "VIDEO_ONLY")).toBeCloseTo(0.05, 6);
  });

  it("usd_per_attempt scales with the seconds actually submitted", () => {
    expect(usdPerAttempt(LITE, 8, "ONIQ_SOUND")).toBeCloseTo(0.4, 6);
    expect(usdPerAttempt(FAST, 8, "ONIQ_SOUND")).toBeCloseTo(0.8, 6);
  });

  it("usd_per_accepted_second is NULL when acceptance has not been measured", () => {
    // The whole point. A hopeful default here is how a benchmark gets skipped.
    expect(usdPerAcceptedSecond(LITE, "ONIQ_SOUND", null)).toBeNull();
    expect(usdPerAcceptedSecond(LITE, "ONIQ_SOUND", 0)).toBeNull();
    expect(usdPerAcceptedSecond(LITE, "ONIQ_SOUND", 1.5)).toBeNull();
  });

  it("usd_per_accepted_second exceeds the raw rate whenever anything is rejected", () => {
    const raw = usdPerGeneratedSecond(LITE, "ONIQ_SOUND");
    expect(usdPerAcceptedSecond(LITE, "ONIQ_SOUND", 1)).toBeCloseTo(raw, 6);
    for (const p of [0.9, 0.8, 0.6531, 0.5]) {
      expect(usdPerAcceptedSecond(LITE, "ONIQ_SOUND", p)!, `p=${p}`).toBeGreaterThan(raw);
    }
    // Strictly worse as acceptance falls.
    expect(usdPerAcceptedSecond(LITE, "ONIQ_SOUND", 0.5)!).toBeGreaterThan(
      usdPerAcceptedSecond(LITE, "ONIQ_SOUND", 0.8)!,
    );
  });

  it("expectedAttempts is bounded by the retry ceiling", () => {
    expect(expectedAttempts(1, 3)).toBeCloseTo(1, 6);
    expect(expectedAttempts(0.0001, 3)).toBeLessThanOrEqual(3);
    expect(expectedAttempts(0.5, 3)).toBeGreaterThan(1);
    expect(expectedAttempts(0.5, 3)).toBeLessThan(3);
  });

  it("a cheaper tier that fails more is correctly shown as NOT cheaper", () => {
    // Lite at 40% vs Fast at 90%: half the list price, and worse economics.
    const lite = usdPerAcceptedSecond(LITE, "ONIQ_SOUND", 0.4)!;
    const fast = usdPerAcceptedSecond(FAST, "ONIQ_SOUND", 0.9)!;
    expect(usdPerGeneratedSecond(LITE, "ONIQ_SOUND")).toBeLessThan(
      usdPerGeneratedSecond(FAST, "ONIQ_SOUND"),
    );
    expect(lite).toBeGreaterThan(fast);
  });
});

describe("surface comparison, in USD, exactly as the owner stated it", () => {
  it("reproduces the per-second figures", () => {
    const perSecond = compareGoogleSurfaces(1, "lite");
    expect(perSecond.geminiApiUsd).toBeCloseTo(0.05, 6);
    expect(perSecond.agentPlatformVideoOnlyUsd).toBeCloseTo(0.03, 6);
    expect(perSecond.differenceUsd).toBeCloseTo(0.02, 6);
    expect(perSecond.reduction).toBeCloseTo(0.4, 6);
  });

  it("reproduces the 60-second figures", () => {
    const sixty = compareGoogleSurfaces(60, "lite");
    expect(sixty.geminiApiUsd).toBeCloseTo(3.0, 6);
    expect(sixty.agentPlatformVideoOnlyUsd).toBeCloseTo(1.8, 6);
    expect(sixty.differenceUsd).toBeCloseTo(1.2, 6);
    expect(sixty.reduction).toBeCloseTo(0.4, 6);
  });

  it("returns no INR field of any kind", () => {
    const keys = Object.keys(compareGoogleSurfaces(60, "lite"));
    expect(keys).toEqual([
      "seconds",
      "geminiApiUsd",
      "agentPlatformVideoOnlyUsd",
      "differenceUsd",
      "reduction",
    ]);
    for (const k of keys) expect(k).not.toMatch(/inr/i);
  });

  it("names the surface the way Google's own error string names it", () => {
    const surfaces = new Set(VIDEO_RATES.map((r) => r.surface));
    expect(surfaces.has("google-agent-platform")).toBe(true);
    expect(surfaces.has("google-ai-studio")).toBe(true);
    // "vertex" is the same product under an older name; the SDK's error message
    // is what a reader actually hits, so that is the name carried here.
    for (const r of VIDEO_RATES) expect(r.surface).not.toMatch(/vertex/i);
  });

  it("refuses to compare a tier whose rate is missing rather than inventing one", () => {
    // Runway has no verified rate on either side of the comparison.
    expect(() => compareGoogleSurfaces(60, "fast" as never)).not.toThrow();
    const fast = compareGoogleSurfaces(60, "fast");
    expect(fast.geminiApiUsd).toBeCloseTo(6.0, 6);
    expect(fast.agentPlatformVideoOnlyUsd).toBeCloseTo(4.8, 6);
  });
});
