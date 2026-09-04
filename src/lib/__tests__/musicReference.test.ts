/**
 * THE TWO-STAGE REFERENCE PIPELINE, asserted where it is wired.
 *
 * OWNER DIRECTIVE 2026-09-04c:
 *
 *     reference audio -> Gemini audio understanding -> structured Music Brief
 *                     -> Lyria
 *
 * musicBrief.test.ts covers the pure half — the ask, the parsing, the compiled
 * prompt. This file covers the half that can only be checked against the edge
 * function itself: the ORDER of the stages, the fact that the recording never
 * reaches the music model, that each provider call has its own reservation,
 * and that a failure at either stage still consumes a slot rather than being
 * a free way to spend somebody's key.
 *
 * Asserted over SOURCE, not by running anything, because a violation here has
 * to fail the build the moment it is written — the first time it matters, a
 * bill has already been paid or a recording has already been sent somewhere it
 * should not go.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MUSIC_ACCEPTS_AUDIO_REFERENCE,
  MUSIC_ACCEPTS_IMAGE_REFERENCE,
  MUSIC_MODEL,
} from "../../../supabase/functions/_shared/musicCore.ts";
import { BRIEF_ASK, compileMusicPrompt } from "../../../supabase/functions/_shared/musicBrief.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const FN = read("supabase/functions/music-generate/index.ts");
/** Comments describe code; they are not code. */
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("the recording never reaches the music model", () => {
  it("keeps the measured refusal recorded, so the route is not re-litigated", () => {
    // Both flags carry their evidence in musicCore.ts. The flag alone would be
    // argued with in a month; the 400 text and the no-attachment control are
    // what settle it.
    expect(MUSIC_ACCEPTS_AUDIO_REFERENCE).toBe(false);
    expect(MUSIC_ACCEPTS_IMAGE_REFERENCE).toBe(true);
  });

  it("sends the track's bytes to exactly one place, and it is not Lyria", () => {
    // `refAudio` is the only binding holding the recording. If it appears
    // anywhere near the Lyria call, the recording is being forwarded.
    const uses = [...CODE.matchAll(/refAudio\.(mimeType|data)/g)];
    expect(uses.length, "the recording must be sent exactly once").toBe(2);
    const listenAt = CODE.indexOf("model: AUDIO_UNDERSTANDING_MODEL");
    for (const u of uses) {
      expect(Math.abs(u.index! - listenAt)).toBeLessThan(600);
    }
  });

  it("describes the track BEFORE it writes the song", () => {
    // Reversed, the brief would be derived from a song that had already been
    // generated without it — two charges and no reference.
    expect(CODE.indexOf("model: AUDIO_UNDERSTANDING_MODEL")).toBeLessThan(
      CODE.indexOf("model: MUSIC_MODEL"),
    );
  });

  it("gives Lyria the compiled prompt, not the raw one, when a track came", () => {
    expect(CODE).toContain("compileMusicPrompt(brief, prompt)");
    expect(CODE).toMatch(/parts\.push\(\{ text: lyriaPrompt \}\)/);
  });

  it("says the no-copying rule to both models, not just the first", () => {
    // The brief passes through a language model in between and can come back
    // carrying a phrase closer to the original than was asked for.
    expect(BRIEF_ASK).toMatch(/do not transcribe or reproduce/i);
    expect(compileMusicPrompt({ genre: "lo-fi" })).toMatch(
      /do not reproduce any existing melody or lyrics/i,
    );
  });
});

describe("a picture, on the other hand, goes straight in", () => {
  it("is pushed as an inlineData part before the words", () => {
    // Measured 200, with lyrics visibly derived from the image and Google
    // billing it as modality IMAGE — so it was read, not ignored.
    const from = CODE.indexOf("const parts: GooglePart[]");
    const call = CODE.indexOf("model: MUSIC_MODEL", from);
    const block = CODE.slice(from, call);
    expect(block).toContain("body.referenceImage");
    expect(block.indexOf("inlineData"), "the picture goes before the text").toBeLessThan(
      block.indexOf("text: lyriaPrompt"),
    );
  });

  it("names the model it was measured against", () => {
    expect(MUSIC_MODEL).toBe("lyria-3-pro-preview");
  });
});

