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

  it("data-rights keeps the erasure gate closed on a failed requests read", () => {
    const src = strip(read("src/routes/_authenticated/app.privacy.data-rights.tsx"));
    // A failed list read sets reqError rather than being silently swallowed.
    expect(src, "the requests read still swallows its error").toMatch(/setReqError\(true\)/);
    // The Delete-account button must be gated on a CONFIRMED load, so a failed
    // read can never re-enable it and let the user file a duplicate erasure.
    expect(src, "delete button no longer gated on reqLoaded").toMatch(
      /disabled=\{!!pendingErasure \|\| !reqLoaded\}/,
    );
    expect(src, "no retry on the requests card error state").toContain("Try again");
  });

  it("profile throws on a reports error and shows retry, not a false empty", () => {
    const src = strip(read("src/routes/_authenticated/app.profile.tsx"));
    expect(src, "my-reports query no longer throws on error").toMatch(/if \(error\) throw error/);
    expect(src, "reportsError branch is gone").toContain("reportsError");
    // The error branch must precede the length===0 "no reports" branch.
    expect(
      src.indexOf("reportsError ?"),
      "reportsError branch must precede the empty branch",
    ).toBeLessThan(src.indexOf("myReports.length === 0"));
  });
});
