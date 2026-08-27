// Story drafts — the structured story kept WITHOUT a render (mega loop,
// 2026-08-27). These tests pin the §13 story matrix: structured output
// validates, malformed output is rejected, characters extract and link to
// scenes, and the module itself is incapable of starting anything paid.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_DRAFTS,
  MAX_DRAFT_SHOTS,
  castInShot,
  deleteDraft,
  listDrafts,
  parseStoryPlan,
  saveDraft,
  shotsFeaturing,
  type StoryDraftPlan,
} from "@/lib/storyDrafts";

const MEERA = {
  name: "Meera",
  lock: "a nine-year-old girl, small and quick, black hair in two braids, red scarf",
};

function goodPlan(): Record<string, unknown> {
  return {
    title: "The Door in the Banyan",
    logline: "A girl finds a door in the roots of a banyan tree.",
    setting: "A monsoon village at dusk, warm lamplight, teal shadows.",
    cast: [MEERA],
    shots: [
      {
        still: `Wide: ${MEERA.lock} stands before enormous banyan roots. A monsoon village at dusk.`,
        narration: "Meera had walked past the old banyan a thousand times.",
        motion: "Very slow push in.",
      },
      {
        still:
          "Extreme close / insert: a small brass handle set between the roots, rain beading on it.",
        narration: "But tonight, the roots held a handle.",
        vfx: "rain streaking past, surfaces glistening",
      },
      {
        still: "Close: the door ajar, warm light spilling out onto wet earth.",
        narration: "And the handle turned.",
        dialogue: { speaker: "Meera", line: "Hello?" },
      },
    ],
  };
}

describe("parseStoryPlan — structured output validates", () => {
  it("accepts the full grammar and keeps every declared field", () => {
    const plan = parseStoryPlan(goodPlan());
    expect(plan).not.toBeNull();
    expect(plan!.title).toBe("The Door in the Banyan");
    expect(plan!.cast).toEqual([MEERA]);
    expect(plan!.shots).toHaveLength(3);
    expect(plan!.shots[0].motion).toBe("Very slow push in.");
    expect(plan!.shots[1].vfx).toContain("rain");
    expect(plan!.shots[2].dialogue).toEqual({ speaker: "Meera", line: "Hello?" });
  });

  it("strips unknown fields — the draft holds the contract, not the reply", () => {
    const raw = goodPlan();
    (raw as Record<string, unknown>).budget = "$9999";
    (raw.shots as Record<string, unknown>[])[0].gpu = "H100";
    const plan = parseStoryPlan(raw) as unknown as Record<string, unknown>;
    expect(plan).not.toBeNull();
    expect("budget" in plan).toBe(false);
    expect("gpu" in (plan.shots as Record<string, unknown>[])[0]).toBe(false);
  });

  it("rejects malformed stories rather than storing them half-broken", () => {
    expect(parseStoryPlan(null)).toBeNull();
    expect(parseStoryPlan("a story")).toBeNull();
    expect(parseStoryPlan({ ...goodPlan(), title: "" })).toBeNull();
    expect(parseStoryPlan({ ...goodPlan(), cast: "Meera" })).toBeNull();
    expect(parseStoryPlan({ ...goodPlan(), shots: [] })).toBeNull();
    const noNarration = goodPlan();
    (noNarration.shots as Record<string, unknown>[])[1] = { still: "Close: a handle." };
    expect(parseStoryPlan(noNarration)).toBeNull();
    const badCast = goodPlan();
    badCast.cast = [{ name: "Meera" }];
    expect(parseStoryPlan(badCast)).toBeNull();
  });

  it("bounds what a reply can claim to be", () => {
    const bloated = goodPlan();
    bloated.shots = Array.from({ length: MAX_DRAFT_SHOTS + 1 }, () => ({
      still: "Wide: a field.",
      narration: "And on it went.",
    }));
    expect(parseStoryPlan(bloated)).toBeNull();
  });
});

describe("character extraction — story requirement, not visual asset", () => {
  it("links a character to the shots that carry their lock, name, or line", () => {
    const plan = parseStoryPlan(goodPlan())!;
    // Shot 0 repeats the lock verbatim; shot 2 has Meera speaking. Shot 1 is
    // coverage — a handle, nobody legible — and must NOT be linked.
    expect(shotsFeaturing(plan, MEERA)).toEqual([0, 2]);
    expect(castInShot(plan, 0)).toEqual([MEERA]);
    expect(castInShot(plan, 1)).toEqual([]);
  });

  it("a character in no shot is a valid answer, not an error", () => {
    const plan = parseStoryPlan(goodPlan())!;
    expect(
      shotsFeaturing(plan, { name: "Ravi", lock: "a tall boatman in an indigo shawl" }),
    ).toEqual([]);
  });
});

describe("the draft store", () => {
  let bag: Record<string, string>;
  beforeEach(() => {
    bag = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => bag[k] ?? null,
      setItem: (k: string, v: string) => {
        bag[k] = v;
      },
      removeItem: (k: string) => {
        delete bag[k];
      },
    });
  });

  it("keeps a validated story and lists it newest first", () => {
    const d = saveDraft("A girl finds a door in a banyan tree", 60, goodPlan());
    expect(d).not.toBeNull();
    const listed = listDrafts();
    expect(listed).toHaveLength(1);
    expect(listed[0].plan.title).toBe("The Door in the Banyan");
    expect(listed[0].seconds).toBe(60);
  });

  it("refuses to store a malformed story", () => {
    expect(saveDraft("prompt", 60, { title: "no shots" })).toBeNull();
    expect(listDrafts()).toHaveLength(0);
  });

  it("is a library, not a database — bounded at the cap", () => {
    for (let i = 0; i < MAX_DRAFTS + 3; i++) {
      const p = goodPlan();
      p.title = `Story ${i}`;
      expect(saveDraft(`prompt ${i}`, 60, p)).not.toBeNull();
    }
    const listed = listDrafts();
    expect(listed).toHaveLength(MAX_DRAFTS);
    expect(listed[0].plan.title).toBe(`Story ${MAX_DRAFTS + 2}`);
  });

  it("deletes one draft and leaves the rest", () => {
    const a = saveDraft("one", 60, goodPlan())!;
    const b = saveDraft("two", 60, goodPlan())!;
    deleteDraft(a.id);
    expect(listDrafts().map((d) => d.id)).toEqual([b.id]);
  });
});

describe("no implicit cascade — the module is pure", () => {
  it("storyDrafts imports no network, no supabase, no RPC surface", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { stripComments } = await import("@/test/sourceText");
    const src = stripComments(readFileSync(join(process.cwd(), "src/lib/storyDrafts.ts"), "utf8"));
    expect(src).not.toContain("supabase");
    expect(src).not.toContain("fetch(");
    expect(src).not.toContain("rpc(");
    expect(src).not.toContain("invoke(");
  });
});

// Type-level guard: the plan type carries no identity fields to fill in.
const _planShape: StoryDraftPlan = {
  title: "t",
  logline: "l",
  setting: "s",
  cast: [{ name: "n", lock: "free prose only" }],
  shots: [{ still: "s", narration: "n" }],
};
void _planShape;
