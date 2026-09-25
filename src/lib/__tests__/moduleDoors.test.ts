/**
 * EVERY MODULE MUST HAVE A CALLER, OR BE ON THE LIST.
 *
 * The sibling of `routeDoors`, one level down. That guard asks whether a
 * SCREEN is linked; this asks whether a MODULE is run. CLAUDE.md records ten
 * instances of the same failure and names it "this repo's most-recorded" —
 * `voiceReplication.ts` with zero importers through two days of Vertex
 * probing, the motion validator "absent from the Dockerfile, imported by
 * nothing", `toKnowledgeState` called one of the substrate's "exactly two
 * exits" with no caller anywhere. Each shipped green, each was found by the
 * owner opening the app.
 *
 * THE RATCHET IS THE POINT, AND IT IS THE `eslint-suppressions.json` SHAPE.
 * 48 modules have no caller today; freezing them and failing on the 49th is
 * what makes this land in one commit instead of never. A FROZEN LIST rather
 * than a count, because a count lets one orphan be swapped for another — and
 * a stale entry FAILS, so the list can only shrink.
 *
 * AND THE STALE-ENTRY HALF EARNED ITSELF ON DAY TWO. The list shipped at 79
 * and TWENTY-FOUR of those were false: `remotion/` was missing from the walk,
 * so `remotion/scripts/story-worker.mjs` — the command GitHub Actions runs on
 * every user's Story film, importing twenty-eight modules out of `src/` and
 * `_shared/` by relative path — was invisible, and everything only it reached
 * read as dead. `motionValidate.ts` and `motionGate.ts` were both on that
 * list, which is exactly the "absent from the Dockerfile, imported by nothing"
 * claim this file was built to check. The compositor imports both. A guard
 * that can only ever say "orphan" is a guard that cannot be wrong out loud;
 * the assertion that a listed module must STILL be an orphan is what caught
 * all twenty-four in one run.
 *
 * TWO MORE FELL THE SAME AFTERNOON, AND TO THE SAME SHAPE ONE LAYER DOWN. The
 * MIRRORED rung knew ONE path convention, `src/oqca/X` -> `_shared/oqca/X`,
 * and ONIQ has two: `src/health/consent.ts` and `retention.ts` say "MIRRORED
 * byte for byte" in their own headers and their twins are imported by the
 * deployed `health-api`. The rule is derived from CONTENT now, so a third
 * mirror is recognised without an edit.
 *
 * AND FIVE CAME OFF THE LIST THE SAME DAY BY BEING WIRED, which is the only
 * way an entry is ever meant to leave it: `storyModel` and the four modules
 * under it got their first caller when `story-plot` grew a Story IR rung. The
 * ratchet named them within a minute of the wiring — a list that had to be
 * curated by hand would have carried them for months.
 *
 * `BY_DESIGN` IS A RULE AND THE FROZEN LIST IS A DEBT, and conflating them
 * would be the worse of the two mistakes. A vendored shadcn primitive nobody
 * has used yet is a LIBRARY; putting it on a list headed "should shrink"
 * invites someone to delete a button ONIQ will want. Both prefixes are narrow
 * and both are asserted to still matter, because CLAUDE.md has the receipt for
 * a guard whose stated discriminator was doing nothing.
 */
import { describe, expect, it } from "vitest";

import {
  importGraph,
  isAppEntrypoint,
  isTestModule,
  isToolEntrypoint,
  contentKeys,
  reachability,
} from "../../test/moduleGraph.ts";

/**
 * Not debt, and never expected to shrink.
 *
 *   src/components/ui/  vendored shadcn primitives (radix + cva). 41 of 47 are
 *                       unused: that is what a component library looks like.
 *   src/test/           the test helpers themselves. Their only legitimate
 *                       consumer is a test, which is exactly what this guard
 *                       refuses to treat as a caller everywhere else.
 */
const BY_DESIGN = ["src/components/ui/", "src/test/"] as const;

/**
 * Modules with no caller as of 2026-09-12. Each one is either work that was
 * never wired up or work whose caller was removed. THE LIST MAY ONLY SHRINK:
 * delete a line when you wire the module up or delete the module.
 */
