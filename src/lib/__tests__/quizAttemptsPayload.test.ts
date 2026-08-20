/**
 * P7 — the study dashboard must not pull every attempt's heavy `answer_sheet`
 * blob on every mount.
 *
 * The bulk attempts query feeds lifetime stats (per-profile accuracy, per-
 * subject aggregates, distinct chapters) so it genuinely reads ALL rows — that
 * cannot be capped without corrupting the totals. What it must NOT do is carry
 * the per-question `answer_sheet` payload for every historical attempt. That
 * blob is fetched lazily, for the one attempt whose review is opened, and
 * presence ("this attempt has a review") comes from a tiny id-only query.
 *
 * These are source assertions (the repo's convention for wiring that a node
 * test can't exercise against a live database). Comments are stripped so a
 * mention of `answer_sheet` in prose never satisfies or breaks a guard.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";

const src = stripComments(
  readFileSync(join(process.cwd(), "src/routes/_authenticated/app.study.tsx"), "utf8"),
);

describe("quiz_attempts dashboard payload", () => {
  it("the bulk attempts select does NOT pull answer_sheet", () => {
    // The long select that also names profile_id is the dashboard's bulk query.
    const m = src.match(/"id, profile_id,[^"]*"/);
    expect(m, "bulk attempts select not found").not.toBeNull();
    expect(m![0]).not.toMatch(/answer_sheet/);
    // And it still carries the fields the stats need.
    expect(m![0]).toMatch(/total_marks/);
    expect(m![0]).toMatch(/marks_scored/);
    expect(m![0]).toMatch(/created_at/);
  });

  it("review presence comes from an id-only query, not the blob", () => {
    // useSheetIds selects only id, filtered to rows that have a sheet.
    expect(src).toMatch(/\.not\(\s*"answer_sheet"\s*,\s*"is"\s*,\s*null\s*\)/);
    // Presence is tested against that id set, not answer_sheet.length.
    expect(src).toMatch(/sheetIdSet\?\.has\(r\.id\)/);
  });

  it("the review modal fetches its own answer_sheet by attempt id", () => {
    expect(src).toMatch(/queryKey:\s*\["quiz-sheet",\s*attempt\.id\]/);
    expect(src).toMatch(/\.select\("answer_sheet"\)/);
  });
});
