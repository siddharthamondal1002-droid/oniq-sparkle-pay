/**
 * THE CHARACTER REFERENCE IS AN IDENTITY, AND THE ALLOWLIST IS THE AUTHORITY.
 *
 * Owner directive, 2026-08-31: "Never expose arbitrary R2/bucket URLs to the
 * model worker. Never allow a user-provided URL to become an arbitrary fetch
 * target. The worker should receive an authorized reference identity/key, not
 * arbitrary storage paths."
 *
 * These tests hold that shape from the app's side. The GPU worker holds the
 * same rule independently in contract.py — two checks that cannot both be
 * talked out of it — and its own suite proves that half.
 *
 * The property under test is NOT "bad input is sanitised". It is that there
 * is no capability here to sanitise access TO: a name that is not a published
 * canonical character resolves to nothing, and nothing is what the worker is
 * then asked for.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_REFERENCE_STRENGTH,
  MAX_REFERENCE_STRENGTH,
  MIN_REFERENCE_STRENGTH,
  CANONICAL_VERSION,
  REFERENCE_PREFIX,
  REFERENCE_SCOPE_CANON,
  characterRefKey,
  isCanonicalRefKey,
  isPublishableCharacterRef,
} from "../../../supabase/functions/_shared/characterRef.ts";
import { ACTOR_ASSETS, referenceEligible } from "../../data/storyActorAssets.ts";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("only a published canonical character resolves to a key", () => {
  const eligible = ACTOR_ASSETS.filter(referenceEligible);

  it("every eligible actor in the owner map resolves", () => {
    expect(eligible.length).toBeGreaterThan(0);
    for (const a of eligible) {
      expect(characterRefKey(a.characterRefId), a.characterRefId).toBe(
        `${REFERENCE_PREFIX}${REFERENCE_SCOPE_CANON}/${a.characterRefId}/v1.png`,
      );
    }
  });

  it("a sheet frame does NOT — it reproduces its own layout when conditioned", () => {
    // Measured 2026-08-21, shot 04. Eligibility is part of the allowlist
    // rather than a later check, so a sheet id never becomes a key at all.
    for (const a of ACTOR_ASSETS.filter((x) => !referenceEligible(x))) {
      expect(characterRefKey(a.characterRefId), a.characterRefId).toBeNull();
    }
  });

  it("nothing outside the map resolves, however it is shaped", () => {
    for (const hostile of [
      "../../etc/passwd",
      "story/still/someone-elses-shot",
      "story/ref/../escape",
      "https://evil.example/x.png",
      "s3://bucket/key",
      "83193e07-2b3c-465b-8479-7a3f03d73464/../../secret",
      "*",
      "",
      "   ",
      null,
      undefined,
      42,
      {},
      [],
    ]) {
      expect(characterRefKey(hostile as unknown), String(hostile)).toBeNull();
      expect(isPublishableCharacterRef(hostile as unknown)).toBe(false);
    }
  });

  it("versions are immutable and separate — v1 and v2 are different objects", () => {
    // A shot drawn against v1 must keep looking like v1 after the character is
    // re-published. Overwriting one key in place would silently change films
    // that were already finished, and nobody would see it happen.
    const id = eligible[0].characterRefId;
    expect(characterRefKey(id, 1)).not.toBe(characterRefKey(id, 2));
    expect(characterRefKey(id, 1)).toContain("/v1.png");
    expect(characterRefKey(id, 2)).toContain("/v2.png");
    expect(characterRefKey(id)).toBe(characterRefKey(id, CANONICAL_VERSION));
    // Not a timestamp and not a random id — an identity that moves is not one.
    for (const bad of [0, -1, 1.5, "1", null, 10_000, NaN]) {
      expect(characterRefKey(id, bad as unknown as number), String(bad)).toBeNull();
    }
  });

  it("the scope segment keeps canon separate from anything added later", () => {
    // Per-user references, if they are ever added, land under a DIFFERENT
    // scope. Widening an authorisation pattern later is the change nobody
    // reviews carefully enough.
    for (const a of eligible.slice(0, 5)) {
      expect(characterRefKey(a.characterRefId)).toContain(`/${REFERENCE_SCOPE_CANON}/`);
    }
    expect(isCanonicalRefKey(`story/ref/u/someone/x/v1.png`)).toBe(false);
  });

  it("a real id with anything appended is a different id, and resolves to nothing", () => {
    const real = ACTOR_ASSETS.filter(referenceEligible)[0].characterRefId;
    for (const suffix of ["/../x", ".png", "%2F..", " ", "\n", "?x=1"]) {
      expect(characterRefKey(real + suffix), suffix).toBeNull();
    }
  });

  it("every key it can produce is under the server-owned prefix", () => {
    for (const a of eligible) {
      const key = characterRefKey(a.characterRefId)!;
      expect(key.startsWith(REFERENCE_PREFIX)).toBe(true);
      expect(key).not.toContain("..");
      expect(isCanonicalRefKey(key)).toBe(true);
    }
  });

  it("a key that merely LOOKS right is still refused", () => {
    // The prefix is not the authority; the allowlist is.
    expect(isCanonicalRefKey("story/ref/not-a-real-character.png")).toBe(false);
    expect(isCanonicalRefKey("story/ref/")).toBe(false);
  });
});

describe("the module cannot reach anything", () => {
  const SRC = read("supabase/functions/_shared/characterRef.ts");

  it("names no host, builds no URL, and performs no fetch", () => {
    // Comments stripped first: the module's own note explains that it reuses
    // the ORIGIN PIN's discipline, and deleting that explanation to satisfy a
    // substring search would remove the reasoning and keep the regex happy.
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    for (const forbidden of ["http", "fetch(", "://", "origin", "presign", "Deno.env"]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it("carries no credential of any kind", () => {
    for (const forbidden of ["SERVICE_ROLE", "apikey", "Authorization", "SECRET", "TOKEN"]) {
      expect(SRC).not.toContain(forbidden);
    }
  });
});

describe("the strength band matches the worker's contract", () => {
  it("both ends are refusals, and the default sits between them", () => {
    expect(MIN_REFERENCE_STRENGTH).toBeGreaterThan(0);
    expect(MAX_REFERENCE_STRENGTH).toBeLessThan(1);
    expect(DEFAULT_REFERENCE_STRENGTH).toBeGreaterThan(MIN_REFERENCE_STRENGTH);
    expect(DEFAULT_REFERENCE_STRENGTH).toBeLessThan(MAX_REFERENCE_STRENGTH);
  });

  it("and the numbers are pinned on both sides, so neither end can drift", () => {
    // A bound known to only one end of a contract is a deterministic failure
    // waiting for the right input — the lesson of the 1000-character prompt
    // ceiling, applied before it can happen again.
    //
    // oniq-gpu-worker/contract.py pins MIN_REFERENCE_STRENGTH = 0.05,
    // MAX_REFERENCE_STRENGTH = 0.95 and REFERENCE_PREFIX = "story/ref/", and
    // its own suite asserts those literals. The two repos cannot import each
    // other and CI checks out one at a time, so the numbers are pinned on
    // both sides rather than read across — the same discipline
    // gpuVideoAudio.test.ts applies to MAX_NARRATION_CHARS.
    expect(MIN_REFERENCE_STRENGTH).toBe(0.05);
    expect(MAX_REFERENCE_STRENGTH).toBe(0.95);
    expect(REFERENCE_PREFIX).toBe("story/ref/");
    expect(REFERENCE_SCOPE_CANON).toBe("canon");
  });
});

describe("the routing semantics are pinned — all three flags", () => {
  const WORKER = read("remotion/scripts/story-worker.mjs");
  const LEDGER = read("supabase/functions/_shared/inHouseMotion.ts");

  it("each flag has its own answer and none of them is 'premium'", () => {
    // Two of these are separate on purpose: a healthy endpoint holding an
    // empty template is a real state, and it is how one LTX request sat until
    // the 1800s watchdog killed it.
    expect(LEDGER).toMatch(/if \(!c\.inHouseEnabled\) return \{ engine: "premium", level: 5 \}/);
    expect(LEDGER).toMatch(
      /if \(!c\.workerImagePresent\) return \{ engine: "blocked", reason: "worker-image-missing" \}/,
    );
    expect(LEDGER).toMatch(
      /if \(!c\.gpuHealthy\) return \{ engine: "blocked", reason: "gpu-unavailable" \}/,
    );
    expect(LEDGER).toMatch(/return \{ engine: "in-house", level: 4 \}/);
  });

  it("the renderer reads exactly those three environment flags", () => {
    expect(WORKER).toMatch(/inHouseEnabled: process\.env\.IN_HOUSE_MOTION === 'on'/);
    expect(WORKER).toMatch(/gpuHealthy: process\.env\.ONIQ_GPU_HEALTHY === 'on'/);
    expect(WORKER).toMatch(/workerImagePresent: process\.env\.ONIQ_WORKER_IMAGE === 'on'/);
  });

  it("a blocked route throws before any provider is reached", () => {
    const at = WORKER.indexOf("route.engine === 'blocked'");
    expect(at).toBeGreaterThan(-1);
    const branch = WORKER.slice(at, at + 500);
    expect(branch).toMatch(/throw new Error/);
    expect(branch).toContain("no provider fallback");
    // And the throw comes before the in-house branch, so nothing can fall past it.
    expect(at).toBeLessThan(WORKER.indexOf("route.engine === 'in-house'"));
  });
});
