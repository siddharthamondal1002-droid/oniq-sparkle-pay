/**
 * The model registry, and the alarm on it.
 *
 * THE PROBLEM THIS SOLVES. Google publishes shutdown dates for model ids and
 * then switches them off. Nothing in this repo read those dates, so
 * story-clip's fallback (`veo-3.0-fast-generate-001`) went dead on 2026-06-30
 * and the code kept retrying against it for six weeks — a wasted round-trip
 * that ends in the same 502 as no fallback at all. Nobody noticed because a
 * fallback only runs when the primary is already failing, which is exactly
 * when nobody is reading logs carefully.
 *
 * So the date is data now, and this file is the alarm. A model past its
 * recorded shutdown date FAILS THE BUILD. That is deliberately loud: the fix
 * is usually a paid-tier decision somebody has to make, and the alternative —
 * a warning in a log — is what got us here.
 *
 * WHY A PARSER AND NOT AN IMPORT. The registry is Deno source under
 * supabase/functions, outside this Vite project's module graph. The repo
 * already solves this the same way for the pricing mirror (storyPricing) and
 * the verbatim-narration pins: read the file, parse what matters. It also
 * means the test is checking the file that actually ships rather than a copy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const REGISTRY_PATH = "supabase/functions/_shared/modelRegistry.ts";
const SRC = readFileSync(join(ROOT, REGISTRY_PATH), "utf8");

type Entry = {
  name: string;
  id: string;
  provider: string;
  keyEnv: string;
  status: string;
  shutdownOn: string | null;
};

/** Pull each `export const NAME: ModelEntry = { ... }` block apart. */
function parseRegistry(src: string): Entry[] {
  const out: Entry[] = [];
  const re = /export const ([A-Z_]+): ModelEntry = \{([\s\S]*?)\n\};/g;
  for (const m of src.matchAll(re)) {
    const [, name, block] = m;
    const field = (k: string) => block.match(new RegExp(`${k}:\\s*"([^"]*)"`))?.[1] ?? null;
    const id = field("id");
    const provider = field("provider");
    const keyEnv = field("keyEnv");
    const status = field("status");
    if (!id || !provider || !keyEnv || !status) continue;
    const shutdownRaw = block.match(/shutdownOn:\s*(null|"[\d-]+")/)?.[1] ?? "null";
    out.push({
      name,
      id,
      provider,
      keyEnv,
      status,
      shutdownOn: shutdownRaw === "null" ? null : shutdownRaw.replace(/"/g, ""),
    });
  }
  return out;
}

const ENTRIES = parseRegistry(SRC);

describe("the registry parses and is complete", () => {
  it("finds every declared model", () => {
    // Seven when this landed: 3 text, 1 image, 1 voice, 2 video.
    expect(ENTRIES.length).toBeGreaterThanOrEqual(7);
    expect(SRC).toMatch(/export const MODEL_REGISTRY: ModelEntry\[\]/);
  });

  it("records a provider and a key ENV NAME for every model", () => {
    for (const e of ENTRIES) {
      expect(["anthropic", "google-direct", "lovable-gateway"], `${e.name}`).toContain(e.provider);
      expect(e.keyEnv, `${e.name} has no key env`).toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it("holds no secret, only the names of the variables that do", () => {
    // A registry is exactly the kind of file a key gets pasted into.
    expect(SRC).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(SRC).not.toMatch(/AIza[0-9A-Za-z_-]{10}/);
  });
});

describe("no model is used past the date Google switches it off", () => {
  const today = new Date().toISOString().slice(0, 10);

  // Reported one entry at a time so the failure names the model rather than
  // just saying "a model is dead".
  for (const e of ENTRIES) {
    it(`${e.name} (${e.id})`, () => {
      if (!e.shutdownOn) return; // no published date; nothing to assert
      const dead = e.shutdownOn <= today;
      if (!dead) return;
      // Past its shutdown date. The ONLY acceptable state is that the code no
      // longer sends it — which means status must say so AND no caller may
      // reference the id.
      expect(
        e.status,
        `${e.id} was shut down on ${e.shutdownOn} and is still marked "${e.status}"`,
      ).toBe("shutdown");
      // And it must not still be wired into a live request path. This is the
      // assertion that will fail today, on purpose: story-clip still retries
      // against veo-3.0-fast-generate-001. Fixing it is a paid-tier choice.
      const clip = readFileSync(join(ROOT, "supabase/functions/story-clip/index.ts"), "utf8");
      const stillWired = new RegExp(`CLIP_MODEL_FALLBACK\\s*=\\s*"${e.id}"`).test(clip);
      expect(
        stillWired,
        `${e.id} is dead (shutdown ${e.shutdownOn}) but story-clip still retries against it. ` +
          `Replacing it changes the per-second price, so it needs an owner decision — ` +
          `see ENGINE_AUDIT.md, "Decisions the owner has to make".`,
      ).toBe(false);
    });
  }
});

describe("the registry matches what the code actually sends", () => {
  // A registry that has drifted from the call sites is worse than none: it
  // reads as authoritative and is not. Each id is checked against its caller.
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

  it("story-clip's primary id", () => {
    const clip = read("supabase/functions/story-clip/index.ts");
    const inCode = clip.match(/const CLIP_MODEL = "([^"]+)"/)?.[1];
    const inRegistry = ENTRIES.find((e) => e.name === "VIDEO_CLIP")?.id;
    expect(inCode, "story-clip lost CLIP_MODEL").toBeTruthy();
    expect(inCode).toBe(inRegistry);
  });

  it("story-still's image id", () => {
    const still = read("supabase/functions/story-still/index.ts");
    const inCode = still.match(/const IMAGE_MODEL = "([^"]+)"/)?.[1];
    expect(inCode).toBe(ENTRIES.find((e) => e.name === "IMAGE_STILL")?.id);
  });

  it("story-voice's tts id", () => {
    const voice = read("supabase/functions/story-voice/index.ts");
    const inCode = voice.match(/const TTS_MODEL = "([^"]+)"/)?.[1];
    expect(inCode).toBe(ENTRIES.find((e) => e.name === "VOICE_TTS")?.id);
  });

  it("the shared text fallback id", () => {
    const llm = read("supabase/functions/_shared/llm.ts");
    const inCode = llm.match(/const GEMINI_FALLBACK_MODEL = "([^"]+)"/)?.[1];
    expect(inCode).toBe(ENTRIES.find((e) => e.name === "TEXT_FALLBACK")?.id);
  });
});

