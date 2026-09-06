/**
 * DELETING A CREATION MUST NOT BE ABLE TO REFUND A SPEND CAP.
 *
 * This is the property the whole feature turns on, and it is not obvious from
 * the outside. `image_jobs`, `music_jobs` and `voice_jobs` ARE the daily-cap
 * ledgers: each generate function counts rows in its own table over a rolling
 * 24h, twice — once for the house cap and once per user — and NEITHER count
 * filters on `status`. So the obvious implementation of "delete my picture",
 * a hard `DELETE`, would let anyone reset their own cap and the HOUSE cap by
 * deleting in a loop. That is unmetered generation on the owner's metered
 * Google key, reachable by any signed-in person, for the price of a delete.
 *
 * `delete_story_job` had already reached this conclusion for films — its own
 * comment says a delete "could delete the record of what it was charged" — and
 * every one of these three tables carries a comment saying "a failed attempt
 * that cost money is still recorded rather than vanishing".
 *
 * So the three edge functions MARK the row (`status = "deleted"`, path nulled)
 * and remove the object. The person's content is gone; the receipt is not.
 * These assertions read the deployed source because that behaviour lives in
 * Deno functions a vitest run cannot import or execute.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const FUNCTIONS = [
  ["image-generate", "image_jobs", "pictures"],
  ["music-generate", "music_jobs", "songs"],
  ["voice-generate", "voice_jobs", "voice clips"],
] as const;

const raw = (fn: string) => readFileSync(`supabase/functions/${fn}/index.ts`, "utf8");

/**
 * Comments are stripped before every structural assertion below, and the first
 * draft of this file is why. The delete block's own comment EXPLAINS the
 * ownership filter by quoting it, so counting `.eq("user_id", user.id)` over
 * the raw text found three and the test failed against correct code. The
 * gate-ordering check had the same fault from the other side: its regex
 * matched the phrase "daily cap" in the file's header comment, hundreds of
 * lines above the gate it meant to locate.
 *
 * Prose that quotes code is not code. Where a test reads source structurally,
 * strip the prose or it is asserting about the documentation.
 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const src = (fn: string) => stripComments(raw(fn));

/** The body of the `delete` action, up to the response it returns. */
function deleteBlock(fn: string): string {
  const s = src(fn);
  const at = s.indexOf('if (body.action === "delete")');
  expect(at, `${fn} has no delete action`).toBeGreaterThan(-1);
  const end = s.indexOf("return json(200, { deleted: id });", at);
  expect(end, `${fn}'s delete action never returns`).toBeGreaterThan(at);
  return s.slice(at, end);
}

describe("the spend receipt survives a delete", () => {
  it.each(FUNCTIONS)("%s marks the row instead of deleting it", (fn, table) => {
    const block = deleteBlock(fn);
    expect(block).toContain('.update({ status: "deleted", stored_path: null })');
    expect(block).toContain(`.from("${table}")`);
    // The exact shape of the vulnerability: a hard delete on the ledger table.
    expect(block, `${fn} hard-DELETEs its cap ledger — see this file's header`).not.toMatch(
      /\.delete\(\)/,
    );
  });

  it.each(FUNCTIONS)("%s still removes the bytes — content really goes", (fn) => {
    expect(deleteBlock(fn)).toContain(".storage.from(BUCKET).remove([path])");
  });

  it.each(FUNCTIONS)("%s neither cap count filters on status", (fn) => {
    // If a future edit made the counts skip status="deleted", marking would
    // become equivalent to deleting and the hole would reopen with every
    // assertion above still green.
    const s = src(fn);
    const counts = s.split('count: "exact", head: true');
    expect(counts.length).toBeGreaterThan(1);
    for (const after of counts.slice(1)) {
      const stmt = after.slice(0, after.indexOf(";"));
      expect(stmt, `${fn} filters a cap count on status`).not.toContain('"status"');
    }
  });
});

