/**
 * Voice replication, the safety-critical half.
 *
 * The consent recording is what stops this being a tool for cloning somebody
 * who never agreed, and Google matches it WORD FOR WORD — so the scripts are
 * data that must be exactly right, and the script-mixing check below is not
 * pedantry. Five phrases in the source ONIQ transcribed from carried
 * characters from the wrong writing system, which would have failed
 * validation forever, in a way no user could diagnose.
 */
import { describe, expect, it } from "vitest";
import {
  CONSENT_SCRIPTS,
  CONSENT_SCRIPTS_WITHHELD,
  KEY_TTL_DAYS,
  REPLICATION_MODEL,
  REQUIRED_SAMPLE_RATE,
  VERTEX_HOST,
  SOURCE_MAX_SECONDS,
  SOURCE_MIN_SECONDS,
  consentScript,
  keyExpired,
  readReplicationKey,
  readWavFacts,
  replicatedSpeechBody,
  replicatedSynthesisUrl,
  replicationKeyBody,
  validateReplicationAudio,
  voicesUrl,
} from "../../../supabase/functions/_shared/voiceReplication.ts";

/** A real WAV header plus `seconds` of silence, at the given format. */
function wav(
  opts: {
    seconds?: number;
    sampleRate?: number;
    channels?: number;
    bits?: number;
    format?: number;
    extraChunk?: boolean;
  } = {},
): Uint8Array {
  const rate = opts.sampleRate ?? 24000;
  const ch = opts.channels ?? 1;
  const bits = opts.bits ?? 16;
  const secs = opts.seconds ?? 15;
  const dataLen = Math.round(secs * rate * ch * (bits / 8));
  // Optionally put a LIST chunk before `fmt `, which is what a phone or
  // ffmpeg often writes — the reader must walk chunks, not assume offset 12.
  const extra = opts.extraChunk ? 8 + 4 : 0;
  const buf = new Uint8Array(12 + extra + 24 + 8 + dataLen);
  const w4 = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) buf[o + i] = s.charCodeAt(i);
  };
  const w32 = (o: number, v: number) => {
    buf[o] = v & 255;
    buf[o + 1] = (v >> 8) & 255;
    buf[o + 2] = (v >> 16) & 255;
    buf[o + 3] = (v >> 24) & 255;
  };
  const w16 = (o: number, v: number) => {
    buf[o] = v & 255;
    buf[o + 1] = (v >> 8) & 255;
  };
  w4(0, "RIFF");
  w32(4, buf.length - 8);
  w4(8, "WAVE");
  let p = 12;
  if (opts.extraChunk) {
    w4(p, "LIST");
    w32(p + 4, 4);
    p += 12;
  }
  w4(p, "fmt ");
  w32(p + 4, 16);
  w16(p + 8, opts.format ?? 1);
  w16(p + 10, ch);
  w32(p + 12, rate);
  w32(p + 16, rate * ch * (bits / 8));
  w16(p + 20, ch * (bits / 8));
  w16(p + 22, bits);
  p += 24;
  w4(p, "data");
  w32(p + 4, dataLen);
  return buf;
}

