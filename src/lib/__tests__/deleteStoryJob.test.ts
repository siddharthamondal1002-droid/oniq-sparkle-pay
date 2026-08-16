/**
 * Deleting your own film, and the two things that make it safe.
 *
 * Your videos could delete a copy saved onto the phone and nothing else. A
 * finished film on our servers, and a failed job's row, could only be removed
 * by waiting — thirty days for the film, forever for the failure notice. A
 * "delete" that means "wait a month" is not a delete.
 *
 * THE BYTES ARE THE PART THAT CAN GO WRONG. The RPC marks the row `purged` and
 * deliberately leaves has_bytes alone, because story-sweep asks about BYTES:
 * owesPurge() returns true for a purged row that still holds them, which is
 * exactly how a recorded-but-unperformed delete gets retried. Clearing
 * has_bytes here would be the one mistake that matters — the sweep would skip
 * the row and the file would sit in the bucket forever, referenced by nothing.
 *
 * IN-FLIGHT JOBS ARE STOPPED AND REFUNDED (2026-08-16). They were refused at
 * first, because deleting one raises whether its seconds come back and refunds
 * are the owner's call. Asked for delete everywhere, the answer is the rule
 * this system already ran: story-sweep fails any queued/generating/assembling
 * job untouched for thirty minutes and refunds it. A job that makes no film
 * returns its seconds; cancelling by hand makes no film. The only thing that
 * changed is who starts the clock.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
// The NEWEST definition is the one the database runs. 20260815200000 created
// this function refusing in-flight jobs; 20260816040000 replaced it to accept
// them and refund. A test still parsing the first file would be pinning a
// definition Postgres no longer has — the guard would go quiet, not fail.
const SQL = read("supabase/migrations/20260816040000_delete_story_job_in_flight.sql");

/**
 * The migration with its `--` comment lines removed.
 *
 * Needed because the comments in this file DESCRIBE the mistake they exist to
 * prevent — "setting has_bytes = false here would be the one mistake that
 * matters" — and a naive scan of the whole file cannot tell an explanation of
 * a hazard from the hazard. The first run of this test failed on its own
 * documentation, which is funny once and misleading forever.
 */
const STATEMENTS = SQL.split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");
const CLIENT = read("src/components/stories/storyJobsClient.ts");
const UI = read("src/components/stories/YourVideos.tsx");
const LIFECYCLE = read("src/lib/storyLifecycle.ts");

describe("the delete RPC", () => {
  it("never clears has_bytes — the sweep is what removes the file", () => {
    expect(
      /has_bytes\s*=\s*false/.test(STATEMENTS),
      "clearing has_bytes orphans the object: the sweep skips the row and nothing else looks at it",
    ).toBe(false);
    expect(STATEMENTS).toContain("set status = 'purged'");
  });

  it("relies on a purged row with bytes still owing a purge", () => {
    // The RPC is only safe because of this line in the shared lifecycle rules.
    expect(LIFECYCLE).toContain('if (job.status === "purged") return true;');
  });

  it("is scoped to the caller in the same statement that locks the row", () => {
    // Ownership as a separate query would be a race, and this table records
    // what somebody was charged.
    expect(SQL).toContain("where id = _job_id and user_id = me for update");
  });

  /**
   * IN-FLIGHT JOBS ARE STOPPED AND REFUNDED, not refused.
   *
   * The seconds coming back is not a new policy — it is the rule already
   * running: story-sweep fails any queued/generating/assembling job untouched
   * for thirty minutes and refunds it. A job that makes no film returns its
   * seconds; cancelling by hand makes no film. The only change is who starts
   * the clock.
   */
  it("stops an in-flight job the way the sweep would, and refunds it", () => {
    expect(STATEMENTS).toContain(
      "if j.status in ('queued', 'generating', 'assembling', 'delivering')",
    );
    expect(STATEMENTS).toContain("set status = 'failed'");
    expect(STATEMENTS).toContain("perform public.refund_story_seconds(_job_id)");
  });

  it("marks failed BEFORE refunding", () => {
    // Refunding first would leave a job a renderer could still pick up and be
    // charged nothing for.
    const body = STATEMENTS.slice(STATEMENTS.indexOf("if j.status in ('queued'"));
    expect(body.indexOf("set status = 'failed'")).toBeLessThan(
      body.indexOf("refund_story_seconds"),
    );
  });

  it("no longer refuses anything but a missing row", () => {
    expect(STATEMENTS).not.toContain("'still-working'");
  });

  it("is idempotent on an already-deleted row", () => {
    // A double tap or a retried call must not read as a failure.
    expect(SQL).toContain("if j.status = 'purged'");
    expect(SQL).toContain("'alreadyGone'");
  });

  it("is definer, search_path pinned, and not reachable by anon", () => {
    expect(SQL).toContain("security definer");
    expect(SQL).toContain("set search_path = public");
    expect(SQL).toContain("revoke all on function public.delete_story_job(uuid) from public, anon");
    expect(SQL).toContain(
      "grant execute on function public.delete_story_job(uuid) to authenticated",
    );
  });
});

describe("the client and the list", () => {
  it("goes through the RPC rather than deleting rows directly", () => {
    // story_jobs has exactly one policy and it is SELECT. A direct delete
    // would need a client-writable path into the table holding the charges.
    // Whitespace-insensitive: prettier wraps this call's arguments, and a
    // guard that breaks on reformatting teaches people to delete guards.
    expect(CLIENT).toMatch(/supabase\.rpc\(\s*"delete_story_job"/);
    expect(
      /from\("story_jobs"\)[\s\S]{0,40}\.delete\(\)/.test(CLIENT),
      "a direct client delete on story_jobs",
    ).toBe(false);
  });

  it("keeps purged rows out of the list, which is what makes it vanish", () => {
    // The optimistic removal below is only honest because a refresh agrees.
    expect(CLIENT).toContain('.in("status", [...OPEN_STATUSES, "failed"])');
    expect(CLIENT).not.toContain('"purged"]');
  });

  it("offers delete on every row, at every stage", () => {
    expect(UI).toContain("const deletable = true;");
  });

  it("says what a mid-render delete actually does", () => {
    // "Delete" on something still being made is a different promise from
    // "Delete" on a finished film, and the copy has to carry that.
    expect(UI).toContain("Stop & delete");
    expect(UI).toContain("The time it was going to use comes back to you.");
  });

  it("closes the player when the film being watched is deleted", () => {
    // Leaving a player open on bytes that are being removed is worse than a
    // stale list.
    const fn = UI.slice(UI.indexOf("const removeJob"), UI.indexOf("const removeFromDevice"));
    expect(fn).toContain("if (openId === r.id)");
    expect(fn).toContain("setFilmUrl(null)");
  });

  it("asks before deleting, with wording that matches what is lost", () => {
    expect(UI).toContain("Delete this film from ONIQ?");
    expect(UI).toContain("Nothing is lost — it never finished.");
  });

  it("keeps the two confirmations apart", () => {
    // The on-phone list and the server list can both be open; one shared id
    // would arm the wrong confirmation.
    expect(UI).toContain("const [confirmJob, setConfirmJob]");
    expect(UI).toContain("const [confirmDelete, setConfirmDelete]");
  });
});
