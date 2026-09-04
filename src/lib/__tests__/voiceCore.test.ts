/**
 * VOICE — the pure half, and the measured facts pinned so they cannot drift.
 *
 * The model id and every voice name are asserted here for the same reason
 * llm.ts keeps a measured 404 table: a name in this codebase is a claim about
 * what a key can actually call, and the only thing that established these was
 * a POST.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE,
  needsWavHeader,
  rateOf,
  resolveVoice,
  validateVoiceText,
  VOICE_CHOICES,
  VOICE_MODEL,
  VOICE_TEXT_MAX,
  wrapPcmAsWav,
} from "../../../supabase/functions/_shared/voiceCore";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const FN = read("supabase/functions/voice-generate/index.ts");
const STORY_VOICE = read("supabase/functions/story-voice/index.ts");
const SHARED = read("supabase/functions/_shared/gatewayVoice.ts");

/** Comments describe code; they are not code. Same rule searchSpendCoverage uses. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const CODE = strip(FN);

describe("the voice text gate", () => {
  it("refuses empty text with something a person can act on", () => {
    expect(validateVoiceText("")).toBe("Type something to say.");
  });

  it("accepts an ordinary line", () => {
    expect(validateVoiceText("Good morning.")).toBeNull();
  });

  it("refuses text past the ceiling, and names the ceiling", () => {
    expect(validateVoiceText("a".repeat(VOICE_TEXT_MAX + 1))).toContain(String(VOICE_TEXT_MAX));
  });

  it("accepts text exactly at the ceiling", () => {
    expect(validateVoiceText("a".repeat(VOICE_TEXT_MAX))).toBeNull();
  });

  it("holds a ceiling below story-voice's, because a person types this one", () => {
    // story-voice's 1200 bounds a line ONIQ's own planner wrote. A box a
    // person types into is the only lever bounding a single TTS charge.
    expect(VOICE_TEXT_MAX).toBeLessThan(1200);
  });
});

describe("every voice offered was POST-verified", () => {
  it("is the eight that answered 200 with audio on 2026-09-04", () => {
    expect([...VOICE_CHOICES]).toEqual([
      "Charon",
      "Kore",
      "Puck",
      "Zephyr",
      "Aoede",
      "Fenrir",
      "Leda",
      "Orus",
    ]);
  });

  it("defaults to the one with production history", () => {
    // Charon has been story-voice's narrator since the pipeline had a voice.
    expect(DEFAULT_VOICE).toBe("Charon");
    expect(STORY_VOICE).toContain('DEFAULT_VOICE = "Charon"');
  });

  it("falls back rather than putting an unverified name on the wire", () => {
    expect(resolveVoice("Nobody")).toBe(DEFAULT_VOICE);
    expect(resolveVoice(undefined)).toBe(DEFAULT_VOICE);
    expect(resolveVoice({ nope: 1 })).toBe(DEFAULT_VOICE);
    expect(resolveVoice("Kore")).toBe("Kore");
  });

  it("offers the same names on the screen as on the wire", () => {
    // The screen mirrors the list rather than importing it (a route may not
    // reach into supabase/functions), so the two are checked against
    // each other instead of trusted to stay in step.
    const screen = read("src/routes/_authenticated/app.voice.tsx");
    const listed = screen.match(/const VOICES = \[([^\]]*)\]/)?.[1] ?? "";
    const names = [...listed.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([...VOICE_CHOICES]);
  });
});

describe("the audio comes back playable, or not at all", () => {
  it("wraps headerless PCM and leaves a container alone", () => {
    expect(needsWavHeader("audio/L16;codec=pcm;rate=24000")).toBe(true);
    // The bug worth catching: double-wrapping leaves a valid outer header, so
    // the file opens and the only symptom is a click at the top of every clip.
    expect(needsWavHeader("audio/wav")).toBe(false);
    expect(needsWavHeader("audio/mpeg")).toBe(false);
  });

  it("never guesses a sample rate", () => {
    // Guessing produces audio at the wrong speed, which reads as a strange
    // voice rather than as a bug.
    expect(rateOf("audio/L16;codec=pcm;rate=24000")).toBe(24000);
    expect(rateOf("audio/L16;codec=pcm")).toBeNull();
    expect(rateOf("")).toBeNull();
  });

  it("writes a RIFF/WAVE header that describes the samples it carries", () => {
    const pcm = new Uint8Array(8).fill(7);
    const out = wrapPcmAsWav(pcm, 24000);
    const ascii = (from: number, len: number) =>
      String.fromCharCode(...out.subarray(from, from + len));
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(out.length).toBe(44 + pcm.length);
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint32(4, true)).toBe(36 + pcm.length);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(28, true)).toBe(48000); // byte rate = rate * 2
    expect(view.getUint32(40, true)).toBe(pcm.length);
    expect([...out.subarray(44)]).toEqual([...pcm]);
  });

  it("refuses the clip rather than storing PCM a browser cannot play", () => {
    expect(CODE).toMatch(/no sample rate in/);
  });
});

describe("story-voice's own copy has not drifted from the shared one", () => {
  /**
   * story-voice keeps local constants deliberately — see gatewayVoice.ts. The
   * cost of that choice is exactly this risk, so it is paid here: if either
   * side of the pair moves, this fails.
   */
  it("names the same model id", () => {
    expect(VOICE_MODEL).toBe("google/gemini-3.1-flash-tts-preview");
    expect(STORY_VOICE).toContain(`TTS_MODEL = "${VOICE_MODEL}"`);
    expect(SHARED).toContain(`GATEWAY_VOICE_MODEL = "${VOICE_MODEL}"`);
  });

  it("posts to the same endpoint", () => {
    expect(SHARED).toContain('"https://ai.gateway.lovable.dev/v1/audio/speech"');
    expect(STORY_VOICE).toContain('"https://ai.gateway.lovable.dev/v1/audio/speech"');
  });

  it("sends the same native body shape, not the OpenAI one", () => {
    // Measured from a live 400: for google/*-tts the gateway passes Google's
    // own body through, and rejected the OpenAI input/voice fields.
    for (const src of [SHARED, STORY_VOICE]) {
      expect(src).toMatch(/responseModalities:\s*\["AUDIO"\]/);
      expect(src).toMatch(/prebuiltVoiceConfig:\s*\{\s*voiceName/);
    }
  });
});

