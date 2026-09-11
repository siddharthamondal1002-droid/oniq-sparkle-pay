/**
 * Films in a language other than English (owner directive, 2026-09-03).
 *
 * One property of the job, carried end to end: chosen in the studio, validated
 * by the claim and by the column, handed to the worker at claim, sent to the
 * plot writer (spoken text in the language, image prompts in English) and
 * used to pick the voice engine: the cloud voice, because no in-house voice
 * exists for it. These pins read the files the production path actually runs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FILM_LANGUAGES,
  FILM_LANGUAGE_CODES,
  isFilmLanguage,
  voiceEngineFor,
} from "../storyLanguages";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIGRATION = read("supabase/migrations/20260903120000_story_language_cloud_voice.sql");
/**
 * THE SET LIVES IN THREE PLACES AND THIS IS THE NEWEST. Pinning only the
 * 2026-09-03 migration went stale the moment Punjabi was added: that file
 * still says six, production says seven, and a test reading only the old file
 * would have stayed green while the two disagreed -- the exact drift it exists
 * to catch, inverted. Assertions below derive the expected set from
 * FILM_LANGUAGE_CODES rather than retyping it, so adding a language cannot
 * pass without this migration naming it too.
 */
const LANGUAGE_MIGRATION = read(
  "supabase/migrations/20260911160000_story_jobs_language_punjabi.sql",
);
const WORKER = read("remotion/scripts/story-worker.mjs");
const CALLBACK = read("supabase/functions/story-callback/index.ts");
const PLOT = read("supabase/functions/story-plot/index.ts");
const STUDIO = read("src/components/stories/StoryStudio.tsx");

describe("the language list is the set a voice exists for", () => {
  it("starts with English and offers only languages the cloud voice speaks", () => {
    expect(FILM_LANGUAGE_CODES[0]).toBe("en");
    expect([...FILM_LANGUAGE_CODES]).toEqual(["en", "hi", "bn", "mr", "ta", "te", "pa"]);
    for (const l of FILM_LANGUAGES) expect(l.native.length).toBeGreaterThan(0);
  });

  it("refuses codes outside the list, including translator languages without a voice", () => {
    expect(isFilmLanguage("hi")).toBe(true);
    expect(isFilmLanguage("as")).toBe(false); // Assamese: translatable, no voice
    expect(isFilmLanguage("")).toBe(false);
    expect(isFilmLanguage(undefined)).toBe(false);
  });

  it("the database CHECK and the claim validation carry the same set", () => {
    // The 2026-09-03 original, kept as the record of what shipped then.
    const original = "('en', 'hi', 'bn', 'mr', 'ta', 'te')";
    expect(MIGRATION).toContain(`check (language in ${original})`);
    expect(MIGRATION).toContain(
      `if lang_clean not in ${original} then raise exception 'no such language'`,
    );
  });

  it("the NEWEST migration widens BOTH database gates to the current list", () => {
    // THREE PLACES, NOT TWO. claim_story_seconds refuses an unknown language
    // BEFORE the CHECK constraint is ever reached, so widening only the
    // constraint ships a chip that raises 'no such language' and produces no
    // film at all -- silently, which is how "Spoken in not working" looked.
    const quoted = FILM_LANGUAGE_CODES.map((c) => `'${c}'`);

    // The CHECK: every code present, as a ::text array member.
    for (const c of FILM_LANGUAGE_CODES) {
      expect(LANGUAGE_MIGRATION).toContain(`'${c}'::text`);
    }

    // The claim guard: the exact widened list, derived not retyped.
    expect(LANGUAGE_MIGRATION).toContain(`lang_clean not in (${quoted.join(", ")})`);
  });

  it("refuses to guess if the claim guard is not in the expected shape", () => {
    // Without this the migration could silently do half its job: a missed
    // match would leave the claim refusing the new language forever.
    expect(LANGUAGE_MIGRATION).toContain("refusing to guess");
    expect(LANGUAGE_MIGRATION).toContain("raise exception");
  });
});