describe("the consent scripts", () => {
  /**
   * Which Unicode block each language's sentence must be written in.
   *
   * Explicit \u escapes, never pasted range literals: the first draft of this
   * map had a literal NUL as one range's start bound, which testIsolation
   * catches as a binary file — and a bound nobody can see is a bound nobody
   * can check.
   */
  const EXPECTED: Record<string, RegExp> = {
    en: /^[\u0020-\u024f\s.,'"-]+$/,
    hi: /[\u0900-\u097f]/,
    mr: /[\u0900-\u097f]/,
    bn: /[\u0980-\u09ff]/,
    ta: /[\u0b80-\u0bff]/,
    te: /[\u0c00-\u0c7f]/,
    gu: /[\u0a80-\u0aff]/,
    kn: /[\u0c80-\u0cff]/,
    ml: /[\u0d00-\u0d7f]/,
    ur: /[\u0600-\u06ff]/,
    si: /[\u0d80-\u0dff]/,
  };

  it("carries no character from the wrong writing system", () => {
    // THE CHECK THAT CAUGHT IT. Five phrases in the source had Cyrillic
    // inside Amharic and Swahili, Georgian and Telugu inside Armenian,
    // Bengali inside Odia, Sinhala inside Punjabi. Google matches word for
    // word, so each would have failed for ever, silently.
    //
    // Allowed everywhere: Latin (the phrases say "Google Cloud" untranslated),
    // punctuation, whitespace, and the per-language script itself.
    // Explicit escapes: the pasted character ranges carried invisible
    // control and zero-width characters, which testIsolation flags as a
    // binary file and which nobody can review by eye.
    const ALLOWED_EXTRA = /[\u0020-\u007e\u00a0-\u024f\u2010-\u2027\s]/;
    const BLOCKS: [RegExp, string][] = [
      [/[\u0400-\u04ff]/, "Cyrillic"],
      [/[\u10a0-\u10ff]/, "Georgian"],
      [/[\u1200-\u137f]/, "Ethiopic"],
      [/[\u0530-\u058f]/, "Armenian"],
    ];
    for (const [lang, text] of Object.entries(CONSENT_SCRIPTS)) {
      const own = EXPECTED[lang];
      expect(own, `${lang} has no expected-script rule`).toBeTruthy();
      for (const [block, name] of BLOCKS) {
        expect(block.test(text), `${lang} contains ${name} characters`).toBe(false);
      }
      // And it must actually be in its own script, not silently English.
      if (lang !== "en") {
        expect(own.test(text), `${lang} is not written in its own script`).toBe(true);
      }
      expect(ALLOWED_EXTRA.test(text)).toBe(true);
    }
  });

  it("withholds exactly the five that were corrupt, and does not carry them", () => {
    expect([...CONSENT_SCRIPTS_WITHHELD].sort()).toEqual(["am", "hy", "or", "pa", "sw"]);
    for (const lang of CONSENT_SCRIPTS_WITHHELD) {
      expect(CONSENT_SCRIPTS[lang], `${lang} must not be offered`).toBeUndefined();
    }
  });

  it("says the same thing in every language it does offer", () => {
    // Each is a consent statement naming Google Cloud. Not a proof of
    // translation, but it catches a phrase pasted into the wrong row.
    for (const [lang, text] of Object.entries(CONSENT_SCRIPTS)) {
      expect(text.length, `${lang} is too short to be the consent sentence`).toBeGreaterThan(60);
      expect(text, `${lang} does not mention Google`).toMatch(
        /Google|गूगल|গুগল|கூகிள்|గూగుల్|ગૂગલ|گوگل/,
      );
    }
  });

  it("resolves a language tag down to its base", () => {
    expect(consentScript("en-US")).toBe(CONSENT_SCRIPTS.en);
    expect(consentScript("HI")).toBe(CONSENT_SCRIPTS.hi);
    expect(consentScript("")).toBeNull();
    expect(consentScript("xx")).toBeNull();
    // A withheld language returns null rather than an English fallback — an
    // English sentence read by a Punjabi speaker would fail validation too,
    // and would look like their fault.
    expect(consentScript("pa")).toBeNull();
  });
});

describe("readWavFacts", () => {
  it("reads a canonical file", () => {
    const f = readWavFacts(wav({ seconds: 15 }))!;
    expect(f).toMatchObject({ sampleRate: 24000, channels: 1, bitsPerSample: 16, format: 1 });
    expect(f.seconds).toBeCloseTo(15, 1);
  });

  it("walks past a LIST chunk instead of assuming fmt is at byte 12", () => {
    // ffmpeg and phone recorders write one. A reader that assumes the
    // canonical layout reports nonsense for a perfectly valid file.
    const f = readWavFacts(wav({ seconds: 12, extraChunk: true }))!;
    expect(f.sampleRate).toBe(24000);
    expect(f.seconds).toBeCloseTo(12, 1);
  });

  it("returns null for anything that is not a WAV", () => {
    expect(readWavFacts(new Uint8Array(0))).toBeNull();
    expect(readWavFacts(new Uint8Array([1, 2, 3]))).toBeNull();
    // An MP3 frame header, which a file picker will happily hand over.
    expect(
      readWavFacts(new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0])),
    ).toBeNull();
  });

  it("refuses big-endian RIFX rather than misreading it", () => {
    const b = wav();
    b[0] = "R".charCodeAt(0);
    b[1] = "I".charCodeAt(0);
    b[2] = "F".charCodeAt(0);
    b[3] = "X".charCodeAt(0);
    expect(readWavFacts(b)).toBeNull();
  });
});