const KNOWN_ORPHANS: readonly string[] = [
  "src/components/m3/Button.tsx",
  "src/components/m3/LayoutGrid.tsx",
  "src/components/m3/Surface.tsx",
  "src/components/upi/UpiScannerOverlay.tsx",
  "src/data/storyCharacterRefs.ts",
  "src/data/storyStyleRefs.ts",
  "src/design/material.ts",
  "src/hooks/use-mobile.tsx",
  "src/lib/ai.functions.ts",
  "src/lib/assertionReason.ts",
  "src/lib/assessmentBlueprint.ts",
  "src/lib/audioDuck.ts",
  "src/lib/caseStudy.ts",
  "src/lib/creator/payoutClassify.ts",
  "src/lib/entitlements.ts",
  "src/lib/itemLint.ts",
  "src/lib/itemSimilarity.ts",
  "src/lib/keyVerification.ts",
  "src/lib/retrievalPractice.ts",
  "src/lib/shotPlan.ts",
  "src/lib/storyActors.ts",
  "src/lib/storyCostModel.ts",
  "src/lib/storyLifecycle.ts",
  "src/lib/storyRenderer.ts",
  "src/oqca/backends/backend.ts",
  "src/oqca/backends/classicalSimulator.ts",
  "src/oqca/backends/qpu.ts",
  "src/oqca/backends/tensor.ts",
  "src/oqca/baseline.ts",
  "src/oqca/benchmark.ts",
  "src/oqca/gates.ts",
  "src/oqca/knowledge/substrate/metrics.ts",
  "src/oqca/loop/megaLoop.ts",
  "src/oqca/quantum/backends/adapters.ts",
  "src/oqca/quantum/concepts.ts",
  "src/oqca/quantum/math/channel.ts",
  "src/oqca/quantum/math/info.ts",
  "src/oqca/tasks.ts",
  "supabase/functions/_shared/directorDispatch.ts",
  "supabase/functions/_shared/directorGraph.ts",
  "supabase/functions/_shared/filmCapacity.ts",
  "supabase/functions/_shared/gatewayVoice.ts",
  "supabase/functions/_shared/oniqStory.ts",
  "supabase/functions/_shared/shotReview.ts",
  "supabase/functions/_shared/videoBenchmark.ts",
  "supabase/functions/_shared/videoProvider.ts",
  "supabase/functions/_shared/webRetrieval.ts",
];

function frozenOrphans(): string[] {
  return reachability(importGraph()).orphans.filter((f) => !BY_DESIGN.some((p) => f.startsWith(p)));
}

describe("every module has a caller, or is on the list", () => {
  it("no module has lost its last caller since the list was frozen", () => {
    const known = new Set(KNOWN_ORPHANS);
    const appeared = frozenOrphans().filter((f) => !known.has(f));
    expect(
      appeared,
      `these modules have no caller — wire them up, or add them to KNOWN_ORPHANS with a reason:\n${appeared.join("\n")}`,
    ).toEqual([]);
  });

  /**
   * THE HALF THAT MAKES IT A RATCHET. Without this the list is a drawer: a
   * module gets wired up, its line stays, and the next orphan hides behind a
   * count that never moved.
   */
  it("the list carries no entry that is now reachable or deleted", () => {
    const current = new Set(frozenOrphans());
    const stale = KNOWN_ORPHANS.filter((f) => !current.has(f));
    expect(
      stale,
      `these are no longer orphans — remove them from KNOWN_ORPHANS:\n${stale.join("\n")}`,
    ).toEqual([]);
  });
});

describe("the walk starts where the app starts, and nowhere else", () => {
  /**
   * The single assertion this whole file rests on. Every one of the ten had
   * passing tests; seeding reachability with them makes the guard agree with
   * itself and catch nothing.
   */
  it("no test file is an entrypoint", () => {
    const { files } = importGraph();
    const tests = files.filter(isTestModule);
    expect(tests.length).toBeGreaterThan(300);
    expect(tests.filter((f) => isAppEntrypoint(f) || isToolEntrypoint(f))).toEqual([]);
  });

  it("an edge function's index.ts is an entrypoint and its siblings are not", () => {
    expect(isAppEntrypoint("supabase/functions/send-push/index.ts")).toBe(true);
    expect(isAppEntrypoint("supabase/functions/_shared/push.ts")).toBe(false);
    expect(isAppEntrypoint("supabase/functions/send-push/helper.ts")).toBe(false);
  });
});

describe("the resolver is sound, because a missed edge invents an orphan", () => {
  it("resolves enough to place most of the repo, and reaches a known-live module", () => {
    const { shipped } = reachability(importGraph());
    expect(shipped.size).toBeGreaterThan(500);
    // Reached only through `_shared/`, which is the shape the whole guard turns on.
    expect(shipped.has("supabase/functions/_shared/voiceReplication.ts")).toBe(true);
    expect(shipped.has("src/lib/securityHeaders.ts")).toBe(true);
  });

  /**
   * An unresolved specifier is a silent false orphan: the edge vanishes and
   * whatever it pointed at looks callerless. Six exist and every one is a test
   * reaching a `.mjs` outside these trees, a deliberately absent red-team
   * fixture, or `sourceText.ts`'s own documentation example — so NONE comes
   * from a module that ships, and that is the claim worth pinning.
   */
  it("nothing that ships has an import this graph could not follow", () => {
    const graph = importGraph();
    const { shipped } = reachability(graph);
    const fromShipped = graph.unresolved.filter((u) => shipped.has(u.from));
    expect(fromShipped).toEqual([]);
    expect(graph.unresolved.length).toBeLessThanOrEqual(8);
  });
});

