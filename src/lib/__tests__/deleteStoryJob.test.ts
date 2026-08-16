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
 * IN-FLIGHT JOBS ARE REFUSED, and that is a policy boundary rather than a
 * technical one: deleting a job mid-render raises whether its seconds come
 * back, and refunds are the owner's call (CLAUDE.md). Those age out on their
 * own inside the sweep's stale window and refund themselves.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SQL = read("supabase/migrations/20260815200000_delete_story_job.sql");

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

  it("refuses a job that is still being made", () => {
    expect(SQL).toContain("if j.status not in ('ready', 'delivered', 'failed')");
    expect(SQL).toContain("'still-working'");
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

  it("offers delete on finished AND failed rows", () => {
    expect(UI).toContain(
      'const deletable = r.status === "ready" || r.status === "delivered" || failed',
    );
  });

  it("does not offer it while a job is still rendering", () => {
    // The button would only produce the RPC's own refusal.
    const gate = UI.slice(UI.indexOf("const deletable"), UI.indexOf("const deletable") + 200);
    expect(gate).not.toContain('"queued"');
    expect(gate).not.toContain('"generating"');
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