describe("both attachments are checked before either charge", () => {
  it("validates them before the first provider call", () => {
    const firstCall = CODE.indexOf("googleGenerateContent(");
    for (const gate of ["validateMusicImage(", "validateMusicAudio(", "validateMusicPrompt("]) {
      const at = CODE.indexOf(gate);
      expect(at, `${gate} is missing`).toBeGreaterThan(-1);
      expect(at, `${gate} runs after a charge`).toBeLessThan(firstCall);
    }
  });

  it("reserves separately for listening and for writing", () => {
    // Two provider calls, two reservations. Folding the listening stage into
    // the song's would mean the ledger recorded a charge it never reserved.
    expect(CODE.match(/await withProviderSpendGuard\(/g) ?? []).toHaveLength(2);
    expect(CODE).toContain("MUSIC_BRIEF_BUDGET.maxEstimatedUsd");
    expect(CODE).toContain("MUSIC_BUDGET.maxEstimatedUsd");
  });

  it("spends both stages out of MUSIC's own budget row", () => {
    // Reusing TEXT's bucket for the listening call would let one capability's
    // runaway drain another's — the warning provider_budget_config carries.
    expect(CODE.match(/capability: "MUSIC"/g) ?? []).toHaveLength(2);
  });
});

describe("a failure still consumes a slot", () => {
  it("records a row when the brief cannot be made", () => {
    // Without it, a caller could burn listening calls all day without ever
    // consuming a song — the caps count music_jobs rows. The row is also
    // simply true: the money was spent.
    const at = CODE.indexOf("no usable brief");
    expect(at, "a failed brief must be recorded").toBeGreaterThan(-1);
    const around = CODE.slice(at - 500, at + 200);
    expect(around).toContain('from("music_jobs").insert(');
    expect(around).toContain('status: "failed"');
    expect(around).toContain('reference: "audio"');
  });

  it("refuses rather than generating from an empty brief", () => {
    // An empty brief compiles to "Create an original piece of music." — what
    // attaching nothing gives you — while telling the person their track was
    // used. Generating anyway would be the lie.
    expect(CODE).toContain("if (!brief) {");
    const at = CODE.indexOf("if (!brief) {");
    expect(CODE.slice(at, at + 900)).toMatch(/return json\(502/);
    expect(at).toBeLessThan(CODE.indexOf("model: MUSIC_MODEL"));
  });

  it("records what was attached on every row it writes, failures included", () => {
    // A reference that reliably fails is then visible in the table rather
    // than only in a log nobody reads. Every insert is checked, not counted:
    // a count passes the day somebody adds a fifth insert without the field.
    const marker = 'from("music_jobs").insert(';
    const bodies: string[] = [];
    for (let at = CODE.indexOf(marker); at !== -1; at = CODE.indexOf(marker, at + 1)) {
      bodies.push(CODE.slice(at, CODE.indexOf("})", at)));
    }
    expect(bodies.length, "the writes this function makes").toBeGreaterThanOrEqual(4);
    for (const b of bodies) {
      expect(b, b.slice(0, 120)).toMatch(/reference[,:]/);
    }
  });
});

describe("what the person is shown", () => {
  it("hands the brief back so the screen can say what it heard", () => {
    // The owner asked for this explicitly. Showing the derived
    // characteristics is the plainest demonstration that the reference
    // produced a description and not a copy.
    expect(CODE).toContain("briefLine = describeBrief(brief)");
    expect(CODE).toMatch(/brief: briefLine,/);
  });

  it("stores it, so a song still says where it came from tomorrow", () => {
    const migration = read("supabase/migrations/20260904150000_music_reference_provenance.sql");
    expect(migration).toMatch(/add column if not exists reference text/);
    expect(migration).toMatch(/add column if not exists brief text/);
    // Only two values are ever written; a typo would silently become a third
    // category the screen does not know how to draw.
    expect(migration).toMatch(/check \(reference is null or reference in \('image', 'audio'\)\)/);
  });

  it("returns provenance on the listing too, not only on the new song", () => {
    expect(CODE).toContain('"id, created_at, prompt, stored_path, reference, brief"');
  });
});
