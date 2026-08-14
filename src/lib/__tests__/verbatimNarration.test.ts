import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_NARRATION_CHARS,
  VERBATIM_MAX_FILL,
  VERBATIM_MIN_FILL,
  estimateSpokenSeconds,
  packNarrations,
  sentencesOf,
  verbatimFits,
} from "@/lib/verbatimNarration";

const ROOT = join(__dirname, "../../..");
const MODULE_SRC = readFileSync(join(ROOT, "src/lib/verbatimNarration.ts"), "utf8");
const WORKER_SRC = readFileSync(join(ROOT, "remotion/scripts/story-worker.mjs"), "utf8");
const PLOT_SRC = readFileSync(join(ROOT, "supabase/functions/story-plot/index.ts"), "utf8");
const VOICE_SRC = readFileSync(join(ROOT, "supabase/functions/story-voice/index.ts"), "utf8");
const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/20260814160000_verbatim_mode.sql"),
  "utf8",
);
const STUDIO_SRC = readFileSync(
  join(ROOT, "src/components/stories/StoryStudio.tsx"),
  "utf8",
);

const STORY = [
  "The lighthouse keeper counted ships the way other men counted debts.",
  "On the ninth night, a ship with black sails refused his light.",
  "He rowed out alone, lantern in his teeth, against the running tide.",
  "The hull bore no name, and the deck held no crew.",
  "Only a letter, nailed to the mast, addressed to him by name.",
  "He read it twice, and then he put out his own light forever.",
].join(" ");

/**
 * Verbatim mode's one promise: the user's words reach the narrator's mouth
 * untouched. The packer's invariants ARE that promise, mechanically.
 */
describe("the verbatim packer", () => {
  it("reproduces the input exactly — order, words, punctuation", () => {
    for (const shots of [1, 2, 3, 6]) {
      const chunks = packNarrations(STORY, shots);
      expect(chunks, `${shots} shots`).not.toBeNull();
      expect(chunks).toHaveLength(shots);
      expect(chunks?.join(" ")).toBe(STORY);
      for (const c of chunks ?? []) {
        expect(c.length).toBeGreaterThan(0);
        expect(c.length).toBeLessThanOrEqual(MAX_NARRATION_CHARS);
      }
    }
  });

  it("balances spoken length instead of counting sentences", () => {
    const lopsided =
      "Rain. Rain. Rain. " +
      "Then the caravan master stood and spoke for a long while about the road ahead, " +
      "the wells that had gone dry, and the price of water in the towns beyond the pass.";
    const chunks = packNarrations(lopsided, 2);
    expect(chunks).not.toBeNull();
    // The three tiny sentences must huddle together; giving the long
    // closing sentence company would double one shot's clock.
    expect(chunks?.[0]).toBe("Rain. Rain. Rain.");
  });

  it("refuses what it cannot honestly slice", () => {
    expect(packNarrations("One sentence only.", 3)).toBeNull();
    expect(packNarrations("", 2)).toBeNull();
    expect(packNarrations(STORY, 0)).toBeNull();
    // A single unbroken monster sentence splits under the TTS ceiling when
    // the shot count allows it — and REFUSES when no packing could stay
    // under the ceiling, rather than shipping a chunk the voice rejects.
    const monster = "word ".repeat(600).trim() + ".";
    expect(packNarrations(monster, 2)).toBeNull();
    const chunks = packNarrations(monster, 3);
    expect(chunks).not.toBeNull();
    for (const c of chunks ?? []) expect(c.length).toBeLessThanOrEqual(MAX_NARRATION_CHARS);
  });

  it("keeps quoted dialogue attached to its sentence", () => {
    const quoted = 'He said, "Stay away from the well." She did not listen.';
    expect(sentencesOf(quoted)).toEqual([
      'He said, "Stay away from the well."',
      "She did not listen.",
    ]);
  });
});

describe("the fit band — the pricing guard", () => {
  it("refuses too-short and too-long, passes the honest middle", () => {
    const sixtySecondsOfWords = "word ".repeat(150).trim(); // 150w / 2.5wps = 60s
    expect(verbatimFits(sixtySecondsOfWords, 60).fits).toBe(true);
    expect(verbatimFits("A tiny tale.", 60).fits).toBe(false);
    expect(verbatimFits("word ".repeat(400).trim(), 60).fits).toBe(false);
    expect(estimateSpokenSeconds(sixtySecondsOfWords)).toBeCloseTo(60, 5);
  });

  it("mirrors the claim RPC's SQL band exactly", () => {
    // Client and server must refuse the same stories. The SQL divides a
    // whitespace word count by 2.5 and tests against [0.5x, 1.25x].
    expect(MIGRATION).toContain("/ 2.5");
    expect(MIGRATION).toContain("wanted * 0.5");
    expect(MIGRATION).toContain("wanted * 1.25");
    expect(VERBATIM_MIN_FILL).toBe(0.5);
    expect(VERBATIM_MAX_FILL).toBe(1.25);
    expect(MODULE_SRC).toContain("SPOKEN_WORDS_PER_SECOND = 2.5");
  });

  it("keeps chunks under the voice function's own ceiling", () => {
    const m = VOICE_SRC.match(/MAX_TEXT = (\d+)/);
    expect(m).not.toBeNull();
    expect(MAX_NARRATION_CHARS).toBeLessThanOrEqual(Number(m?.[1]));
  });
});

describe("the wiring pins", () => {
  it("stays zero-import, worker-loadable", () => {
    expect(MODULE_SRC).not.toMatch(/^import /m);
  });

  it("the whole chain carries the flag: claim, callback, worker, planner, studio", () => {
    expect(MIGRATION).toContain("_verbatim boolean default false");
    expect(MIGRATION).toContain("add column if not exists verbatim boolean");
    expect(
      readFileSync(join(ROOT, "supabase/functions/story-callback/index.ts"), "utf8"),
    ).toContain("verbatim: job.verbatim === true");
    expect(WORKER_SRC).toContain("packNarrations(job.prompt, shots)");
    expect(
      WORKER_SRC.includes("verbatimChunks ? { narrations: verbatimChunks }"),
      "the worker no longer hands the slices to the planner",
    ).toBe(true);
    expect(
      WORKER_SRC.includes("plan.shots[i].narration = verbatimChunks[i]"),
      "the worker no longer ENFORCES the user's words over Ting's echo",
    ).toBe(true);
    expect(
      WORKER_SRC.includes("dropped invented dialogue"),
      "invented dialogue would speak words the user never wrote",
    ).toBe(true);
    expect(PLOT_SRC).toContain("Narration count must match the shot count.");
    expect(
      PLOT_SRC.includes("if (narrations.length === shots) sp.beats = narrations;"),
      "long films' spine path no longer carries the user's own beats",
    ).toBe(true);
    expect(STUDIO_SRC).toContain("_verbatim: true");
    expect(STUDIO_SRC).toContain("aria-pressed={verbatim}");
  });
});