describe("the three ways of having a caller are all load-bearing", () => {
  /**
   * A script is a real caller — the §21 benchmark harness is run by hand and
   * is not dead. Calling it an orphan would be false, and the falsehood would
   * teach whoever reads this list to stop believing it.
   */
  it("tooling-only modules exist and are not reported as orphans", () => {
    const { tooling, shipped, orphans } = reachability(importGraph());
    const toolingOnly = [...tooling].filter((f) => !shipped.has(f) && !isToolEntrypoint(f));
    expect(toolingOnly.length).toBeGreaterThan(20);
    expect(toolingOnly.some((f) => f.startsWith("src/lib/cognitive/"))).toBe(true);
    expect(orphans.filter((f) => toolingOnly.includes(f))).toEqual([]);
  });

  /**
   * A mirror copies rather than imports, so no edge exists to find. Derived
   * per FILE from the twin's CONTENT: 26 of OQCA's 40 unreferenced modules are
   * mirror sources and 14 are genuinely callerless. A blanket `src/oqca/`
   * exclusion would have hidden those 14 — which are precisely the v1.0/v1.1
   * research kernel CLAUDE.md says has no caller.
   */
  it("a mirror source is reachable and a mirror-less sibling is not", () => {
    const { mirrored } = reachability(importGraph());
    expect(mirrored.has("src/oqca/quantum/math/state.ts")).toBe(true);
    expect(mirrored.has("src/oqca/gates.ts")).toBe(false);
    expect(KNOWN_ORPHANS).toContain("src/oqca/gates.ts");
    expect(mirrored.has("src/lib/push.ts")).toBe(false);
  });

  /**
   * BOTH MIRRORS, NOT ONE. The rule was a path convention until 2026-09-12 and
   * it knew only `src/oqca/`; `src/health/consent.ts` and `retention.ts` say
   * "MIRRORED byte for byte" in their own headers, their twins are imported by
   * the deployed `health-api` and `health-ai`, and both sat on the frozen list
   * regardless. Asserting one mirror would have passed the whole time.
   */
  it("the health mirror is recognised as well as the OQCA one", () => {
    const { mirrored } = reachability(importGraph());
    expect(mirrored.has("src/health/consent.ts")).toBe(true);
    expect(mirrored.has("src/health/retention.ts")).toBe(true);
    expect(KNOWN_ORPHANS).not.toContain("src/health/consent.ts");
  });

  /**
   * THE RULE IS ONLY SAFE BECAUSE IDENTICAL BYTES ARE NOT A COINCIDENCE. Two
   * unrelated modules that happened to match would let a shipped file vouch
   * for a dead one. Measured: every duplicate-content group in the repo is a
   * `src/X` <-> `_shared/X` pair, and this fails the day one is not.
   */
  it("every byte-identical pair is a mirror pair, so nothing vouches by accident", () => {
    const graph = importGraph();
    const groups = [...contentKeys(graph.files).values()].filter((g) => g.length > 1);
    expect(groups.length).toBeGreaterThan(20);
    for (const g of groups) {
      const src = g.filter((f) => f.startsWith("src/"));
      const shared = g.filter((f) => f.startsWith("supabase/functions/_shared/"));
      expect(g.length, g.join(" ")).toBe(2);
      expect(src.length, g.join(" ")).toBe(1);
      expect(shared.length, g.join(" ")).toBe(1);
      expect(shared[0].endsWith(src[0].slice("src/".length)), g.join(" ")).toBe(true);
    }
  });
});

describe("BY_DESIGN is narrow, and both prefixes still do work", () => {
  it("each prefix suppresses real entries, so neither is decoration", () => {
    const raw = reachability(importGraph()).orphans;
    for (const prefix of BY_DESIGN) {
      expect(raw.filter((f) => f.startsWith(prefix)).length, prefix).toBeGreaterThan(0);
    }
  });

  it("it exempts directories, never whole trees", () => {
    // `src/components/` at large is NOT exempt — only the vendored subtree.
    expect(BY_DESIGN).not.toContain("src/components/");
    expect(BY_DESIGN).not.toContain("src/");
    expect(KNOWN_ORPHANS.some((f) => f.startsWith("src/components/m3/"))).toBe(true);
  });
});
