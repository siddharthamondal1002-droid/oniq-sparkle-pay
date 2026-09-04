/**
 * THE CAPABILITY MATRIX + ROUTER CORE.
 *
 * modelRegistry.ts already records who serves each model and when it dies. This
 * adds the routing envelope — what each provider can actually DO — plus the two
 * pure functions a future provider-agnostic router will read (capabilityMatch,
 * selectByCapability). No caller routes through them yet; these tests prove the
 * brick is sound and, crucially, that the declared video envelope cannot drift
 * from story-clip's own constants (the same anti-drift discipline the id
 * cross-checks in modelRegistry.test.ts already enforce).
 *
 * The module is pure TypeScript with no Deno globals, so it imports directly —
 * the same way storyCastMemory.test.ts imports storyCast.ts from _shared.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODEL_REGISTRY,
  capabilityMatch,
  selectByCapability,
} from "../../../supabase/functions/_shared/modelRegistry.ts";

const ROOT = process.cwd();
const CLIP_SRC = readFileSync(
  join(ROOT, "supabase/functions/story-clip/index.ts"),
  "utf8",
);

describe("every model carries a well-formed capability envelope", () => {
  it("declares a modality and boolean support flags for all entries", () => {
    for (const m of MODEL_REGISTRY) {
      expect(
        ["text", "text-to-image", "image-to-video", "text-to-speech"],
        `${m.id} modality`,
      ).toContain(m.capabilities.modality);
      // null is allowed here and false is not a substitute for it. The
      // registry's rule is that an unverified limit is recorded as unknown
      // rather than invented, and `false` on referenceSupport would assert a
      // measurement nobody made — the exact kind of confident-looking guess
      // this suite exists to keep out. A model wired into a caller has been
      // measured by definition; an unwired, recorded-only entry may not have.
      expect(
        m.capabilities.referenceSupport === null ||
          typeof m.capabilities.referenceSupport === "boolean",
        `${m.id} referenceSupport must be boolean or null`,
      ).toBe(true);
      expect(typeof m.capabilities.audioSupport, `${m.id} audioSupport`).toBe("boolean");
      expect(Array.isArray(m.capabilities.aspectRatios), `${m.id} aspectRatios`).toBe(true);
    }
  });
});

describe("the video envelope cannot drift from story-clip's own constants", () => {
  const clip = MODEL_REGISTRY.find((m) => m.usedBy === "story-clip")!;

  it("VIDEO_CLIP durations equal story-clip's DURATIONS set", () => {
    const m = CLIP_SRC.match(/const DURATIONS = new Set\(\[([\d,\s]+)\]\)/);
    expect(m, "story-clip lost its DURATIONS set").not.toBeNull();
    const codeDurations = m![1].split(",").map((s) => Number(s.trim())).sort();
    expect([...(clip.capabilities.durationsSec ?? [])].sort()).toEqual(codeDurations);
  });

  it("VIDEO_CLIP aspect equals story-clip's ASPECT", () => {
    const aspect = CLIP_SRC.match(/const ASPECT = "([^"]+)"/)?.[1];
    expect(aspect, "story-clip lost its ASPECT").toBeTruthy();
    expect(clip.capabilities.aspectRatios).toContain(aspect);
  });

  it("VIDEO_CLIP is image-to-video and needs a reference frame", () => {
    expect(clip.capabilities.modality).toBe("image-to-video");
    expect(clip.capabilities.referenceSupport).toBe(true);
  });
});

describe("capabilityMatch — the pure predicate", () => {
  const clip = MODEL_REGISTRY.find((m) => m.usedBy === "story-clip")!;
  const text = MODEL_REGISTRY.find((m) => m.capabilities.modality === "text")!;

  it("accepts a valid clip requirement", () => {
    expect(
      capabilityMatch(clip, {
        modality: "image-to-video",
        durationSec: 8,
        aspectRatio: "9:16",
        referenceImage: true,
      }),
    ).toBe(true);
  });

  it("rejects a duration the API does not offer (no 10s, no extend)", () => {
    expect(capabilityMatch(clip, { modality: "image-to-video", durationSec: 10 })).toBe(false);
  });

  it("rejects a modality mismatch", () => {
    expect(capabilityMatch(text, { modality: "image-to-video" })).toBe(false);
    expect(capabilityMatch(clip, { modality: "text" })).toBe(false);
  });

  it("rejects when a reference frame is required but unsupported", () => {
    expect(capabilityMatch(text, { modality: "text", referenceImage: true })).toBe(false);
  });
});

describe("selectByCapability — never routes to a dead model", () => {
  it("returns a live clip provider for the clip requirement", () => {
    const hits = selectByCapability({
      modality: "image-to-video",
      durationSec: 8,
      aspectRatio: "9:16",
      referenceImage: true,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((m) => m.status !== "shutdown")).toBe(true);
  });

  it("excludes the shut-down Veo fallback by construction", () => {
    const dead = MODEL_REGISTRY.find((m) => m.status === "shutdown");
    expect(dead, "expected a shutdown entry to prove exclusion").toBeTruthy();
    const hits = selectByCapability({ modality: "image-to-video", durationSec: 8 });
    expect(hits.map((m) => m.id)).not.toContain(dead!.id);
  });

  it("returns a text provider for a text requirement, no video models", () => {
    const hits = selectByCapability({ modality: "text" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((m) => m.capabilities.modality === "text")).toBe(true);
  });
});