describe("validateReplicationAudio", () => {
  it("accepts a correct 15-second sample", () => {
    expect(validateReplicationAudio(wav({ seconds: 15 }), "source")).toBeNull();
  });

  it("names the fix for every format fault", () => {
    expect(validateReplicationAudio(wav({ sampleRate: 44100 }), "source")).toBe("Record at 24kHz.");
    expect(validateReplicationAudio(wav({ channels: 2 }), "source")).toBe(
      "Record in mono, not stereo.",
    );
    expect(validateReplicationAudio(wav({ bits: 8 }), "source")).toBe("Record in 16-bit WAV.");
    expect(validateReplicationAudio(wav({ format: 3 }), "source")).toBe(
      "Record as uncompressed WAV (LINEAR16).",
    );
    expect(validateReplicationAudio(new Uint8Array([1, 2]), "source")).toBe(
      "That file isn't a WAV recording.",
    );
  });

  it("enforces 10-30 seconds on the SAMPLE, at both ends", () => {
    expect(validateReplicationAudio(wav({ seconds: 9 }), "source")).toBe(
      `Speak for at least ${SOURCE_MIN_SECONDS} seconds.`,
    );
    expect(validateReplicationAudio(wav({ seconds: 31 }), "source")).toBe(
      `Keep it under ${SOURCE_MAX_SECONDS} seconds.`,
    );
    expect(validateReplicationAudio(wav({ seconds: 10 }), "source")).toBeNull();
    expect(validateReplicationAudio(wav({ seconds: 30 }), "source")).toBeNull();
  });

  it("does not impose the sample's length rule on the CONSENT recording", () => {
    // The consent clip is however long the sentence takes to read. A 5-second
    // reading is fine and a 40-second one is fine.
    expect(validateReplicationAudio(wav({ seconds: 5 }), "consent")).toBeNull();
    expect(validateReplicationAudio(wav({ seconds: 40 }), "consent")).toBeNull();
    expect(validateReplicationAudio(wav({ seconds: 0 }), "consent")).toBe(
      "That recording is empty.",
    );
  });
});

