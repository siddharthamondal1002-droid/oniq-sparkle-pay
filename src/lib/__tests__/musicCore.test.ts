/**
 * MUSIC — the pure half, and the measured facts pinned so they cannot drift.
 *
 * The model id is asserted here for the same reason llm.ts keeps a measured
 * 404 table: an id in this codebase is a claim about what a key can actually
 * call, and the only thing that established this one was a POST.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MUSIC_AUDIO_MAX_BYTES,
  MUSIC_AUDIO_MIMES,
  MUSIC_IMAGE_MAX_BYTES,
  MUSIC_IMAGE_MIMES,
  MUSIC_MODEL,
  MUSIC_PROMPT_MAX,
  validateMusicAudio,
  validateMusicImage,
  validateMusicPrompt,
} from "../../../supabase/functions/_shared/musicCore";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const FN = read("supabase/functions/music-generate/index.ts");

/** Comments describe code; they are not code. Same rule searchSpendCoverage uses. */
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("the music prompt gate", () => {
  it("refuses an empty prompt with something a person can act on", () => {
    expect(validateMusicPrompt("")).toBe("Describe the music you want.");
  });

  it("accepts an ordinary sentence", () => {
    expect(validateMusicPrompt("calm piano for studying")).toBeNull();
  });

  it("refuses a prompt past the ceiling, and names the ceiling", () => {
    const long = "a".repeat(MUSIC_PROMPT_MAX + 1);
    expect(validateMusicPrompt(long)).toContain(String(MUSIC_PROMPT_MAX));
  });

  it("accepts a prompt exactly at the ceiling", () => {
    expect(validateMusicPrompt("a".repeat(MUSIC_PROMPT_MAX))).toBeNull();
  });
});

