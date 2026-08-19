/**
 * P3 guard: the two highest-stakes screens fixed in the first batch must keep
 * distinguishing a failed read from an empty one. Both defects were the same
 * shape — a queryFn that swallowed the Supabase error into a null/empty
 * return, so the screen rendered a confident wrong "nothing here":
 *
 *   CreatorEarningsPanel  a failed creator_balance showed ₹0 / ₹0 earned.
 *   app.vitals            a failed health_profiles read dropped the user into
 *                         re-onboarding, whose upsert overwrote the profile.
 *
 * The cure in both is (1) the queryFn THROWS on error and (2) the view shows
 * an explicit retry instead of the empty/zero path.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
// Strip comments so the explanatory notes above each fix can't satisfy a check.
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("error is not empty — batch 1 screens", () => {
  it("CreatorEarningsPanel throws on a balance error and offers retry, not ₹0", () => {
    const src = strip(read("src/components/creator/CreatorEarningsPanel.tsx"));
    expect(src, "balance query no longer throws on error").toMatch(/if \(error\) throw error/);
    expect(src, "balance error/loading state no longer derived from viewState").toContain(
      "viewState",
    );
    expect(src, "the failed-balance retry card is gone").toContain("QueryError");
  });

  it("vitals throws on a health-profile error and shows retry, not the ExperiencePicker", () => {
    const src = strip(read("src/routes/_authenticated/app.vitals.tsx"));
    expect(src, "health-profile query no longer throws on error").toMatch(
      /if \(error\) throw error/,
    );
    expect(src, "the hpError branch that guards re-onboarding is gone").toContain("hpError");
    expect(src, "no retry affordance on the vitals error branch").toContain("Try again");
    // The error branch must sit BEFORE the !hp ExperiencePicker branch, so a
    // failed read can never fall through into profile-overwriting onboarding.
    expect(
      src.indexOf("hpError ?"),
      "hpError branch must precede the !hp ExperiencePicker branch",
    ).toBeLessThan(src.indexOf("!hp ?"));
  });
});
