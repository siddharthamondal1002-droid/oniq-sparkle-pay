/**
 * SECURITY (IDOR) — study-chapters must not read another learner's custom
 * syllabus.
 *
 * `profileId` arrives in the request body. The function reads that profile's
 * `chapter_overrides` with the service role, so without an ownership check any
 * authenticated user could pass another family's learner UUID and read that
 * learner's private chapter titles. The fix binds the override read to
 * ownership (`learner_profiles.user_id === userId`); a non-owner falls through
 * to the generic chapter list.
 *
 * Edge functions run on Deno (outside tsconfig), so the defending shape is
 * pinned in source — the same convention as the other edge guards here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(process.cwd(), "supabase/functions/study-chapters/index.ts"),
  "utf8",
);

describe("study-chapters override IDOR guard", () => {
  it("captures the authenticated user id from the verified token", () => {
    expect(src).toMatch(/userId = data\.user\.id/);
  });

  it("checks the caller owns the profile before reading overrides", () => {
    // Ownership is verified against learner_profiles.user_id = the caller.
    expect(src).toMatch(/from\("learner_profiles"\)/);
    expect(src).toMatch(/\.eq\("user_id", userId\)/);
    expect(src).toMatch(/ownsProfile/);
  });

  it("only reads chapter_overrides when the caller owns the profile", () => {
    // The override branch is gated on ownsProfile, not just on a valid UUID.
    expect(src).toMatch(/if \(isUuid && ownsProfile\)/);
  });
});