describe("the model id is the one that was measured", () => {
  it("is the -preview id, because the unsuffixed one 404s", () => {
    // Measured 2026-09-04: models/lyria-3-pro is "not found for API version
    // v1beta"; lyria-3-pro-preview:generateContent returns 200.
    expect(MUSIC_MODEL).toBe("lyria-3-pro-preview");
  });

  it("is called with generateContent, not predict", () => {
    expect(FN).toMatch(/:generateContent/);
    expect(FN).not.toMatch(/:predict/);
  });

  it("sends Google's native contents shape with an explicit role", () => {
    // The OpenAI field names come back as "Unknown name ...: Cannot find field".
    // The shape moved into the shared caller when image and voice joined this
    // route (owner directive 2026-09-04b), so it is asserted where it lives —
    // together with the fact that this function goes through that caller
    // rather than growing a fifth copy of the same fetch.
    const direct = read("supabase/functions/_shared/googleDirect.ts");
    expect(direct).toMatch(/contents:\s*\[\{\s*role:\s*"user"/);
    expect(FN).toContain("googleGenerateContent");
  });
});

describe("the cost guards are in the order that keeps them honest", () => {
  it("checks the kill switch, the admin gate and BOTH caps before the call", () => {
    // The first provider call of either stage — listening to a reference is
    // billable too, so the gates have to come before THAT, not merely before
    // the song.
    const call = CODE.indexOf("googleGenerateContent(");
    expect(call).toBeGreaterThan(-1);
    for (const gate of [
      "music_enabled",
      "music_admin_only",
      "music_daily_cap",
      "music_per_user_daily_cap",
    ]) {
      const at = CODE.indexOf(gate);
      expect(at, `${gate} is not read at all`).toBeGreaterThan(-1);
      expect(at, `${gate} is read after the billable call`).toBeLessThan(call);
    }
  });

  it("counts the per-user cap against THIS user, not everyone", () => {
    // A per-user cap that forgets to filter by user is just a second house
    // cap, and it would lock everyone out the moment one person hit it.
    const perUser = CODE.slice(CODE.indexOf("music_per_user_daily_cap") - 600);
    expect(perUser).toMatch(/\.eq\("user_id", user\.id\)/);
  });

  it("counts both caps over a rolling 24h, so midnight cannot double them", () => {
    expect(CODE).toMatch(/24 \* 60 \* 60 \* 1000/);
    // One `since`, used by both counts — two different windows would be a bug
    // nobody would see until a bill arrived.
    expect(CODE.match(/const since =/g) ?? []).toHaveLength(1);
    expect(CODE.match(/\.gte\("created_at", since\)/g) ?? []).toHaveLength(2);
  });

  it("has no retry around either billable call", () => {
    // A prompt Google refuses will be refused again identically, and a loop is
    // how a month of credits disappears in an hour. Checked against CODE: the
    // header comment says the word "retry" precisely to explain its absence.
    expect(CODE).not.toMatch(/\bretry\b|\.retries|maxRetries/i);
    // Two provider calls at most — listen, then generate — and no raw fetch
    // of its own now that everything goes through the shared caller.
    expect(CODE).not.toMatch(/await fetch\(/);
    expect(CODE.match(/await googleGenerateContent\(/g) ?? []).toHaveLength(2);
  });

  it("wraps every provider call in its own spend reservation", () => {
    // Two calls, two guards. Folding the listening stage into the song's
    // reservation would mean the ledger recorded a charge it never reserved.
    expect(CODE.match(/await withProviderSpendGuard\(/g) ?? []).toHaveLength(2);
  });

  it("never puts the key's VALUE in a log or a reply", () => {
    // The NAME of a missing variable is operator information; no value ever
    // is — which is why the "not set" log below is allowed to name it.
    const key = CODE.match(/const key = ([A-Za-z.()"'_ ]+);/)?.[1];
    expect(key).toContain("GOOGLE_AI_API_KEY");
    for (const call of CODE.matchAll(/(console\.[a-z]+|json)\(([^;]*)\)/g)) {
      expect(call[2], `${call[1]} must not carry the key`).not.toMatch(/\bkey\b(?!Env)/);
    }
    // It may only ever reach the shared caller, which is the one place that
    // puts it in a URL.
    expect(CODE).not.toMatch(/encodeURIComponent\(key\)/);
    const direct = read("supabase/functions/_shared/googleDirect.ts");
    expect(direct.match(/encodeURIComponent\(opts\.key\)/g) ?? []).toHaveLength(1);
  });
});

/* ------------------------------------------------------- attached references
 * Owner directive 2026-09-04c. A PICTURE goes straight to Lyria (measured
 * 200); a TRACK goes to Gemini and never to Lyria (measured 400 every way).
 * Both are validated before either billable call, so a body a person can fix
 * costs nothing to reject.
 * -------------------------------------------------------------------------- */
const b64 = (n: number) => Buffer.alloc(n, 1).toString("base64");

describe("validateMusicImage", () => {
  it("is optional", () => {
    expect(validateMusicImage(undefined)).toBeNull();
    expect(validateMusicImage(null)).toBeNull();
  });

  it("accepts each mime the picker offers", () => {
    for (const mimeType of MUSIC_IMAGE_MIMES) {
      expect(validateMusicImage({ mimeType, data: b64(64) }), mimeType).toBeNull();
    }
  });

  it("refuses a mime Lyria has not been measured on", () => {
    for (const mimeType of ["image/heic", "image/gif", "audio/wav", ""]) {
      expect(validateMusicImage({ mimeType, data: b64(64) }), mimeType).toBe(
        "Attach a JPG, PNG or WebP picture.",
      );
    }
  });

  it("measures the ceiling on DECODED bytes, not on the base64 string", () => {
    // Base64 is 4/3 of what it carries; a limit read off the string silently
    // admits a third more than it claims to.
    const atLimit = b64(MUSIC_IMAGE_MAX_BYTES);
    expect(validateMusicImage({ mimeType: "image/png", data: atLimit })).toBeNull();
    expect(atLimit.length).toBeGreaterThan(MUSIC_IMAGE_MAX_BYTES);
    expect(
      validateMusicImage({ mimeType: "image/png", data: b64(MUSIC_IMAGE_MAX_BYTES + 1024) }),
    ).toBe("That picture is too large. Under 4MB, please.");
  });
});

describe("validateMusicAudio", () => {
  it("is optional", () => {
    expect(validateMusicAudio(undefined)).toBeNull();
    expect(validateMusicAudio(null)).toBeNull();
  });

  it("accepts what a browser recorder and a file picker actually produce", () => {
    for (const mimeType of MUSIC_AUDIO_MIMES) {
      expect(validateMusicAudio({ mimeType, data: b64(64) }), mimeType).toBeNull();
    }
  });

  it("accepts a MediaRecorder mime with its codecs parameter", () => {
    // MediaRecorder tags its blobs "audio/webm;codecs=opus". Comparing the
    // whole string would reject every recording the app itself made.
    expect(validateMusicAudio({ mimeType: "audio/webm;codecs=opus", data: b64(64) })).toBeNull();
    expect(validateMusicAudio({ mimeType: "AUDIO/WAV", data: b64(64) })).toBeNull();
  });

  it("refuses a picture sent down the audio slot, and says what to attach", () => {
    for (const mimeType of ["image/png", "video/mp4", "application/pdf", ""]) {
      expect(validateMusicAudio({ mimeType, data: b64(64) }), mimeType).toBe(
        "Attach an audio file — WAV, MP3, M4A, OGG or WebM.",
      );
    }
  });

  it("measures its own ceiling on decoded bytes too", () => {
    expect(
      validateMusicAudio({ mimeType: "audio/mpeg", data: b64(MUSIC_AUDIO_MAX_BYTES) }),
    ).toBeNull();
    expect(
      validateMusicAudio({ mimeType: "audio/mpeg", data: b64(MUSIC_AUDIO_MAX_BYTES + 1024) }),
    ).toBe("That track is too long. Under 8MB, please.");
  });
});

describe("both validators, on the shapes a client actually gets wrong", () => {
  for (const [name, validate] of [
    ["image", validateMusicImage],
    ["audio", validateMusicAudio],
  ] as const) {
    it(`refuses a data: URL on the ${name} slot`, () => {
      // It produces an opaque 400 from Google, so it is caught here with a
      // sentence instead.
      const mimeType = name === "image" ? "image/png" : "audio/wav";
      expect(validate({ mimeType, data: `data:${mimeType};base64,AAAA` })).toBe(
        "That attachment could not be read.",
      );
    });

    it(`refuses anything that is not base64 on the ${name} slot`, () => {
      const mimeType = name === "image" ? "image/png" : "audio/wav";
      for (const data of ["not base64!", "AA AA", "AAAA\n", "%%%%"]) {
        expect(validate({ mimeType, data }), data).toBe("That attachment could not be read.");
      }
    });

    it(`refuses an empty ${name} rather than sending an empty part`, () => {
      const mimeType = name === "image" ? "image/png" : "audio/wav";
      expect(validate({ mimeType, data: "" })).toBe("That attachment was empty.");
    });

    it(`refuses a malformed ${name} object without throwing`, () => {
      for (const bad of [42, "nope", [], {}, { mimeType: "image/png" }, { data: "AAAA" }]) {
        expect(() => validate(bad)).not.toThrow();
        expect(validate(bad), JSON.stringify(bad)).toBeTruthy();
      }
    });
  }
});
