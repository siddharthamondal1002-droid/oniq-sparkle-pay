/**
 * A CHARACTER CAN NOW COME FROM A PHOTO, and two things must stay true.
 *
 * Owner directive 2026-09-06: "image not used in making video". Asked what a
 * picture should DO, the owner chose "character reference — a face that
 * recurs". Until then a film took no picture at all — StoryWriter is a text
 * box, and the only image inputs anywhere were Music and Image.
 *
 * FIRST, THE FILE'S OWN CLAIM IS NOT EVIDENCE. A picker reports `File.type`
 * derived from the extension, so renaming anything to `.png` makes the browser
 * call it an image. Only the leading bytes say what something is.
 *
 * SECOND, THE LABEL MUST FOLLOW THE ORIGIN. A drawn portrait is AI-generated
 * content ONIQ has to label for Play; a photo the person took is not, and
 * calling it "AI-generated" is a false claim in the other direction. This repo
 * has already missed AI labelling once, and the fix then was to key it off the
 * data rather than the surface — same rule here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACTOR_PHOTO_HEAD_BYTES,
  actorPortraitAlt,
  actorPortraitIsAi,
  validateActorPhoto,
} from "@/lib/actorPhoto";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
/** A shell script. Rename it `.png` and every picker calls it an image. */
const SCRIPT = new TextEncoder().encode("#!/bin/sh\nrm");

describe("the bytes decide, not the name", () => {
  it.each([
    ["png", PNG, "image/png"],
    ["jpeg", JPEG, "image/jpeg"],
    ["webp", WEBP, "image/webp"],
  ])("accepts a real %s", (_label, head, mime) => {
    expect(validateActorPhoto(1024, head)).toEqual({ ok: true, mime });
  });

  it("refuses a script however it is named", () => {
    const v = validateActorPhoto(1024, SCRIPT);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.message).toMatch(/PNG, JPEG or WebP/);
  });

  it("refuses a GIF — a real image, but not one Postgres will store", () => {
    // story_actor_assets.mime is CHECK-constrained to three values, so an
    // accepted fourth would upload the bytes and then fail the row insert,
    // leaving an orphan in the bucket.
    const gif = new TextEncoder().encode("GIF89a______");
    expect(validateActorPhoto(1024, gif).ok).toBe(false);
  });

  it("bounds the size before anything is read whole", () => {
    expect(validateActorPhoto(15 * 1024 * 1024 + 1, PNG).ok).toBe(false);
    expect(validateActorPhoto(0, PNG).ok).toBe(false);
    expect(validateActorPhoto(15 * 1024 * 1024, PNG).ok).toBe(true);
  });

  it("asks for only a short head, so a huge refusal stays cheap", () => {
    expect(ACTOR_PHOTO_HEAD_BYTES).toBeLessThanOrEqual(16);
    // and the verdict really is reachable from that many bytes
    expect(validateActorPhoto(999, PNG.slice(0, ACTOR_PHOTO_HEAD_BYTES)).ok).toBe(true);
  });

  it("says something a person can act on, not a developer's sentence", () => {
    const big = validateActorPhoto(99 * 1024 * 1024, PNG);
    expect(big.ok === false && big.message).toMatch(/too large \(max 15MB\)/);
  });
});

describe("the label follows where the pixels came from", () => {
  it("a drawn portrait is declared AI, a photo is not", () => {
    expect(actorPortraitAlt("Meera", "generated")).toBe("AI-generated portrait of Meera");
    expect(actorPortraitAlt("Meera", "uploaded")).toBe("Photo of Meera");
    expect(actorPortraitIsAi("generated")).toBe(true);
    expect(actorPortraitIsAi("uploaded")).toBe(false);
  });

  it("an unknown source is treated as AI — the safe direction", () => {
    // Over-labelling as AI is harmless; under-labelling is the Play problem.
    expect(actorPortraitIsAi("")).toBe(true);
    expect(actorPortraitIsAi("something-new")).toBe(true);
    expect(actorPortraitAlt("X", "wat")).toMatch(/AI-generated/);
  });
});

