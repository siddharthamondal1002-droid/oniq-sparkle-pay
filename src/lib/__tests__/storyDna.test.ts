// Story DNA retrieval and blending — pinned against the REAL library.
//
// Owner directive 2026-08-27 (local story intelligence). These run over
// all 1,000 delivered entries rather than a fixture, because the rule
// that matters — recombine, never reproduce — is a property of the whole
// corpus, and a three-row fixture could satisfy every assertion here
// while the real library quietly failed them.
import { describe, expect, it } from "vitest";
import {
  BlendRefused,
  DNA_LIBRARY,
  DNA_POLICY,
  MIN_BLEND_SOURCES,
  blend,
  briefFor,
  extractRequirements,
  nearestDurationKey,
  retrieve,
  scoreEntry,
} from "../../../supabase/functions/_shared/storyDna.ts";

describe("the library is what was delivered", () => {
  it("carries all 1,000 entries with every axis populated", () => {
    expect(DNA_LIBRARY).toHaveLength(1000);
    for (const e of DNA_LIBRARY) {
      for (const [k, v] of Object.entries(e)) {
        if (k === "referenceInspirations") continue;
        expect(String(v).trim(), `${e.id}.${k}`).not.toBe("");
      }
    }
  });

  it("the axes really do vary — this is DNA, not one plot repeated", () => {
    const distinct = (f: (e: (typeof DNA_LIBRARY)[number]) => string) =>
      new Set(DNA_LIBRARY.map(f)).size;
    expect(distinct((e) => e.genre)).toBe(20);
    expect(distinct((e) => e.coreEngine)).toBeGreaterThan(500);
    expect(distinct((e) => e.centralTwist)).toBeGreaterThan(800);
    expect(distinct((e) => e.protagonistNeed)).toBeGreaterThan(150);
    expect(distinct((e) => e.endingFamily)).toBe(7);
    expect(distinct((e) => e.structure)).toBe(10);
    expect(distinct((e) => e.pacing)).toBe(5);
  });

  it("the house rules travel with it and forbid reproduction", () => {
    expect(DNA_POLICY.generation_rule).toMatch(/recombine/i);
    expect(DNA_POLICY.generation_rule).toMatch(/do not reproduce/i);
    // The setting engine is the anti-stereotype rule; it must survive.
    expect(DNA_POLICY.setting_engine).toMatch(/never infer identity/i);
  });
});

describe("requirements come from the user's own words", () => {
  it("reads the genre, pacing and ending the idea actually states", () => {
    const req = extractRequirements(
      "a slow burn horror story about a haunted radio, bittersweet",
      300,
    );
    expect(req.genres).toContain("Horror");
    expect(req.pacing).toBe("slow_burn");
    expect(req.endingFamily).toBe("bittersweet");
    expect(req.idea).toContain("haunted radio"); // kept verbatim
  });

  it("leaves unstated axes open instead of guessing", () => {
    const req = extractRequirements("a story about a lost dog", 180);
    expect(req.genres).toEqual([]);
    expect(req.pacing).toBeNull();
    expect(req.endingFamily).toBeNull();
  });

  it("an ambiguous signal is not a decision", () => {
    // Two ending words means the user did not choose one.
    const req = extractRequirements("tragic but hopeful", 180);
    expect(req.endingFamily).toBeNull();
  });

  it("maps a requested length to the nearest catalogue bucket", () => {
    expect(nearestDurationKey(180)).toBe("3_min");
    expect(nearestDurationKey(300)).toBe("5_min");
    expect(nearestDurationKey(1800)).toBe("30_min");
  });
});

describe("retrieval prefers the right DNA without collapsing onto it", () => {
  it("a stated genre dominates the shortlist", () => {
    const req = extractRequirements("a horror story in a lighthouse", 300);
    const top = retrieve(req, { seed: "s1", limit: 10 });
    expect(top.filter((r) => r.entry.genre === "Horror").length).toBeGreaterThanOrEqual(8);
  });

  it("every entry stays eligible — no genre is unreachable", () => {
    const req = extractRequirements("a horror story", 300);
    for (const e of DNA_LIBRARY) expect(scoreEntry(e, req)).toBeGreaterThan(0);
  });

  it("the same idea with different seeds draws different DNA", () => {
    const req = extractRequirements("a mystery in a small town", 300);
    const a = retrieve(req, { seed: "a", limit: 6 }).map((r) => r.entry.id);
    const b = retrieve(req, { seed: "b", limit: 6 }).map((r) => r.entry.id);
    expect(a).not.toEqual(b);
  });

  it("the same idea and seed are deterministic — no Math.random in a paid path", () => {
    const req = extractRequirements("a mystery in a small town", 300);
    expect(retrieve(req, { seed: "z", limit: 6 })).toEqual(retrieve(req, { seed: "z", limit: 6 }));
  });
});

describe("blending recombines — it never returns one plot", () => {
  it("draws each axis from a different entry and records where from", () => {
    const brief = briefFor("a haunted lighthouse", 300, "seed-1");
    expect(brief.sources.length).toBeGreaterThanOrEqual(MIN_BLEND_SOURCES);
    const provenance = Object.values(brief.provenance);
    expect(new Set(provenance).size).toBeGreaterThanOrEqual(MIN_BLEND_SOURCES);
  });

  it("no brief is ever a single library entry wearing a blend's clothes", () => {
    // The failure the library forbids, checked across many ideas.
    const ideas = [
      "a horror story",
      "a romance on a train",
      "a heist gone wrong",
      "a sci-fi story about memory",
      "a comedy about a wedding",
      "a slow burn mystery",
      "an epic fantasy quest",
      "a war story",
    ];
    for (const idea of ideas) {
      const brief = briefFor(idea, 300, "seed-x");
      expect(brief.sources.length, idea).toBeGreaterThanOrEqual(MIN_BLEND_SOURCES);
      const single = DNA_LIBRARY.find(
        (e) =>
          e.coreEngine === brief.coreEngine &&
          e.protagonistNeed === brief.protagonistNeed &&
          e.centralTwist === brief.centralTwist,
      );
      expect(single, `${idea} reproduced ${single?.id}`).toBeUndefined();
    }
  });

  it("refuses outright when there is not enough DNA to recombine", () => {
    const req = extractRequirements("anything", 300);
    expect(() => blend([], req)).toThrow(BlendRefused);
    expect(() => blend(retrieve(req, { seed: "s", limit: 2 }), req)).toThrow(BlendRefused);
  });

  it("what the user explicitly asked for beats the blend", () => {
    const brief = briefFor("a fast paced tragic heist", 300, "seed-2");
    expect(brief.pacing).toBe("fast");
    expect(brief.endingFamily).toBe("tragic");
  });

  it("the brief carries the house rules to whatever generates from it", () => {
    const brief = briefFor("a ghost story", 300, "seed-3");
    expect(brief.policy.generation_rule).toMatch(/do not reproduce/i);
  });
});
