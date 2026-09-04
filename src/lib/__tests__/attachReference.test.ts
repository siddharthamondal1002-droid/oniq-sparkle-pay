/**
 * ATTACHING A REFERENCE — what may be offered, and what may not.
 *
 * The owner's reference draws an attach control on Image, Music AND Voice.
 * All three are now built, and each goes somewhere different, which was
 * measured rather than assumed — 2026-09-04, against the real endpoints:
 *
 *   Image  gemini-3.1-flash-image        + inlineData jpeg  -> 200, edited picture
 *   Music  lyria-3-pro-preview           + inlineData png   -> 200, 5.2 MB track
 *          lyria-3-pro-preview           + inlineData wav   -> 400 unsupported
 *          (same prompt, no attachment, control)            -> 200, 5.5 MB track
 *   Voice  gemini-3.1-flash-tts-preview  + inlineData wav   -> 400 not enabled
 *          gemini-3.1-flash-lite         + inlineData wav   -> 200, a transcript
 *
 * TWO OF THOSE 400s ARE STILL LOAD-BEARING, and the features that sit on top
 * of them route AROUND the closed door rather than through it: a reference
 * TRACK goes to a listening model and never to Lyria (musicBrief.ts), and
 * attached voice audio goes to an ordinary text model and never to the TTS
 * one. These tests exist so a later pass cannot quietly wire either
 * attachment straight into the model that refuses it. A control that 400s
 * every generation it touches is worse than an absent one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REFERENCE_MAX_BYTES,
  REFERENCE_MIMES,
  validateReferenceImage,
} from "../../../supabase/functions/_shared/imageCore.ts";
import {
  MUSIC_ACCEPTS_AUDIO_REFERENCE,
  MUSIC_ACCEPTS_IMAGE_REFERENCE,
  MUSIC_CLIP_MODEL,
  MUSIC_MODEL,
} from "../../../supabase/functions/_shared/musicCore.ts";
import {
  TRANSCRIBE_MAX_BYTES,
  validateAudioAttachment,
  VOICE_TTS_ACCEPTS_AUDIO_INPUT,
} from "../../../supabase/functions/_shared/voiceCore.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** `n` decoded bytes as valid base64, for the size boundary tests. */
function b64OfBytes(n: number): string {
  return Buffer.alloc(n, 1).toString("base64");
}

