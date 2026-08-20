/**
 * The hotel-scout result badge must not present a model self-label as an
 * independently verified fact.
 *
 * THE MISLEADING UI THIS PINS
 *
 * hotel-scout's `verified` boolean is produced by the scout LLM — its prompt
 * says to set it true "only for recognised booking platforms or the hotel's
 * official site". There is no independent verification step; it is the model's
 * own judgement about the source domain. The travel UI rendered that as a green
 * "✓ verified" badge, which reads as an authoritative, independently-checked
 * claim about the RATE.
 *
 * The integrity rule: an LLM-generated assertion must not be shown as
 * independently verified when no verification source/process exists. The badge
 * now reads "recognised source" (a source signal) and carries a title
 * explaining it is the AI's judgement, not a verified rate. Asserted against
 * source because it is a copy/data-contract guarantee.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ui = readFileSync(
  join(process.cwd(), "src/routes/_authenticated/app.travel.tsx"),
  "utf8",
);
const edge = readFileSync(
  join(process.cwd(), "supabase/functions/hotel-scout/index.ts"),
  "utf8",
);

describe("hotel-scout verified badge honesty", () => {
  it("no longer labels a result as bare 'verified'", () => {
    // The old misleading copy must be gone.
    expect(ui).not.toContain("✓ verified");
  });

  it("labels it as a recognised source with an explanatory disclaimer", () => {
    expect(ui).toContain("✓ recognised source");
    // A title that makes the AI-judgement / not-verified nature explicit.
    expect(ui).toMatch(/title="[^"]*not an independently verified rate[^"]*"/);
  });

  it("still keys off the model's `verified` field (data contract unchanged)", () => {
    expect(ui).toMatch(/\{r\.verified &&/);
    // Confirms the field really is a model self-label, not an external check.
    expect(edge).toMatch(/Set 'verified' true only for recognised booking platforms/);
  });
});
