/**
 * The admin probe's SPEECH LEGS — the pair that was measured through the
 * Lovable agent on 2026-09-07 (both 403 aiplatform.endpoints.predict) and then
 * moved into the probe so the next re-measure costs a tap, not credits.
 *
 * The pure halves are tested by running them; the wiring is read from source
 * with comments stripped, because the comment beside the probe quotes every
 * function name it calls — the seventh prose match this repo has recorded.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";
import {
  audioBytesOf,
  oneStepSpeechBody,
  prebuiltSpeechBody,
  PROBE_TEXT,
  speechVerdict,
  syntheticSineWav,
  validateReplicationAudio,
} from "../../../supabase/functions/_shared/voiceReplication.ts";

type SpeechBody = {
  contents: { role: string; parts: { text: string }[] }[];
  generationConfig: {
    responseModalities: string[];
    speechConfig: { voiceConfig: Record<string, unknown> };
  };
};

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

describe("the probe's synthetic sample", () => {
  it("is a valid 16-bit mono 24 kHz WAV of the stated length", () => {
    const wav = syntheticSineWav(3, 220);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 12)).toBe("WAVE");
    expect(ascii(wav, 12, 16)).toBe("fmt ");
    expect(ascii(wav, 36, 40)).toBe("data");
    const v = new DataView(wav.buffer);
    expect(v.getUint16(20, true), "PCM").toBe(1);
    expect(v.getUint16(22, true), "mono").toBe(1);
    expect(v.getUint32(24, true), "24 kHz").toBe(24000);
    expect(v.getUint16(34, true), "16-bit").toBe(16);
    expect(v.getUint32(40, true)).toBe(3 * 24000 * 2);
    expect(wav.length).toBe(44 + 3 * 24000 * 2);
  });

  it("passes the same WAV rules a real recording must", () => {
    // Format, bits, channels and rate are checked by the very validator the
    // create path runs, so a header mistake here cannot be mistaken for a
    // Google refusal when the probe reports a 400.
    expect(validateReplicationAudio(syntheticSineWav(3, 220), "consent")).toBeNull();
  });

  it("actually oscillates rather than being silence with a header", () => {
    const v = new DataView(syntheticSineWav(1, 220).buffer);
    let positive = 0;
    let negative = 0;
    for (let i = 0; i < 24000; i++) {
      const s = v.getInt16(44 + i * 2, true);
      if (s > 0) positive++;
      if (s < 0) negative++;
    }
    expect(positive).toBeGreaterThan(10000);
    expect(negative).toBeGreaterThan(10000);
  });
});

describe("the two speech bodies", () => {
  it("control is the shape voice-generate proves live: contents as an array, AUDIO out", () => {
    const b = prebuiltSpeechBody(PROBE_TEXT, "Kore") as unknown as SpeechBody;
    expect(Array.isArray(b.contents)).toBe(true);
    expect(b.contents[0].parts[0].text).toBe(PROBE_TEXT);
    expect(b.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(b.generationConfig.speechConfig.voiceConfig).toEqual({
      prebuiltVoiceConfig: { voiceName: "Kore" },
    });
  });

  it("experiment is Google's PUBLIC one-step shape — sample inline, no key, no consent field", () => {
    const b = oneStepSpeechBody(PROBE_TEXT, "AAAA") as unknown as SpeechBody;
    expect(b.generationConfig.speechConfig.voiceConfig).toEqual({
      replicatedVoiceConfig: { voiceSampleAudio: "AAAA", mimeType: "audio/wav" },
    });
    // The two-step flow's plain-string `voice` key must not leak into this shape.
    expect(JSON.stringify(b)).not.toMatch(/"voice"\s*:/);
    expect(JSON.stringify(b)).not.toMatch(/consent/i);
  });
});

describe("audioBytesOf", () => {
  it("reads inlineData from a generateContent success, null for anything else", () => {
    expect(
      audioBytesOf({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: "audio/L16", data: "QUJD" } }] } },
        ],
      }),
    ).toBe(4);
    expect(
      audioBytesOf({ candidates: [{ content: { parts: [{ text: "no audio" }] } }] }),
    ).toBeNull();
    expect(audioBytesOf(null)).toBeNull();
    expect(audioBytesOf({})).toBeNull();
  });
});

describe("speechVerdict reads the control first", () => {
  it("a failed control makes the experiment uninterpretable, whatever it said", () => {
    expect(speechVerdict({ ok: false, status: 403 }, { ok: false, status: 403 })).toMatch(
      /CONTROL FAILED 403/,
    );
    expect(speechVerdict({ ok: false, status: 404 }, { ok: true })).toMatch(/CONTROL FAILED 404/);
  });

  it("names the three readable outcomes", () => {
    expect(speechVerdict({ ok: true }, { ok: true })).toMatch(/OPEN/);
    expect(speechVerdict({ ok: true }, { ok: false, status: 400 })).toMatch(/SAMPLE/);
    expect(speechVerdict({ ok: true }, { ok: false, status: 403 })).toMatch(/GATED/);
  });
});

describe("the probe carries both legs, below the admin gate, and still cannot mint", () => {
  const fn = stripComments(
    readFileSync(join(process.cwd(), "supabase/functions/voice-clone/index.ts"), "utf8"),
  );
  const probeAt = fn.indexOf('action === "probe"');
  const speakAt = fn.indexOf('action === "speak"');
  const probe = fn.slice(probeAt, speakAt);

  it("posts the control and the experiment to replicatedSynthesisUrl inside the probe", () => {
    expect(probeAt).toBeGreaterThan(-1);
    expect(speakAt).toBeGreaterThan(probeAt);
    for (const marker of [
      "replicatedSynthesisUrl(projectId)",
      "syntheticSineWav(",
      "prebuiltSpeechBody(",
      "oneStepSpeechBody(",
      "speechVerdict(",
    ]) {
      expect(probe, marker).toContain(marker);
    }
  });

  it("never mints from the probe", () => {
    expect(probe).not.toContain("replicationKeyBody(");
  });

  it("stays below the admin gate", () => {
    expect(fn.indexOf("is_admin")).toBeLessThan(probeAt);
  });
});