describe("what the three engines actually accept", () => {
  it("records Music as refusing an audio reference, and TTS as not listening", () => {
    expect(MUSIC_ACCEPTS_AUDIO_REFERENCE).toBe(false);
    // The TTS model specifically. NOT "Gemini cannot hear" — the first probe
    // drew that conclusion from this one 400 and it was wrong; ordinary
    // Gemini transcribes audio fine, which is what the transcribe path uses.
    expect(VOICE_TTS_ACCEPTS_AUDIO_INPUT).toBe(false);
  });

  it("keeps the correction visible, so the wrong conclusion is not redrawn", () => {
    const voice = read("supabase/functions/_shared/voiceCore.ts");
    expect(voice, "the measured 200s that disproved it").toContain("gemini-3.1-flash-lite   200");
    expect(voice, "customVoiceConfig is gated, not absent").toContain("customVoiceSample");
  });

  it("keeps the measured evidence next to each flag", () => {
    // The flag alone would be re-litigated in a month. The 400 text and the
    // control call are what stop that.
    const music = read("supabase/functions/_shared/musicCore.ts");
    expect(music).toContain("Unsupported input mime type for this model");
    expect(music, "the no-attachment control is the proof it is the reference").toContain(
      "5,578,562",
    );
    const voice = read("supabase/functions/_shared/voiceCore.ts");
    expect(voice).toContain("Audio input modality is not enabled for this model");
  });

  it("ships both controls on Music, and sends the track somewhere Lyria is not", () => {
    // The picture goes to Lyria (200, measured). The track goes to Gemini and
    // is turned into a description; the recording never reaches Lyria, which
    // is the owner's 2026-09-04c architecture and also the rights answer.
    const screen = read("src/routes/_authenticated/app.music.tsx");
    expect(screen).toContain("OniqAttachImage");
    expect(screen).toContain("OniqAttachAudio");
    expect(screen).toContain("referenceAudio");

    const fn = read("supabase/functions/music-generate/index.ts");
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    // The ONE place referenceAudio's bytes are put into a request part must be
    // the listening call, and it must come BEFORE the Lyria call.
    const listen = code.indexOf("model: AUDIO_UNDERSTANDING_MODEL");
    const lyria = code.indexOf("model: MUSIC_MODEL");
    expect(listen, "the listening stage is missing").toBeGreaterThan(-1);
    expect(lyria, "the Lyria call is missing").toBeGreaterThan(-1);
    expect(listen, "the track must be described BEFORE the song is written").toBeLessThan(lyria);
    // And the part list handed to Lyria must never carry the track's bytes.
    const from = code.indexOf("const parts: GooglePart[]");
    expect(from, "the Lyria part list is missing").toBeGreaterThan(-1);
    const lyriaCall = code.slice(from, code.indexOf("signal: ctrl.signal", from));
    expect(lyriaCall, "a reference TRACK must never reach Lyria").not.toContain("refAudio");
    expect(lyriaCall).toContain("body.referenceImage");
  });

  it("tells the person what a reference track actually does", () => {
    // Somebody attaching a song they like will otherwise assume a remix. The
    // owner asked for this to be explicit; it is also the difference between
    // ONIQ generating original music and appearing to launder a recording.
    // Read with whitespace collapsed: the sentence is prose in JSX and
    // Prettier reflows it, so asserting on line breaks would fail the next
    // time a word is added.
    const screen = read("src/routes/_authenticated/app.music.tsx").replace(/\s+/g, " ");
    expect(screen).toContain("music-reference-note");
    expect(screen).toMatch(/not copied, remixed or sent to the music engine/);
  });

  it("ships one on Image, which is the one that works", () => {
    const src = read("src/routes/_authenticated/app.image.tsx");
    expect(src).toContain("OniqAttachImage");
    expect(src).toContain("referenceImage");
  });
});

describe("validateReferenceImage", () => {
  it("accepts nothing at all — the attachment is optional", () => {
    expect(validateReferenceImage(undefined)).toBeNull();
    expect(validateReferenceImage(null)).toBeNull();
  });

  it("accepts each mime the picker offers", () => {
    for (const mimeType of REFERENCE_MIMES) {
      expect(validateReferenceImage({ mimeType, data: b64OfBytes(64) }), mimeType).toBeNull();
    }
  });

  it("refuses a mime no upstream here takes", () => {
    // HEIC is what an iPhone hands over; the client converts it to JPEG before
    // sending, and if that ever regresses this is where it surfaces.
    for (const mimeType of ["image/heic", "image/gif", "application/pdf", "audio/wav", ""]) {
      expect(validateReferenceImage({ mimeType, data: b64OfBytes(64) }), mimeType).toBe(
        "Attach a JPG, PNG or WebP picture.",
      );
    }
  });

  it("refuses a data: URL, which is the commonest client mistake", () => {
    // It produces an opaque 400 from Google, so it is caught here with a
    // sentence instead.
    expect(
      validateReferenceImage({ mimeType: "image/jpeg", data: "data:image/jpeg;base64,AAAA" }),
    ).toBe("That attachment could not be read.");
  });

  it("refuses anything that is not base64", () => {
    for (const data of ["not base64!", "AA AA", "AAAA\n", "%%%%"]) {
      expect(validateReferenceImage({ mimeType: "image/jpeg", data }), data).toBe(
        "That attachment could not be read.",
      );
    }
  });

  it("refuses an empty attachment rather than sending an empty part", () => {
    expect(validateReferenceImage({ mimeType: "image/jpeg", data: "" })).toBe(
      "That attachment was empty.",
    );
  });

  it("refuses a malformed object without throwing", () => {
    for (const bad of [42, "nope", [], {}, { mimeType: "image/jpeg" }, { data: "AAAA" }]) {
      expect(() => validateReferenceImage(bad)).not.toThrow();
      expect(validateReferenceImage(bad), JSON.stringify(bad)).toBeTruthy();
    }
  });

  it("measures the ceiling on DECODED bytes, not on the base64 string", () => {
    // Base64 is 4/3 of what it carries. A limit applied to the encoded form
    // would silently admit a third more than it claims to — so the boundary is
    // checked from both sides.
    const atLimit = b64OfBytes(REFERENCE_MAX_BYTES);
    expect(validateReferenceImage({ mimeType: "image/jpeg", data: atLimit })).toBeNull();
    const over = b64OfBytes(REFERENCE_MAX_BYTES + 1024);
    expect(validateReferenceImage({ mimeType: "image/jpeg", data: over })).toBe(
      "That picture is too large. Under 4MB, please.",
    );
    // The encoded form of a payload at the limit is a third larger than the
    // limit — proof the check is not reading the string length.
    expect(atLimit.length).toBeGreaterThan(REFERENCE_MAX_BYTES);
  });
});