describe("the cost guards are in the order that keeps them honest", () => {
  it("checks the kill switch, the admin gate and BOTH caps before the call", () => {
    const call = CODE.indexOf("await fetch(VOICE_URL");
    expect(call).toBeGreaterThan(-1);
    for (const gate of [
      "voice_enabled",
      "voice_admin_only",
      "voice_daily_cap",
      "voice_per_user_daily_cap",
    ]) {
      const at = CODE.indexOf(gate);
      expect(at, `${gate} is not read at all`).toBeGreaterThan(-1);
      expect(at, `${gate} is read after the billable call`).toBeLessThan(call);
    }
  });

  it("counts the per-user cap against THIS user, not everyone", () => {
    const perUser = CODE.slice(CODE.indexOf("voice_per_user_daily_cap") - 600);
    expect(perUser).toMatch(/\.eq\("user_id", user\.id\)/);
  });

  it("counts both caps over a rolling 24h, so midnight cannot double them", () => {
    expect(CODE).toMatch(/24 \* 60 \* 60 \* 1000/);
    expect(CODE.match(/const since =/g) ?? []).toHaveLength(1);
    expect(CODE.match(/\.gte\("created_at", since\)/g) ?? []).toHaveLength(2);
  });

  it("has no retry around the billable call", () => {
    expect(CODE).not.toMatch(/\bretry\b|\.retries|maxRetries/i);
    expect(CODE.match(/await fetch\(/g) ?? []).toHaveLength(1);
  });

  it("goes to the gateway, on gateway credits", () => {
    expect(CODE).toMatch(/GATEWAY_VOICE_URL/);
    expect(CODE).toMatch(/LOVABLE_API_KEY/);
    expect(CODE, "voice must not touch the metered key").not.toMatch(/GOOGLE_AI_API_KEY/);
  });

  it("never puts the key's VALUE in a log or a reply", () => {
    // The NAME of a missing variable is operator information; no value ever
    // is — which is why the "not set" log is allowed to name it.
    const key = CODE.match(/const key = ([A-Za-z.()"'_ ]+);/)?.[1];
    expect(key).toContain("LOVABLE_API_KEY");
    for (const call of CODE.matchAll(/(console\.[a-z]+|json)\(([^;]*)\)/g)) {
      expect(call[2], `${call[1]} must not carry the key`).not.toMatch(/\bkey\b(?!Env)/);
    }
    expect(CODE.match(/Bearer \$\{key\}/g) ?? []).toHaveLength(1);
  });

  it("records every failed attempt rather than discarding it", () => {
    // One `fail` helper, so no branch can return without writing the row.
    expect(CODE).toMatch(/status: "failed"/);
    expect(CODE.match(/await fail\(/g) ?? []).not.toHaveLength(0);
  });
});
