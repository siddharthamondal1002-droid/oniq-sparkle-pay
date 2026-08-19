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

  it("app.creator throws on an owned-channels error and shows retry, not 'no channels'", () => {
    const src = strip(read("src/routes/_authenticated/app.creator.tsx"));
    expect(src, "owned-channels query no longer throws on error").toMatch(
      /if \(error\) throw error/,
    );
    expect(src, "ownedError branch is gone").toContain("ownedError");
    expect(
      src.indexOf("ownedError ?"),
      "ownedError branch must precede the 'no channels' empty branch",
    ).toBeLessThan(src.indexOf("owned.length === 0"));
  });

  it("privacy.notice disables consent switches until the ledger truly loads", () => {
    const src = strip(read("src/routes/_authenticated/app.privacy.notice.tsx"));
    // A failed ledger read sets ledgerError rather than being swallowed...
    expect(src, "the ledger read still swallows its error").toMatch(/setLedgerError\(true\)/);
    // ...and the toggle is gated on a confirmed load, so it can never act on
    // the default (withdrawn) state a failed read would show.
    expect(src, "consent toggle no longer gated on ledgerLoaded").toMatch(
      /disabled=\{busy === p\.id \|\| !ledgerLoaded\}/,
    );
  });

  it("food.index throws on a restaurants error and shows retry, not an empty menu", () => {
    const src = strip(read("src/routes/_authenticated/app.food.index.tsx"));
    expect(src, "restaurants query no longer throws on error").toMatch(/if \(error\) throw error/);
    expect(src, "restaurantsError branch is gone").toContain("restaurantsError");
  });

  it("learn throws on a courses error and shows retry, not 'no courses yet'", () => {
    const src = strip(read("src/routes/_authenticated/app.learn.tsx"));
    expect(src, "courses query no longer throws on error").toMatch(/if \(error\) throw error/);
    expect(
      src.indexOf("coursesError ?"),
      "coursesError branch must precede the '!courses?.length' empty branch",
    ).toBeLessThan(src.indexOf("!courses?.length"));
  });

  it("chat.calls consumes its throw with an error branch, not 'no calls yet'", () => {
    const src = strip(read("src/routes/_authenticated/app.chat.calls.tsx"));
    expect(src, "logsError is no longer consumed").toContain("logsError");
    expect(
      src.indexOf("logsError ?"),
      "logsError branch must precede the logs.length === 0 empty branch",
    ).toBeLessThan(src.indexOf("logs.length === 0"));
  });

  it("clips consumes the feed error before showing 'No clips yet'", () => {
    const src = strip(read("src/routes/_authenticated/app.clips.tsx"));
    expect(
      src.indexOf("query.isError ?"),
      "query.isError branch must precede the empty-feed branch",
    ).toBeLessThan(src.indexOf("clips.length === 0 && !query.isLoading"));
  });

  it("reels returns an error state before the empty feed", () => {
    const src = strip(read("src/routes/_authenticated/app.chat.reels.tsx"));
    expect(
      src.indexOf("if (query.isError)"),
      "the query.isError early return must precede the empty-feed return",
    ).toBeLessThan(src.indexOf("if (clips.length === 0 && !query.isLoading)"));
  });

  it("MomentsFeed throws on a posts error and shows retry, not 'No moments yet'", () => {
    // Raw source here, not strip(): this file's `/\.(mp4|…)/` regex literal
    // confuses the block-comment stripper. The markers below are code, not
    // anything a comment could forge.
    const src = read("src/components/moments/MomentsFeed.tsx");
    expect(src, "moments query no longer throws on error").toMatch(/if \(error\) throw error/);
    expect(
      src.indexOf("postsError ?"),
      "postsError branch must precede the posts.length feed branch",
    ).toBeLessThan(src.indexOf("posts && posts.length > 0"));
  });

  it("faith shows a radio error+retry, not 'no stations'", () => {
    const src = read("src/routes/_authenticated/app.faith.tsx");
    expect(src, "the isError radio branch is gone").toMatch(/\) : isError \? \(/);
    expect(src, "no retry on the radio error branch").toContain("refetch()");
  });

  it("chat.me throws on moments/reels errors and shows retry, not a false empty", () => {
    const src = read("src/routes/_authenticated/app.chat.me.tsx");
    expect(src, "moments query no longer throws on error").toMatch(/if \(error\) throw error/);
    expect(
      src.indexOf("momentsError ?"),
      "momentsError branch must precede the moments empty branch",
    ).toBeLessThan(src.indexOf("moments.length === 0"));
    expect(src, "clipsError branch is gone").toContain("clipsError ?");
  });

  it("u.$userId throws on moments/reels errors and shows retry, not a false empty", () => {
    const src = read("src/routes/_authenticated/app.u.$userId.tsx");
    expect(src, "moments query no longer throws on error").toMatch(/if \(error\) throw error/);
    expect(
      src.indexOf("momentsError ?"),
      "momentsError branch must precede the moments empty branch",
    ).toBeLessThan(src.indexOf("moments.length === 0"));
    expect(src, "clipsError branch is gone").toContain("clipsError ?");
  });

  it("food.$id throws on restaurant/menu errors and shows retry, not an infinite skeleton or empty menu", () => {
    const src = strip(read("src/routes/_authenticated/app.food.$id.tsx"));
    // Both reads now throw rather than swallowing the error into null/[].
    expect(src, "a food read still swallows its error").toMatch(/if \(error\) throw error/);
    expect(src, "restaurantError branch is gone").toContain("restaurantError");
    expect(src, "menuError branch is gone").toContain("menuError");
    // The restaurant error branch must precede the loading skeleton, so a failed
    // read shows a retry instead of spinning on the skeleton forever.
    expect(
      src.indexOf("restaurantError)"),
      "restaurantError branch must precede the loading skeleton",
    ).toBeLessThan(src.indexOf("restaurantLoading || !restaurant"));
  });
});
