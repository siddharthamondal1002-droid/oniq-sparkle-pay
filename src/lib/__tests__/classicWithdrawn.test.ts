/**
 * CLASSIC IS WITHDRAWN, AND "WITHDRAWN" HAS TO MEAN THE FACTORY TOO.
 *
 * The 2026-08-13 flip set every classic price row inactive and everyone —
 * including the migration's own comment — called that "classic off". It was
 * only half. `claim_story_seconds` defaulted `_grade` to 'classic', and the
 * studio named a grade only when the user turned movie ON, so the untouched
 * path went on building the withdrawn product: 31 of 44 films in story_jobs
 * were classic, the last of them two hours before the fix.
 *
 * That gap is the shape this file guards. Selling and making are separate
 * doors, and a test that only checks the price list would have passed
 * throughout.
 *
 * The second finding is pinned here too, because it came from the same
 * confusion in the opposite direction: /pay/story queried classic rows while
 * classic was off sale, matched nothing, and showed "Could not load the price
 * list". Story time was unbuyable for two days and the page reported it as a
 * loading failure.
 *
 * Text tests. They prove the descriptions agree, not that the migration ran —
 * application is verified against the live project per deploy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SQL = read("supabase/migrations/20260815130000_classic_withdrawn.sql");
const STUDIO = read("src/components/stories/StoryStudio.tsx");
const PAY = read("src/routes/pay.story.tsx");

describe("the claim will not build a classic film", () => {
  it("defaults the grade to movie, not classic", () => {
    // THE LOAD-BEARING LINE. Every already-installed build omits _grade, so
    // this default is what those clients actually get. If it says 'classic'
    // the withdrawal is cosmetic.
    expect(SQL).toMatch(/_grade text default 'movie'/);
    expect(SQL).not.toMatch(/_grade text default 'classic'/);
  });

  it("refuses classic outright instead of accepting it", () => {
    expect(SQL).toContain("case when _grade = 'movie' then 'movie' else null end");
    expect(
      /_grade in \('classic', 'movie'\)/.test(SQL),
      "classic is an accepted grade again",
    ).toBe(false);
  });

  it("defaults the column too, for any insert that skips the function", () => {
    expect(SQL).toContain("alter column grade set default 'movie'");
  });
});

describe("the price list cannot put classic back on sale", () => {
  it("carries a constraint, not just an UPDATE", () => {
    // An UPDATE describes today. The CHECK is what makes it stay true.
    expect(SQL).toContain("check (grade <> 'classic' or active = false)");
    expect(SQL).toContain("story_price_tiers_classic_withdrawn");
  });

  it("clears any classic row that was still active when it ran", () => {
    // The constraint would refuse to be added over a live classic row, so the
    // migration must not depend on the table already being clean.
    expect(SQL).toMatch(
      /update public\.story_price_tiers set active = false where grade = 'classic'/,
    );
  });
});

describe("checkout asks for a grade that is actually on sale", () => {
  it("reads movie rows on the buy page", () => {
    expect(PAY).toContain('.eq("grade" as never, "movie" as never)');
    expect(
      /\.eq\("grade" as never, "classic" as never\)/.test(PAY),
      "the buy page is back to querying a grade that is off sale — it will show a load error",
    ).toBe(false);
  });

  it("prices the purchase from a grade the table still has active rows for", () => {
    // create_story_purchase takes the grade and looks up an ACTIVE row. With
    // the default at 'classic' this returned 'no-such-tier' for every caller,
    // because razorpay-order sends no grade at all.
    expect(SQL).toContain("where seconds = _seconds and grade = grade_clean and active");
    expect(SQL).toMatch(/create or replace function public\.create_story_purchase/);
  });
});

describe("the studio offers one grade because there is one", () => {
  it("names movie on every claim rather than relying on the default", () => {
    expect(STUDIO).toContain('_grade: "movie"');
    expect(
      /grade === "movie" \? \{ _grade: "movie" \} : \{\}/.test(STUDIO),
      "the grade is conditional again — the unnamed branch builds classic on an un-migrated database",
    ).toBe(false);
  });

  it("has no grade toggle left to switch back", () => {
    expect(STUDIO).not.toContain('useState<"classic" | "movie">');
    expect(STUDIO).not.toContain("setGrade");
  });
});