/**
 * COMMENTS ARE STRIPPED, AND THIS IS THE THIRD TIME IN ONE DAY.
 *
 * A source-reading assertion keeps matching PROSE. The UPI decline test
 * counted an ownership filter its own comment quoted; the delete test located
 * a spend gate by a phrase that appears in a file header; and this one banned
 * `.arrayBuffer()` while the very comment explaining why it was avoided says
 * `.arrayBuffer()`.
 *
 * The pattern is not carelessness, it is structural: good comments quote the
 * code they discuss, so any grep strict enough to be useful will hit them.
 * Where a test reads source structurally, strip the prose first — otherwise it
 * is asserting about the documentation, and it fails hardest on the code that
 * is best explained.
 */
function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("the builder is wired to record the origin", () => {
  const src = stripComments(readFileSync("src/components/stories/CharacterBuilder.tsx", "utf8"));

  it("the stripper works, or the bans below are vacuous", () => {
    expect(stripComments("a /* .arrayBuffer() */ b")).not.toContain("arrayBuffer");
    expect(stripComments("a // .arrayBuffer()\nb")).not.toContain("arrayBuffer");
    expect(src).toContain("attachPhoto");
  });

  it("passes _source to the RPC", () => {
    expect(src).toContain("_source: source");
  });

  it("reads source back so the grid can label honestly", () => {
    expect(src).toContain("source, created_at");
    expect(src).toContain("actorPortraitAlt(");
    // the hard-coded claim must be gone
    expect(src).not.toContain("`AI-generated portrait of ${m.name}`");
  });

  it('"Save again" cannot relabel a photo as AI', () => {
    // The retry replays a held buffer. If it forgot the origin it would
    // default to "generated" and quietly mark a real photo as AI-generated.
    expect(src).toContain("unsaved.source");
    expect(src).toMatch(/source: "generated" \| "uploaded";/);
  });

  it("never reads the whole file at all", () => {
    /**
     * The first version of this assertion demanded `file.arrayBuffer()` and
     * only checked it came AFTER the sniff. megaLoopGuardrails then failed the
     * build: `.arrayBuffer()` is banned repo-wide on upload paths, with a
     * frozen tail of exactly five pre-existing reads that nothing may join.
     * The fix was better than the ordering it was policing — a picked photo is
     * already a Blob and Supabase's upload takes one, so the bytes stream to
     * storage and are never materialised. This now pins the stronger property.
     */
    expect(src).not.toMatch(/\.arrayBuffer\(\)/);
    expect(src).not.toMatch(/readAsDataURL|readAsArrayBuffer|readAsBinaryString/);
    expect(src).toContain("file.slice(0, ACTOR_PHOTO_HEAD_BYTES).stream()");
    // and the verdict is still reached before anything is uploaded
    const at = src.indexOf("validateActorPhoto(");
    const up = src.indexOf('saveBytes(member, verdict.mime, file, "uploaded")');
    expect(at).toBeGreaterThan(-1);
    expect(up).toBeGreaterThan(at);
  });

  it("is not named like a hook, because ESLint would refuse it", () => {
    // react-hooks/rules-of-hooks is a release blocker here: a `use` prefix
    // makes ESLint treat it as a hook and reject the onChange call site.
    expect(src).toContain("const attachPhoto = useCallback(");
    expect(src).not.toMatch(/const usePhoto\s*=/);
  });

  it("clears the input so the same file can be picked twice", () => {
    expect(src).toContain('e.target.value = ""');
  });
});

describe("the migration opens the column it needs", () => {
  const sql = readFileSync("supabase/migrations/20260906180000_actor_photo_source.sql", "utf8");

  it("widens the check rather than inventing a column", () => {
    expect(sql).toMatch(/check \(source in \('generated', 'uploaded'\)\)/);
  });

  it("drops the 5-argument function so a 5-arg call cannot go ambiguous", () => {
    // Adding a defaulted parameter creates a SECOND signature; leaving both
    // makes every existing 5-argument call fail at run time in production
    // rather than at deploy.
    expect(sql).toMatch(
      /drop function if exists public\.save_story_actor\(text, text, text, text, text\)/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.save_story_actor\(text, text, text, text, text, text\)/,
    );
  });

  it("allowlists the source instead of passing it through", () => {
    expect(sql).toMatch(/case when _source = 'uploaded' then 'uploaded' else 'generated' end/);
  });
});
