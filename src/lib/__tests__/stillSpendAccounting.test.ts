/**
 * The in-house STILL spends GPU time, and the ledger has to see it.
 *
 * THE GAP. Every in-house motion clip runs through `runBilledUnit` — reserve,
 * generate, settle. The still stage did not: story-still called `submitStill`
 * directly, so a frame that woke a cold A5000 for minutes left no row
 * anywhere. Film a7b9c3b9 is the proof: nine shots, three GPU submissions on
 * frame 1 alone, zero rows in `provider_spend_ledger`. An absent row is not a
 * zero charge — the card is billed whether or not this project wrote anything
 * down.
 *
 * WHAT THESE PIN, and it is the order rather than the numbers:
 *   - a refused admission means nothing is dispatched;
 *   - the only case that RELEASES is a submit that threw, because nothing ran;
 *   - a terminal failure SETTLES, because the expensive failures are the ones
 *     where the worker held the card first;
 *   - a settlement never fabricates a zero cost; an unreported time leaves the
 *     estimate standing, which over-counts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IN_HOUSE_STILL_RESERVE_GPU_SECONDS,
  estimateStillUsd,
  stillSettlementFor,
  stillSpendRequestFor,
} from "../../../supabase/functions/_shared/inHouseMotion.ts";

const SRC = readFileSync(join(process.cwd(), "supabase/functions/story-still/index.ts"), "utf8");

/** The comments here quote every symbol under test, so they are stripped. */
function code(text: string) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the still's reservation", () => {
  it("is a GPU request, billed as one image, scoped to the film", () => {
    const r = stillSpendRequestFor("still-abc", "film-1", { sceneId: "s1" });
    expect(r.capability).toBe("GPU");
    expect(r.provider).toBe("oniq-gpu");
    expect(r.unit).toBe("images");
    expect(r.units).toBe(1);
    expect(r.jobId).toBe("film-1");
    expect(r.detail).toMatchObject({ stillId: "still-abc", stage: "still", sceneId: "s1" });
  });

  it("is idempotent by the still's own id, so a retry re-admits one row", () => {
    expect(stillSpendRequestFor("still-abc", "film-1").requestId).toBe(
      stillSpendRequestFor("still-abc", "film-1").requestId,
    );
    expect(stillSpendRequestFor("still-abc", "film-1").requestId).not.toBe(
      stillSpendRequestFor("still-xyz", "film-1").requestId,
    );
  });

  it("estimates above zero and below the $0.10 per-request cap", () => {
    // Zero would be refused by the ledger as `zero-estimate`; over the cap
    // would refuse every legitimate cold draw.
    expect(estimateStillUsd()).toBeGreaterThan(0);
    expect(estimateStillUsd()).toBeLessThan(0.1);
    // And the reservation covers a COLD start, which is where the money is.
    expect(IN_HOUSE_STILL_RESERVE_GPU_SECONDS).toBeGreaterThanOrEqual(60);
  });
});

describe("the still's settlement", () => {
  it("reports measured time when the worker gave one", () => {
    const s = stillSettlementFor("ACCEPTED", 40);
    expect(s.outcome).toBe("ACCEPTED");
    expect(s.unitsActual).toBe(1);
    expect(s.actualUsd).toBeGreaterThan(0);
  });

  it("never fabricates a zero charge when the worker reported nothing", () => {
    for (const t of [null, undefined, 0, Number.NaN]) {
      const s = stillSettlementFor("FAILED", t as number | null);
      // ABSENT, not 0. The ledger reads absent as "no cost reported" and keeps
      // the estimate; a 0 would say the GPU ran for free.
      expect(Object.hasOwn(s, "actualUsd")).toBe(false);
    }
  });

  it("a failure consumes no units but is still an outcome", () => {
    const s = stillSettlementFor("FAILED", null);
    expect(s.outcome).toBe("FAILED");
    expect(s.unitsActual).toBe(0);
  });
});

describe("story-still spends through the ledger, in the right order", () => {
  const body = code(SRC);

  it("refuses when the ledger cannot be reached", () => {
    expect(body).toContain("serviceRoleRpc()");
    expect(body).toMatch(/Spend ledger unavailable/);
  });

  it("reserves before it ever submits", () => {
    const admit = body.indexOf("admitProviderSpend(rpc, spend)");
    const submit = body.indexOf("submitStill(prompt, engineEnv, engineDeps");
    expect(admit).toBeGreaterThan(-1);
    expect(submit).toBeGreaterThan(admit);
  });

  it("releases only when the submit itself threw", () => {
    // Exactly one release in the whole function. Any second one is a path
    // reporting a GPU that may have run as free.
    expect(body.match(/releaseProviderSpend\(/g) ?? []).toHaveLength(1);
  });

  it("settles both terminal outcomes, on both paths", () => {
    expect(body.match(/stillSettlementFor\("ACCEPTED"/g) ?? []).toHaveLength(2);
    expect(body.match(/stillSettlementFor\("FAILED"/g) ?? []).toHaveLength(2);
  });

  it("a poll that is not done settles nothing", () => {
    const notDone = body.indexOf("if (!got.done) return json");
    const settleOk = body.indexOf('stillSettlementFor("ACCEPTED"');
    expect(notDone).toBeGreaterThan(-1);
    expect(settleOk).toBeGreaterThan(notDone);
  });
});
