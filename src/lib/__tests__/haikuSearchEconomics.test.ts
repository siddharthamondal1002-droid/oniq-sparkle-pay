/**
 * HAIKU 4.5 SEARCH ECONOMICS — owner directive, 2026-08-24.
 *
 * The control is a real settled invoice, not a model:
 *   claude-opus-5, 6 searches, reserved $0.445625, ACTUAL $0.530683 — over the
 *   $0.50 request ceiling by $0.030683.
 *
 * Two things were wrong and only one was the model. The reservation was also
 * optimistic — 48,000 input tokens assumed against 99,321 used. These tests pin
 * BOTH halves, because fixing only the model would leave the estimator lying,
 * and fixing only the estimator would refuse every request.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SCOUT = read("supabase/functions/smart-scout/index.ts");

/** Owner directive 2026-08-25: every searching function runs Haiku 4.5. */
const SEARCH_FNS = [
  "supabase/functions/smart-scout/index.ts",
  "supabase/functions/ting/index.ts",
  "supabase/functions/health-scan/index.ts",
  "supabase/functions/hotel-scout/index.ts",
] as const;

/** The owner's SEARCH request ceiling. Not a variable in this experiment. */
const REQUEST_CAP_USD = 0.5;

/** Anthropic list rates, mirrored from searchBudget.ts MODEL_RATES. */
const RATE = {
  "claude-opus-5": { inUsd: 5 / 1e6, outUsd: 25 / 1e6 },
  "claude-haiku-4-5": { inUsd: 1 / 1e6, outUsd: 5 / 1e6 },
} as const;
const USD_PER_SEARCH = 10 / 1000;
const CACHE_WRITE_MULTIPLIER = 1.25;

const num = (name: string) => {
  const m = SCOUT.match(new RegExp(`const ${name}\\s*=\\s*([\\d_]+)`));
  expect(m, `${name} must be a literal constant`).toBeTruthy();
  return Number(m![1].replace(/_/g, ""));
};

const model = SCOUT.match(/const SCOUT_MODEL\s*=\s*"([^"]+)"/)![1];
const searches = num("SCOUT_MAX_SEARCHES");
const base = num("SCOUT_BASE_INPUT_TOKENS");
const perSearch = num("SCOUT_TOKENS_PER_SEARCH");
const outReserve = num("SCOUT_OUTPUT_TOKEN_RESERVE");
const maxTokens = num("SCOUT_MAX_TOKENS");
const cacheTokens = num("SCOUT_SYSTEM_CACHE_TOKENS");
const image = num("IMAGE_TOKEN_ALLOWANCE");

/** The same worst case the reservation claims, recomputed independently. */
const worstCase = (m: keyof typeof RATE, withImage: boolean) => {
  const r = RATE[m];
  const inTokens = base + searches * perSearch + (withImage ? image : 0);
  return (
    searches * USD_PER_SEARCH +
    cacheTokens * r.inUsd * CACHE_WRITE_MULTIPLIER +
    inTokens * r.inUsd +
    outReserve * r.outUsd
  );
};

describe("smart-scout SEARCH economics fit under the ceiling", () => {
  it("runs on Haiku 4.5, at a search depth of 6", () => {
    expect(model).toBe("claude-haiku-4-5");
    expect(searches).toBe(6);
    // Enforced server-side by the provider, not by hope.
    expect(SCOUT).toMatch(/max_uses:\s*SCOUT_MAX_SEARCHES/);
  });

  it("the worst-case reservation fits under $0.50, with and without an image", () => {
    // If the worst case cannot fit below the ceiling, the request must not be
    // admitted at all — so this is the gate, expressed as a test.
    expect(worstCase("claude-haiku-4-5", false)).toBeLessThanOrEqual(REQUEST_CAP_USD);
    expect(worstCase("claude-haiku-4-5", true)).toBeLessThanOrEqual(REQUEST_CAP_USD);
  });

  it("OPUS could not fit the same honest reservation — the model was not the only fault", () => {
    // The finding worth keeping. At this depth an honest reserve puts Opus at
    // roughly $0.74, so no amount of estimator tuning would have made the old
    // configuration admissible. Haiku is what makes honesty affordable.
    expect(worstCase("claude-opus-5", false)).toBeGreaterThan(REQUEST_CAP_USD);
  });

  it("the reserve scales with search depth, because that is the mechanism", () => {
    // Every hop feeds its results back into context. A flat reserve cannot
    // track that, and is always wrong in the expensive direction.
    expect(perSearch).toBeGreaterThan(0);
    expect(SCOUT).toMatch(/SCOUT_MAX_SEARCHES \* SCOUT_TOKENS_PER_SEARCH/);
  });

  it("covers what the control request actually used, rather than what it hoped", () => {
    // Control: 6 hops, 99,321 input tokens, 4,295 output tokens.
    expect(base + searches * perSearch).toBeGreaterThanOrEqual(99_321);
    // Output billed ABOVE max_tokens on the control, so reserving at max_tokens
    // is demonstrably optimistic.
    expect(outReserve).toBeGreaterThan(maxTokens);
    expect(outReserve).toBeGreaterThanOrEqual(4_295);
  });

  it("does not touch the ceiling to make itself fit", () => {
    // The business ceiling is not a variable in this experiment.
    expect(SCOUT).toMatch(/maxEstimatedUsd:\s*0\.5\b/);
    expect(REQUEST_CAP_USD).toBe(0.5);
  });
});

