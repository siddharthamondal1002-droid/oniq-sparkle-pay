/**
 * ATTACHING A REFERENCE — what may be offered, and what may not.
 *
 * The owner's reference draws an attach control on Image, Music AND Voice.
 * Only ONE of the three can be built, and that is not a judgement call — it
 * was measured on 2026-09-04 against the real endpoints:
 *
 *   Image  gemini-3.1-flash-image        + inlineData jpeg  -> 200, edited picture
 *   Music  lyria-3-pro-preview           + inlineData wav   -> 400 unsupported
 *          (same prompt, no attachment, control)            -> 200, 5.5 MB track
 *   Voice  gemini-3.1-flash-tts-preview  + inlineData wav   -> 400 not enabled
 *
 * These tests exist so a later pass cannot quietly add the two dead buttons
 * back to match the picture. A control that 400s every generation it touches
 * is worse than an absent one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REFERENCE_MAX_BYTES,
  REFERENCE_MIMES,
  validateReferenceImage,
} from "../../../supabase/functions/_shared/imageCore.ts";
import { MUSIC_ACCEPTS_AUDIO_REFERENCE } from "../../../supabase/functions/_shared/musicCore.ts";
import { VOICE_ACCEPTS_AUDIO_INPUT } from "../../../supabase/functions/_shared/voiceCore.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** `n` decoded bytes as valid base64, for the size boundary tests. */
function b64OfBytes(n: number): string {
  return Buffer.alloc(n, 1).toString("base64");
}

describe("what the three engines actually accept", () => {
  it("records Music and Voice as refusing audio input", () => {
    expect(MUSIC_ACCEPTS_AUDIO_REFERENCE).toBe(false);
    expect(VOICE_ACCEPTS_AUDIO_INPUT).toBe(false);
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

  it("ships no attach control on the Music or Voice screens", () => {
    for (const screen of ["app.music.tsx", "app.voice.tsx"]) {
      const src = read(`src/routes/_authenticated/${screen}`);
      expect(src, `${screen} must not offer an attachment that 400s`).not.toContain(
        "OniqAttachImage",
      );
      expect(src, `${screen} must not send a reference`).not.toMatch(
        /referenceImage|referenceAudio/,
      );
    }
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