describe("the engine rule: English keeps the in-house voice, everything else is the cloud voice", () => {
  it("is decided by the language first and the dispatch setting second", () => {
    expect(voiceEngineFor("en", true)).toBe("local");
    expect(voiceEngineFor("en", false)).toBe("cloud");
    expect(voiceEngineFor("hi", true)).toBe("cloud");
    expect(voiceEngineFor("bn", false)).toBe("cloud");
    expect(voiceEngineFor(undefined, true)).toBe("local");
  });

  it("the worker applies the same rule and keeps the English line the in-house pin reads", () => {
    expect(WORKER).toContain("const cloudForLanguage = filmLanguage !== 'en';");
    expect(WORKER).toContain("process.env.STORY_LOCAL_TTS === 'only' ? 'local' : 'cloud'");
    expect(WORKER).toContain("OWNER DIRECTIVE 2026-09-03");
  });

  it("never steps a non-English film down to the English voice", () => {
    // Piper reading Hindi is English phonemes over Devanagari: worse than no
    // film. The job fails with the reason instead, and time comes back.
    const guard = WORKER.slice(
      WORKER.indexOf("const dry = /story-voice: 502/"),
      WORKER.indexOf("ttsEngine = 'local';"),
    );
    expect(guard).toContain("if (cloudForLanguage) {");
    expect(guard).toContain("cloud voice unavailable for a ${filmLanguage} film");
  });
});

describe("the language travels with the job", () => {
  it("the claim stores it and returns it", () => {
    expect(MIGRATION).toContain("_language text DEFAULT 'en'::text");
    expect(MIGRATION).toContain("grade, verbatim, motion_mode, language)");
    expect(MIGRATION).toContain("'language', lang_clean");
    // Dropped and recreated, never overloaded: PostgREST cannot choose between
    // two signatures for a call that omits the new argument.
    expect(MIGRATION).toContain(
      "drop function if exists public.claim_story_seconds(integer, text, text, boolean);",
    );
    expect(MIGRATION).toContain(
      "grant execute on function public.claim_story_seconds(integer, text, text, boolean, text) to authenticated;",
    );
  });

  it("story-callback hands it to the worker at claim, defaulting an older row to English", () => {
    expect(CALLBACK).toContain("grade,verbatim,language`");
    expect(CALLBACK).toContain(
      'language: typeof job.language === "string" && job.language ? job.language : "en"',
    );
  });

  it("the worker reads it from the claim and from the queue, and sends it to the plot writer", () => {
    expect(WORKER).toContain(
      "language: typeof got.language === 'string' && got.language ? got.language : 'en'",
    );
    expect(WORKER).toContain("plate_path,language'");
    expect(WORKER).toContain(
      "...(job.language && job.language !== 'en' ? { lang: job.language } : {})",
    );
  });

  it("the studio offers exactly the list and sends the code only when it is not English", () => {
    expect(STUDIO).toContain("FILM_LANGUAGES.map((l) =>");
    expect(STUDIO).toContain('...(language !== "en" ? { _language: language } : {})');
  });
});

describe("the plot writer speaks the language and pictures in English", () => {
  it("uses the film instruction, not the chat translator's whole-reply instruction", () => {
    expect(PLOT).not.toContain("langInstruction(lang)");
    expect(PLOT.match(/storyLanguageInstruction\(lang\)/g)?.length).toBe(3);
  });

  it("draws the line between what is spoken and what is seen", () => {
    const helper = PLOT.slice(
      PLOT.indexOf("function storyLanguageInstruction("),
      PLOT.indexOf("const SYSTEM = ["),
    );
    expect(helper).toContain("every \\`narration\\` and every \\`dialogue.line\\` in ${name}");
    expect(helper).toContain("Keep EVERYTHING ELSE in English");
    expect(helper).toContain("\\`still\\`");
    expect(helper).toContain("\\`lock\\`");
    expect(helper).toContain('if (!code || code === "en") return "";');
  });
});
