// Actor build — the character contract (mega loop, 2026-08-27). The load-
// bearing property: a character asset is the USER'S description, and the
// build pipeline adds photography framing only — no ethnicity, gender,
// occupation, age, region, or any other identity the user did not type.
import { describe, expect, it } from "vitest";

import {
  ACTOR_LOCK_MAX,
  ACTOR_MIMES,
  ACTOR_NAME_MAX,
  actorAssetPath,
  actorExtension,
  actorReferencePrompt,
  jobsFeaturingActor,
  validateActorBuild,
} from "@/lib/actorBuild";

// The loop's own examples: the SAME architecture must carry all of these.
const ARBITRARY_LOCKS = [
  "a fishmonger arranging the morning catch on a Jamaican quayside stall",
  "a middle-aged Bengali woman in a starched cotton sari, steel-rimmed glasses",
  "a detective in a rain-darkened London overcoat, collar up",
  "a small child in a patched cloak, wandering a floating fantasy city",
  "a moss-covered river creature with lantern eyes and driftwood antlers",
];

describe("identity stays the user's — no attribute is ever imposed", () => {
  it("accepts arbitrary descriptions verbatim, whoever they describe", () => {
    for (const lock of ARBITRARY_LOCKS) {
      const v = validateActorBuild({ name: "Character", lock });
      expect(v.ok, lock).toBe(true);
      if (v.ok) expect(v.input.lock).toBe(lock);
    }
  });

  it("the prompt is fixed framing plus the user's words and NOTHING else", () => {
    for (const lock of ARBITRARY_LOCKS) {
      const prompt = actorReferencePrompt({ lock, style: null });
      expect(prompt).toContain(`exactly as described: ${lock}`);
      // Remove the user's own text; what remains is the framing — and the
      // framing must carry no identity vocabulary of its own.
      const framing = prompt.replace(lock, "").toLowerCase();
      for (const word of [
        "woman",
        "man ",
        "male",
        "female",
        "boy",
        "girl",
        "young",
        "old ",
        "elderly",
        "asian",
        "african",
        "european",
        "american",
        "indian",
        "ethnic",
        "nationality",
        "religion",
      ]) {
        expect(framing, `framing must not add "${word}"`).not.toContain(word);
      }
    }
  });

  it("normalisation is bounds-only — trim, never reinterpretation", () => {
    const v = validateActorBuild({ name: "  Meera  ", lock: "  red scarf, two braids  " });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.input.name).toBe("Meera");
      expect(v.input.lock).toBe("red scarf, two braids");
      expect(v.input.style).toBeNull();
    }
  });

  it("style is included only when the user supplied one", () => {
    const without = actorReferencePrompt({ lock: "a quiet lighthouse keeper", style: null });
    expect(without).not.toContain("Visual style:");
    const with_ = actorReferencePrompt({
      lock: "a quiet lighthouse keeper",
      style: "storybook watercolour",
    });
    expect(with_).toContain("Visual style: storybook watercolour");
  });
});

describe("bounds — an asset a film could never take is refused early", () => {
  it("refuses empties and oversizes with named reasons", () => {
    expect(validateActorBuild({ name: "", lock: "x" })).toEqual({
      ok: false,
      reason: "name-missing",
    });
    expect(validateActorBuild({ name: "x", lock: "  " })).toEqual({
      ok: false,
      reason: "lock-missing",
    });
    expect(validateActorBuild({ name: "x".repeat(ACTOR_NAME_MAX + 1), lock: "y" })).toEqual({
      ok: false,
      reason: "name-too-long",
    });
    expect(validateActorBuild({ name: "x", lock: "y".repeat(ACTOR_LOCK_MAX + 1) })).toEqual({
      ok: false,
      reason: "lock-too-long",
    });
  });

  it("mirrors the cast library bounds, so every asset can ride into a film", () => {
    expect(ACTOR_NAME_MAX).toBe(60);
    expect(ACTOR_LOCK_MAX).toBe(400);
  });
});

describe("asset identity and storage layout", () => {
  it("object names live in the owner's folder — the path IS the access control", () => {
    expect(actorAssetPath("user-1", "asset-9", "image/png")).toBe("user-1/asset-9.png");
    expect(actorAssetPath("user-1", "asset-9", "image/webp")).toBe("user-1/asset-9.webp");
    expect(actorAssetPath("user-1", "asset-9", "image/jpeg")).toBe("user-1/asset-9.jpg");
  });

  it("extensions and mimes agree with the bucket contract", () => {
    expect(ACTOR_MIMES).toEqual(["image/png", "image/jpeg", "image/webp"]);
    expect(actorExtension("image/png")).toBe("png");
    expect(actorExtension("application/octet-stream")).toBe("jpg");
  });
});

describe("associations — resolved from the existing cast channel, no new table", () => {
  const asset = { name: "Meera", lock: "red scarf, two braids" };

  it("finds the films whose attached cast carries the same character", () => {
    const jobs = [
      { id: "job-1", cast_json: [{ name: "Meera", lock: "red scarf, two braids" }] },
      { id: "job-2", cast_json: [{ name: "Ravi", lock: "an indigo shawl" }] },
      { id: "job-3", cast_json: [{ name: " meera ", lock: "RED scarf, two braids" }] },
      { id: "job-4" },
      { id: "job-5", cast_json: "not-an-array" },
    ];
    expect(jobsFeaturingActor(asset, jobs)).toEqual(["job-1", "job-3"]);
  });

  it("no association is a valid answer", () => {
    expect(jobsFeaturingActor(asset, [])).toEqual([]);
  });
});

describe("no implicit cascade — the module is pure", () => {
  it("actorBuild imports no network, no supabase, no RPC surface", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { stripComments } = await import("@/test/sourceText");
    const src = stripComments(readFileSync(join(process.cwd(), "src/lib/actorBuild.ts"), "utf8"));
    expect(src).not.toContain("supabase");
    expect(src).not.toContain("fetch(");
    expect(src).not.toContain("rpc(");
    expect(src).not.toContain("invoke(");
  });
});