describe("the provider split the owner chose is not quietly moved", () => {
  // CLAUDE.md, 2026-08-14: the Story pipeline was routed onto the metered
  // Google key by an agent's engineering call, presented as a code comment
  // instead of a question. The split below is the owner's answer. It is
  // pinned here so the next well-meant consolidation has to argue with a
  // failing test rather than a comment nobody reads.
  const by = (n: string) => ENTRIES.find((e) => e.name === n);

  it("stills and voice spend LOVABLE credits", () => {
    expect(by("IMAGE_STILL")?.provider).toBe("lovable-gateway");
    expect(by("IMAGE_STILL")?.keyEnv).toBe("LOVABLE_API_KEY");
    expect(by("VOICE_TTS")?.provider).toBe("lovable-gateway");
    expect(by("VOICE_TTS")?.keyEnv).toBe("LOVABLE_API_KEY");
  });

  it("clips spend the METERED Google key, and only clips", () => {
    expect(by("VIDEO_CLIP")?.provider).toBe("google-direct");
    expect(by("VIDEO_CLIP")?.keyEnv).toBe("GOOGLE_AI_API_KEY");
  });

  it("text is Claude-first with a Gemini fallback, not Google-only", () => {
    expect(by("TEXT_PRIMARY")?.provider).toBe("anthropic");
    expect(by("TEXT_FALLBACK")?.provider).toBe("google-direct");
  });
});

describe("version stamping exists to be recorded on assets", () => {
  it("declares engine, schema and prompt versions", () => {
    for (const v of ["ENGINE_VERSION", "SCHEMA_VERSION", "PROMPT_VERSION"]) {
      expect(SRC, `${v} missing`).toMatch(new RegExp(`export const ${v} = "\\d+\\.\\d+\\.\\d+"`));
    }
  });

  it("exposes a provenance block for assets to carry", () => {
    expect(SRC).toMatch(/export function provenance\(/);
    expect(SRC).toMatch(/model_id:/);
    expect(SRC).toMatch(/model_provider:/);
  });
});