describe("the Vertex request shapes", () => {
  it("targets Vertex, not the Gemini API host", () => {
    // The whole reason the first probe found nothing.
    //
    // Asserted against the EXPORTED constant rather than a literal hostname:
    // testIsolation.test.ts forbids a test file naming a provider endpoint,
    // so no test is ever one edit away from spending money. Reading the
    // constant is the better assertion anyway — one source of truth.
    expect(voicesUrl("p").startsWith(VERTEX_HOST)).toBe(true);
    expect(VERTEX_HOST).toContain("aiplatform");
    expect(VERTEX_HOST).not.toContain("generativelanguage");
    expect(voicesUrl("my-proj")).toBe(`${VERTEX_HOST}/projects/my-proj/locations/global/voices`);
    expect(replicatedSynthesisUrl("p")).toContain(
      `/publishers/google/models/${REPLICATION_MODEL}:generateContent`,
    );
  });

  it("url-encodes the project id", () => {
    expect(voicesUrl("a/b")).toContain("projects/a%2Fb/");
  });

  it("mints statelessly, so Google keeps no voice profile", () => {
    const b = replicationKeyBody(
      { mimeType: "audio/wav", data: "SRC" },
      { mimeType: "audio/wav", data: "CONSENT" },
    );
    expect(b.store).toBe(false);
    const v = b.voice as Record<string, unknown>;
    expect(v.type).toBe("REPLICATED");
    expect(v.model).toBe(`models/${REPLICATION_MODEL}`);
    const r = v.replicated as Record<string, Record<string, string>>;
    expect(r.source_audio.data).toBe("SRC");
    expect(r.consent_audio.data).toBe("CONSENT");
  });

  it("uses snake_case, which the Vertex surface requires", () => {
    // The Gemini API takes camelCase; this one does not, and a body in the
    // wrong style is rejected field by field.
    const json = JSON.stringify(
      replicationKeyBody({ mimeType: "a", data: "b" }, { mimeType: "c", data: "d" }),
    );
    expect(json).toContain("source_audio");
    expect(json).toContain("mime_type");
    expect(json).not.toContain("sourceAudio");
    expect(json).not.toContain("mimeType");
  });

  it("puts the key in voice_config.voice as a plain string", () => {
    // NOT prebuiltVoiceConfig, and NOT customVoiceConfig — that was the wrong
    // guess, probed on the wrong host.
    const b = replicatedSpeechBody("hello", "KEY123", "en-US") as Record<string, any>;
    expect(b.generation_config.speech_config.voice_config.voice).toBe("KEY123");
    expect(b.generation_config.speech_config.language_code).toBe("en-US");
    expect(b.generation_config.response_modalities).toEqual(["AUDIO"]);
    expect(JSON.stringify(b)).not.toContain("prebuiltVoiceConfig");
    expect(JSON.stringify(b)).not.toContain("customVoiceConfig");
  });
});

describe("the key and its seven days", () => {
  it("reads the key and an explicit expiry", () => {
    expect(readReplicationKey({ key: "K", expireTime: "2026-09-11T00:00:00Z" })).toEqual({
      key: "K",
      expiresAt: "2026-09-11T00:00:00Z",
    });
    // The docs show snake_case; some surfaces answer camelCase. Read both
    // rather than losing the expiry to a naming style.
    expect(readReplicationKey({ key: "K", expire_time: "2026-09-11T00:00:00Z" })?.expiresAt).toBe(
      "2026-09-11T00:00:00Z",
    );
  });

  it("accepts a unix timestamp, which the docs describe", () => {
    const at = readReplicationKey({ key: "K", expire_time: 1788_000_000 })?.expiresAt;
    expect(at).toBe(new Date(1788_000_000 * 1000).toISOString());
  });

  it("assumes seven days when Google sends no expiry", () => {
    const at = readReplicationKey({ key: "K" })!.expiresAt;
    const days = (Date.parse(at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(KEY_TTL_DAYS - 0.1);
    expect(days).toBeLessThan(KEY_TTL_DAYS + 0.1);
  });

  it("returns null when there is no key", () => {
    for (const d of [null, {}, { key: "" }, { key: 7 }, "nope"]) {
      expect(readReplicationKey(d), JSON.stringify(d)).toBeNull();
    }
  });

  it("treats an expired, unparseable or nearly-expired key as expired", () => {
    const now = Date.parse("2026-09-04T12:00:00Z");
    expect(keyExpired("2026-09-03T12:00:00Z", now)).toBe(true);
    expect(keyExpired("not a date", now)).toBe(true);
    // A minute of slack: a key that dies mid-request fails with an error the
    // person cannot act on, and re-minting is cheap next to that.
    expect(keyExpired("2026-09-04T12:00:30Z", now)).toBe(true);
    expect(keyExpired("2026-09-04T12:05:00Z", now)).toBe(false);
  });
});

describe("the sample rate is the one Google asks for", () => {
  it("is 24kHz", () => {
    expect(REQUIRED_SAMPLE_RATE).toBe(24000);
  });
});