describe("the attach control itself", () => {
  const SRC = read("src/components/oniq/OniqAttachImage.tsx");

  it("downscales before it sends, rather than posting a 12MB photo", () => {
    expect(SRC).toContain("compressToJpeg");
    expect(SRC).toMatch(/compressToJpeg\(file, 1024, 0\.7\)/);
  });

  it("normalises everything to JPEG, including what the picker let in", () => {
    expect(SRC).toContain('mimeType: "image/jpeg"');
  });

  it("resets the input so the same file can be picked twice", () => {
    // Without this, remove-then-reattach-the-same-photo fires no change event
    // and the control looks broken.
    expect(SRC.match(/e\.target\.value = "";/g) ?? []).toHaveLength(2);
  });

  it("keeps the preview data: URL out of what is sent", () => {
    const screen = read("src/routes/_authenticated/app.image.tsx");
    const body = screen.slice(
      screen.indexOf("referenceImage:"),
      screen.indexOf("referenceImage:") + 160,
    );
    expect(body).toContain("mimeType");
    expect(body).toContain("data:");
    expect(body, "previewUrl is for an <img>, not for the wire").not.toContain("previewUrl");
  });
});

describe("validateAudioAttachment", () => {
  const b64 = (n: number) => Buffer.alloc(n, 1).toString("base64");

  it("is optional", () => {
    expect(validateAudioAttachment(undefined)).toBeNull();
    expect(validateAudioAttachment(null)).toBeNull();
  });

  it("accepts what a browser recorder and a file picker actually produce", () => {
    for (const mimeType of ["audio/wav", "audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg"]) {
      expect(validateAudioAttachment({ mimeType, data: b64(64) }), mimeType).toBeNull();
    }
  });

  it("accepts a MediaRecorder mime with its codecs parameter", () => {
    // MediaRecorder tags its blobs "audio/webm;codecs=opus". Comparing the
    // whole string would reject every recording the app itself made.
    expect(
      validateAudioAttachment({ mimeType: "audio/webm;codecs=opus", data: b64(64) }),
    ).toBeNull();
    expect(validateAudioAttachment({ mimeType: "AUDIO/WAV", data: b64(64) })).toBeNull();
  });

  it("refuses a picture, a document and an empty type", () => {
    for (const mimeType of ["image/jpeg", "application/pdf", "video/mp4", ""]) {
      expect(validateAudioAttachment({ mimeType, data: b64(64) }), mimeType).toBe(
        "Attach an audio recording — WAV, MP3, M4A, WebM or Ogg.",
      );
    }
  });

  it("refuses a data: URL and anything that is not base64", () => {
    for (const data of ["data:audio/wav;base64,AAAA", "not base64!", "AA AA"]) {
      expect(validateAudioAttachment({ mimeType: "audio/wav", data }), data).toBe(
        "That recording could not be read.",
      );
    }
  });

  it("measures its ceiling on decoded bytes, both sides of the boundary", () => {
    expect(
      validateAudioAttachment({ mimeType: "audio/wav", data: b64(TRANSCRIBE_MAX_BYTES) }),
    ).toBeNull();
    expect(
      validateAudioAttachment({ mimeType: "audio/wav", data: b64(TRANSCRIBE_MAX_BYTES + 1024) }),
    ).toBe("That recording is too long. Under 8MB, please.");
  });
});

