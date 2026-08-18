/**
 * THE PRIVACY POLICY STATES A RETENTION PERIOD FOR EVERY CATEGORY IT COLLECTS.
 *
 * Google Play enforced against ONIQ on 2026-08-18 — "Privacy Policy section of
 * the User Data policy: Invalid Privacy policy / Data retention policy not
 * specified". The policy had a §8 Retention, but it said only that data is kept
 * "while your account is active" with no periods, which the reviewer does not
 * accept: the requirement is to state the practices, or to state explicitly
 * that no user data is stored.
 *
 * An app cannot be distributed while this is open, so the sentences below are
 * load-bearing. They are also claims about behaviour, and every period here is
 * one the code actually implements:
 *
 *   10 minutes   otp expiry            20260711184823 …sql
 *   24 hours     status_updates        20260713055434 …sql
 *   7 days       parental consent      20260803120039 …sql
 *   30 days      delete-account grace  20260803141231 …sql (soft_deleted_at + 30d)
 *   180 days     copyright/takedown    20260804160000_copyright_takedown.sql
 *
 * If one of those windows changes in a migration, change the policy in the same
 * commit — a published period we do not honour is worse than the vague sentence
 * this replaced.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const policy = readFileSync(join(ROOT, "src/routes/privacy.tsx"), "utf8");

/** The rendered prose, with JSX line breaks flattened so phrases match. */
const prose = policy.replace(/\s+/g, " ");

describe("the privacy policy discloses data retention", () => {
  it("has a retention section that names itself as one", () => {
    expect(prose, "the retention heading is gone — Play will re-flag this").toMatch(
      /Data retention and deletion/,
    );
  });

  it("states a period for each category, not just 'while your account is active'", () => {
    // The exact strings Play's reviewer looks for: a duration next to a
    // category. A category with no period is the finding being fixed.
    for (const period of ["10 minutes", "24 hours", "7 days", "90 days", "180 days", "30-day"]) {
      expect(prose, `no retention period "${period}" in the policy`).toContain(period);
    }
  });

  it("says what happens on account deletion, including the grace window", () => {
    expect(prose).toMatch(/30-day grace period/);
    expect(prose).toMatch(/permanently purged/);
  });

  it("keeps the categories the policy collects in section 1", () => {
    // Retention has to cover what collection claims. These are the section-1
    // categories; each needs a period somewhere in section 8.
    for (const category of ["Account data", "Diagnostic", "Location", "Contacts", "Health"]) {
      expect(prose, `${category} is collected but has no stated retention`).toContain(category);
    }
  });

  it("does not promise a period the migrations do not implement", () => {
    // Cross-check the two windows most likely to drift, against the SQL that
    // actually enforces them.
    const grace = readFileSync(
      join(ROOT, "supabase/migrations/20260803141231_5c895999-feb8-42e5-a773-07c993ff8158.sql"),
      "utf8",
    );
    expect(grace, "the delete-account grace window is no longer 30 days").toContain(
      "interval '30 days'",
    );
    const takedown = readFileSync(
      join(ROOT, "supabase/migrations/20260804160000_copyright_takedown.sql"),
      "utf8",
    );
    expect(takedown, "the takedown-record window is no longer 180 days").toContain(
      "interval '180 days'",
    );
  });
});