// ============================================ the whole fleet, not one function
/**
 * OWNER DIRECTIVE, 2026-08-25: "change all to haiku".
 *
 * Before this, three functions still carried the flat-reserve defect the
 * battery measured. Projected against ~13,220 input tokens per hop:
 *
 *   ting          5 hops, opus-5     ~$0.506   breached the $0.50 ceiling
 *   hotel-scout  11 hops, opus-5     ~$1.033   breached it by 2x
 *   health-scan   4 hops, sonnet-4-6 ~$0.280   under, but reserved nothing
 *                                              at all for its four searches
 *
 * These assertions exist so a single function drifting back to an expensive
 * model, or losing its per-hop allowance, fails the build rather than
 * discovering it in a settled invoice.
 */
describe("every searching function is on Haiku and reserves per hop", () => {
  it("no searching function references an expensive model", () => {
    for (const p of SEARCH_FNS) {
      const src = read(p);
      const models = [...src.matchAll(/"(claude-[a-z0-9-]+)"/g)].map((m) => m[1]);
      expect(models.length, `${p} must name a model`).toBeGreaterThan(0);
      expect([...new Set(models)], p).toEqual(["claude-haiku-4-5"]);
    }
  });

  it("each one reserves input for the search results it permits", () => {
    // The defect was reserving for the prompt and nothing for the hops. Every
    // function must multiply its own search ceiling by a per-hop allowance.
    const perHop = /MAX_SEARCHES \* [A-Z_]*TOKENS_PER_SEARCH/;
    for (const p of SEARCH_FNS) {
      expect(read(p), `${p} must scale its reserve with search depth`).toMatch(perHop);
    }
  });

  it("the per-hop allowance is at least what was measured", () => {
    // 51 real requests put it near 13,220 tokens per hop. Reserving less is
    // how the control came to settle over cap.
    for (const p of SEARCH_FNS) {
      const m = read(p).match(/TOKENS_PER_SEARCH\s*=\s*([\d_]+)/);
      expect(m, `${p} must declare a per-hop allowance`).toBeTruthy();
      expect(Number(m![1].replace(/_/g, "")), p).toBeGreaterThanOrEqual(13_220);
    }
  });

  it("every function keeps the $0.50 ceiling in its budget", () => {
    for (const p of SEARCH_FNS) {
      expect(read(p), p).toMatch(/maxEstimatedUsd:\s*0\.5\b/);
    }
  });

  it("the fleet's worst-case reservation still fits under the ceiling", () => {
    // hotel-scout is the widest: 11 hops. Recomputed here rather than trusted.
    const stay = read("supabase/functions/hotel-scout/index.ts");
    const n = (name: string) =>
      Number(stay.match(new RegExp(`const ${name}\\s*=\\s*([\\d_]+)`))![1].replace(/_/g, ""));
    const hops = n("STAY_MAX_SEARCHES");
    const worst =
      hops * USD_PER_SEARCH +
      n("STAY_SYSTEM_CACHE_TOKENS") * RATE["claude-haiku-4-5"].inUsd * CACHE_WRITE_MULTIPLIER +
      (n("STAY_BASE_INPUT_TOKENS") + hops * n("STAY_TOKENS_PER_SEARCH")) *
        RATE["claude-haiku-4-5"].inUsd +
      n("STAY_OUTPUT_TOKEN_RESERVE") * RATE["claude-haiku-4-5"].outUsd;
    expect(worst).toBeLessThanOrEqual(REQUEST_CAP_USD);
    // And it kept its full 11-hop depth — Haiku made cutting quality unnecessary.
    expect(hops).toBe(11);
  });
});
