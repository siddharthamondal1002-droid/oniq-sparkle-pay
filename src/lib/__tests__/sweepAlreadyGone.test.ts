/**
 * A DELETION THAT FINDS NOTHING TO DELETE HAS SUCCEEDED.
 *
 * story-sweep retries any row marked `purged` that still counts as holding
 * bytes, which is correct — that combination means a delete failed and the
 * file is still costing storage. What was wrong was how it recognised the one
 * case where nothing is left to do.
 *
 * It tested `del.status !== 404`. Supabase Storage answers a missing object
 * with HTTP 400 and puts the 404 in the BODY, so the check never fired: the
 * sweep re-attempted a file that had already been deleted, refused to clear
 * has_bytes because "the deletion did not happen", and re-reported the same
 * failure every fifteen minutes. Measured 2026-08-15 on job fd48e8d3 —
 * retrying since 2026-08-10, with the object confirmed absent from
 * storage.objects while every other stories/*.mp4 was present.
 *
 * The damage was not the wasted request. `failures` is the list a person
 * reads to find a real problem, and one permanent entry in it is enough to
 * stop anyone reading the list at all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SWEEP = readFileSync(join(process.cwd(), "supabase/functions/story-sweep/index.ts"), "utf8");
const DELIVER = readFileSync(
  join(process.cwd(), "supabase/functions/story-deliver/index.ts"),
  "utf8",
);

describe("the sweep's already-gone check", () => {
  it("reads the body, not just the status code", () => {
    // The status alone cannot answer this question on this provider.
    expect(SWEEP).toContain("await del.text()");
    expect(SWEEP).toMatch(/statusCode.*404|not\[_ \]\?found/i);
  });

  it("no longer decides on the status code alone", () => {
    expect(
      /if \(!del\.ok && del\.status !== 404\)/.test(SWEEP),
      "back to the status-only check — an already-deleted file will fail forever again",
    ).toBe(false);
  });

  it("still refuses to clear has_bytes on a genuine failure", () => {
    // The whole point of the retry is that a real failure must NOT be
    // recorded as a deletion. Only the already-gone case may fall through.
    expect(SWEEP).toContain("failures.push(`${row.id}: storage ${del.status}`)");
    const block = SWEEP.slice(SWEEP.indexOf("if (!del.ok)"));
    expect(block.indexOf("if (!gone)"), "the failure path was removed").toBeGreaterThan(0);
    expect(block.indexOf("continue;")).toBeGreaterThan(block.indexOf("if (!gone)"));
  });

  it("keeps retrying a purged row that still holds bytes", () => {
    // The predicate that makes the retry happen at all — a row marked purged
    // with bytes remaining is a failed delete, not a finished job.
    const lifecycle = readFileSync(join(process.cwd(), "src/lib/storyLifecycle.ts"), "utf8");
    expect(lifecycle).toContain('if (job.status === "purged") return true;');
  });
});

describe("delivery's already-gone check", () => {
  it("reads the body because Supabase reports a missing object as HTTP 400", () => {
    expect(DELIVER).toContain("await del.text()");
    expect(DELIVER).toMatch(/statusCode.*404|not\[_ \]\?found/i);
  });

  it("does not decide from the HTTP status alone", () => {
    expect(/if \(!del\.ok && del\.status !== 404\)/.test(DELIVER)).toBe(false);
  });
});