describe("the transcribe path on the server", () => {
  const SRC = read("supabase/functions/voice-generate/index.ts");

  it("goes to a TEXT model, not to the TTS one that cannot listen", () => {
    expect(SRC).toContain("AUDIO_UNDERSTANDING_MODEL");
    const block = SRC.slice(SRC.indexOf('body.action === "transcribe"'));
    expect(block.slice(0, 4000)).not.toContain("VOICE_MODEL");
  });

  it("puts the recording BEFORE the instruction", () => {
    const block = SRC.slice(SRC.indexOf('body.action === "transcribe"'));
    expect(block.indexOf("inlineData")).toBeLessThan(block.indexOf("{ text: ask }"));
  });

  it("builds the instruction server-side, never from the caller", () => {
    // A client-supplied instruction alongside audio would be an open prompt
    // surface on a paid model.
    expect(SRC).toMatch(/const ask = translateTo/);
    expect(SRC, "no free-text instruction from the body").not.toMatch(/body\.(prompt|instruction)/);
  });

  it("applies the kill switch, the admin gate and the per-user cap first", () => {
    const block = SRC.slice(SRC.indexOf('body.action === "transcribe"'));
    const call = block.indexOf("googleGenerateContent(");
    for (const gate of ["voice_enabled", "voice_admin_only", "voice_per_user_daily_cap"]) {
      const at = block.indexOf(gate);
      expect(at, `${gate} missing`).toBeGreaterThan(-1);
      expect(at, `${gate} runs after the billable call`).toBeLessThan(call);
    }
  });

  it("treats a 200 with no text as the failure it is", () => {
    expect(SRC).toContain("Nothing could be heard in that recording.");
  });
});

describe("what Lyria actually takes, measured 2026-09-04", () => {
  const SRC = read("supabase/functions/_shared/musicCore.ts");

  it("keeps the alias that already resolves to 3.5", () => {
    // The owner asked for lyria-3.5-pro-preview. That id 404s. But
    // lyria-3-pro-preview — what MUSIC_MODEL has always been — answers 200
    // and reports modelVersion lyria-3.5, so the ask was already satisfied.
    expect(MUSIC_MODEL).toBe("lyria-3-pro-preview");
    expect(SRC, "the 404 and the alias must stay written down").toContain("modelVersion lyria-3.5");
    expect(SRC).toContain("lyria-3.5-pro-preview    404");
  });

  it("names the clip model, which is genuinely separate", () => {
    // 993,519 bytes against 5,816,261 — a different model, not an alias.
    expect(MUSIC_CLIP_MODEL).toBe("lyria-3-clip-preview");
    expect(MUSIC_CLIP_MODEL).not.toBe(MUSIC_MODEL);
  });

  it("says image YES and audio NO, which is the whole architecture", () => {
    expect(MUSIC_ACCEPTS_IMAGE_REFERENCE).toBe(true);
    expect(MUSIC_ACCEPTS_AUDIO_REFERENCE).toBe(false);
  });

  it("keeps the evidence for both, including the refusal case", () => {
    expect(SRC).toContain("5,215,484");
    expect(SRC).toContain("Unsupported input mime type for this model");
    // A 200 with no audio is the silent-failure shape every path here guards
    // against; the caller needs to know it can happen.
    expect(SRC).toContain("PROHIBITED_CONTENT");
  });

  it("does not adopt the bare lyria-3.5 the alias points at", () => {
    // It answers, but the alias has the production history and swapping for
    // an id that resolves to the same engine buys nothing.
    expect(MUSIC_MODEL).not.toBe("lyria-3.5");
  });
});