describe("the ownership boundary is the user_id filter", () => {
  it.each(FUNCTIONS)("%s scopes BOTH the read and the write to the caller", (fn) => {
    const block = deleteBlock(fn);
    // `admin` is the service role and bypasses RLS, so these are the whole
    // authorization. Two of them, because the read authorizes and the write
    // mutates — either one alone leaves a hole.
    expect(block.match(/\.eq\("user_id", user\.id\)/g) ?? []).toHaveLength(2);
    expect(block).toContain('.eq("id", id)');
  });

  it.each(FUNCTIONS)("%s answers the same for 'not yours' and 'not there'", (fn) => {
    // One 404 for both, so the endpoint cannot be used to probe whether an id
    // exists in someone else's account.
    const block = deleteBlock(fn);
    expect(block).toMatch(/if \(!mine\) return json\(404/);
  });
});

describe("deleting is reachable when generating is not", () => {
  it.each(FUNCTIONS)("%s handles delete before the spend gates", (fn) => {
    // A person at their daily cap must still be able to remove what they made.
    // Ordering in the file IS the behaviour: every gate returns early, so a
    // delete placed after one is unreachable for exactly the people who most
    // need it.
    //
    // The gate is located by its EFFECT — a 429 — rather than by any wording.
    // The first draft searched for "daily cap" and matched the file's header
    // comment instead, which put the "gate" above the delete and failed.
    const s = src(fn);
    const del = s.indexOf('if (body.action === "delete")');
    const gate = s.indexOf("return json(429");
    expect(del, `${fn} has no delete action`).toBeGreaterThan(-1);
    expect(gate, `${fn} has no 429 gate to be ahead of`).toBeGreaterThan(-1);
    expect(del, `${fn} puts delete behind a spend gate`).toBeLessThan(gate);
  });

  it("the stripper works, or every assertion here is vacuous", () => {
    expect(stripComments("a /* x */ b")).not.toContain("x");
    expect(stripComments("a // x\nb")).not.toContain("x");
    expect(stripComments('u.eq("a") // .eq("b")')).toContain('.eq("a")');
    expect(stripComments('u.eq("a") // .eq("b")')).not.toContain('.eq("b")');
    expect(src("image-generate")).toContain('if (body.action === "delete")');
  });
});

// ---------------------------------------------------------------------------

const invoke = vi.fn();
const deleteStoryJob = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));
vi.mock("@/components/stories/storyJobsClient", () => ({
  deleteStoryJob: (...a: unknown[]) => deleteStoryJob(...a),
}));

const { deleteCreation } = await import("@/lib/deleteCreation");

describe("one call site, four kinds", () => {
  beforeEach(() => {
    invoke.mockReset();
    deleteStoryJob.mockReset();
  });

  it.each([
    ["picture", "image-generate"],
    ["song", "music-generate"],
    ["clip", "voice-generate"],
  ] as const)("%s goes to %s with the delete action", async (kind, fn) => {
    invoke.mockResolvedValue({ data: { deleted: "abc" }, error: null });
    await expect(deleteCreation(kind, "abc")).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith(fn, { body: { action: "delete", id: "abc" } });
  });

  it("a film goes to the RPC, not to an edge function", async () => {
    deleteStoryJob.mockResolvedValue({ ok: true, bytesPending: true });
    await expect(deleteCreation("film", "f1")).resolves.toEqual({ ok: true });
    expect(deleteStoryJob).toHaveBeenCalledWith("f1");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("a film still rendering says so, rather than reading as a bug", async () => {
    deleteStoryJob.mockResolvedValue({ ok: false, reason: "still-working" });
    const res = await deleteCreation("film", "f1");
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.message).toMatch(/still being made/i);
  });

  it("a 200 that does not confirm the id is NOT treated as success", async () => {
    // invoke resolves with error:null for any 2xx, so the body is what says
    // the row was actually marked. Trusting the absence of an error would
    // report a delete that never happened.
    invoke.mockResolvedValue({ data: {}, error: null });
    await expect(deleteCreation("picture", "abc")).resolves.toMatchObject({ ok: false });
  });

  it("an error from the function surfaces as a failure, per kind", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("boom") });
    const res = await deleteCreation("clip", "abc");
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.message).toMatch(/voice clip/);
  });

  it("an empty id never reaches the network", async () => {
    await expect(deleteCreation("song", "   ")).resolves.toMatchObject({ ok: false });
    expect(invoke).not.toHaveBeenCalled();
    expect(deleteStoryJob).not.toHaveBeenCalled();
  });
});

/**
 * ALL FOUR KINDS, which is the whole of the owner's ask: "give delete option
 * in create across all four".
 *
 * The creations screen renders three card shapes — a picture, an audio player
 * shared by songs and voice clips, and a film that links out to Lores — so
 * "all four" is four kinds across three JSX branches, and the easy failure is
 * to wire two of them and believe it is done. Asserted per KIND rather than
 * per card, so a branch that renders a card without a control fails here.
 */
describe("the creations screen offers delete on all four kinds", () => {
  const screen = stripComments(readFileSync("src/routes/_authenticated/app.creations.tsx", "utf8"));

  it("renders a DeleteControl in every card branch", () => {
    expect(screen.match(/<DeleteControl/g) ?? []).toHaveLength(3);
    expect(screen).toContain('testId="creation-picture-delete"');
    expect(screen).toContain('testId="creation-audio-delete"');
    expect(screen).toContain('testId="creation-film-delete"');
  });

  it("passes the right kind to each — songs and clips share a card, not a kind", () => {
    // The audio card serves two kinds, so it must forward item.kind rather
    // than a literal; hard-coding "song" there would delete a voice clip
    // through the music function, which 404s and reads as a broken button.
    expect(screen).toMatch(/kind=\{"picture"\}/);
    expect(screen).toMatch(/kind=\{item\.kind\}/);
    expect(screen).toMatch(/kind=\{"film"\}/);
  });

  it("confirms before deleting, and never with a native dialog", () => {
    expect(screen).toContain("confirmId");
    expect(screen).not.toMatch(/window\.confirm|\bconfirm\(/);
  });

  it("removes the item from view and can say why it did not", () => {
    expect(screen).toContain("goneIds");
    expect(screen).toContain("deleteError");
    expect(screen).toMatch(/role="alert"/);
  });
});
