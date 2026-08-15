import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_NARRATION_CHARS,
  MAX_PROMPT_CHARS,
  VERBATIM_MAX_FILL,
  VERBATIM_MAX_SECONDS,
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
// TWO MIGRATIONS, TWO JOBS. The verbatim one ADDS the column; the cap one
// carries the LIVE definition of claim_story_seconds. Function behaviour is
// pinned against the newest file on purpose — asserting the superseded copy
// would keep passing while production disagreed with it.
const VERBATIM_MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/20260814160000_verbatim_mode.sql"),
  "utf8",
);
const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/20260814190000_prompt_cap_5000.sql"),
  "utf8",
);
const STUDIO_SRC = readFileSync(join(ROOT, "src/components/stories/StoryStudio.tsx"), "utf8");

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

  /**
   * THE PROMISE, MECHANISED. Verbatim mode says the user's words reach the
   * narrator untouched. Since the packer may now CUT a sentence to fill a
   * shot, that promise needs a test rather than a comment: whatever the
   * shot count, the words that come out must be the words that went in, in
   * the same order, with nothing added, dropped or reordered.
   */
  it("never loses, adds or reorders a word, however it slices", () => {
    const words = (t: string) => t.split(/\s+/).filter(Boolean);
    const texts = [
      STORY,
      "He walked, slowly, into the dark. She followed; the lamp guttered out.",
      // No clause marks anywhere — forces the word-boundary fallback.
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango.",
      // Long sentences, few of them — the shape that used to be refused.
      Array.from(
        { length: 6 },
        (_, i) => Array.from({ length: 30 }, (_, j) => `w${i}x${j}`).join(" ") + ".",
      ).join(" "),
    ];
    for (const text of texts) {
      for (let shots = 1; shots <= 24; shots++) {
        const chunks = packNarrations(text, shots);
        if (!chunks) continue;
        expect(chunks.length, `shot count ${shots}`).toBe(shots);
        expect(
          chunks.every((c) => c.trim().length > 0),
          "an empty narration",
        ).toBe(true);
        expect(words(chunks.join(" ")), `words changed at ${shots} shots`).toEqual(words(text));
      }
    }
  });

  it("slices long sentences instead of refusing a story that fits", () => {
    // Measured 2026-08-15: 600 words across 40 sentences reads as 240s of
    // speech, sits inside the 300s band, and was refused because that tier
    // plans 43 shots. Needing 43 sentences is an artifact of the shot count,
    // not a fact about the story.
    const forty = Array.from(
      { length: 40 },
      (_, i) => Array.from({ length: 15 }, (_, j) => `s${i}w${j}`).join(" ") + ".",
    ).join(" ");
    const chunks = packNarrations(forty, 43);
    expect(chunks, "a story that fits the seconds bought is still refused").not.toBeNull();
    expect(chunks?.length).toBe(43);
    // A clause mark is preferred over a bare word boundary.
    const clausey = "One, two, three, four, five, six, seven, eight, nine, ten.";
    const two = packNarrations(clausey, 2);
    expect(two?.[0].endsWith(",")).toBe(true);
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
    // whitespace word count by 2.5 and tests against [0.5x, 1.25x] — with
    // the review panel's three alignment fixes pinned: empty tokens
    // filtered (Postgres trim only strips spaces), NBSP normalized (JS \\s
    // matches it, Postgres' does not), and the 300s tier refused outright.
    expect(MIGRATION).toContain("/ 2.5");
    expect(MIGRATION).toContain("wanted * 0.5");
    expect(MIGRATION).toContain("wanted * 1.25");
    expect(MIGRATION).toContain("where w <> ''");
    expect(MIGRATION).toContain("translate(prompt_clean, chr(160), ' ')");
    expect(MIGRATION).toContain("wanted > 600");
    expect(VERBATIM_MIN_FILL).toBe(0.5);
    expect(VERBATIM_MAX_FILL).toBe(1.25);
    expect(VERBATIM_MAX_SECONDS).toBe(600);
    expect(MODULE_SRC).toContain("SPOKEN_WORDS_PER_SECOND = 2.5");
    // The 300s tier is REACHABLE now — that is the point of the raise. 400
    // words is 160s of speech, which sits inside 300s' [150, 375] band.
    expect(verbatimFits("word ".repeat(400).trim(), 300).fits).toBe(true);
    // Past the platform ceiling it still refuses, and still says so.
    expect(verbatimFits("word ".repeat(400).trim(), 900).fits).toBe(false);
    expect(verbatimFits("word ".repeat(400).trim(), 900).reason).toContain("600");
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
    expect(VERBATIM_MIGRATION).toContain("add column if not exists verbatim boolean");
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
      WORKER_SRC.includes("verbatim: dialogue disabled"),
      "verbatim dialogue must be dropped entirely — kept lines were spoken twice",
    ).toBe(true);
    expect(
      PLOT_SRC.includes("narrator reads every word"),
      "the planner is no longer told to skip dialogue in verbatim mode",
    ).toBe(true);
    expect(
      PLOT_SRC.includes("A narration piece is too long."),
      "the narrations field lost its per-item cap",
    ).toBe(true);
    // Pin the MECHANISM, not the wording. This used to assert the refusal
    // copy ("needs at least …"), which broke the moment the copy was
    // corrected — and a test that fails on a wording fix teaches people to
    // edit the test instead of reading it. What must hold is that the packer
    // actually runs in the studio's gate, before any debit.
    expect(
      STUDIO_SRC.includes("packNarrations(prompt.trim(), plan.shots.length)"),
      "the studio no longer gates the toggle on packability before the debit",
    ).toBe(true);
    expect(PLOT_SRC).toContain("Narration count must match the shot count.");
    // Owner directive, 2026-08-14: Ting stays the content filter even when
    // the words are the user's — checked BEFORE a plan is written, and
    // FAILING CLOSED, because unchecked audio under the ONIQ mark is the
    // one thing verbatim mode must never produce.
    expect(
      PLOT_SRC.includes("CONTENT_GATE_SYSTEM"),
      "the verbatim content gate is gone — user words would reach the voice unchecked",
    ).toBe(true);
    expect(
      PLOT_SRC.includes("if (narrations.length > 0) {") &&
        PLOT_SRC.indexOf("CONTENT_GATE_SYSTEM") > 0,
      "the gate no longer runs on the verbatim path",
    ).toBe(true);
    expect(
      PLOT_SRC.includes("The story check is unavailable right now"),
      "the gate no longer fails closed when it cannot run",
    ).toBe(true);
    expect(
      PLOT_SRC.includes("if (narrations.length === shots) sp.beats = narrations;"),
      "long films' spine path no longer carries the user's own beats",
    ).toBe(true);
    expect(STUDIO_SRC).toContain("_verbatim: true");
    expect(STUDIO_SRC).toContain("aria-pressed={verbatim}");
  });
});

/**
 * The refusal the owner actually hit, 2026-08-14.
 *
 * A ~330-word story pasted onto the 60s tier is roughly twice the speech the
 * purchase can hold, so the toggle greys out — correctly. What it did NOT do
 * was say that the SAME text fits the 2 min tier, which left "My words"
 * looking broken rather than unfitted. These pin the arithmetic that makes
 * the "Switch to 2 min" suggestion true, so the suggestion can never start
 * pointing at a tier that would refuse a second time.
 */
describe("the tier suggestion", () => {
  // 328 words — the measured length of the owner's pasted story, which the
  // 2000-character box had already truncated to exactly its ceiling.
  const story = Array.from({ length: 328 }, (_, i) => `word${i}`).join(" ");

  it("refuses the picked 60s tier and accepts 120s for the same text", () => {
    expect(estimateSpokenSeconds(story)).toBeCloseTo(131.2, 1);
    expect(verbatimFits(story, 60).fits, "60s should be over the ceiling").toBe(false);
    expect(verbatimFits(story, 120).fits, "120s should sit inside the band").toBe(true);
  });

  it("keeps 30s and the 300s tier out of the suggestion's reach", () => {
    expect(verbatimFits(story, 30).fits, "30s is far over the ceiling").toBe(false);
    // 300s is no longer barred by the ceiling — since the cap went to 5000
    // it is reachable in principle. This story is simply too short for it:
    // 131s of speech against a 150s floor.
    expect(verbatimFits(story, 300).fits).toBe(false);
    expect(verbatimFits(story, 300).reason).toContain("too short");
    expect(300).toBeLessThanOrEqual(VERBATIM_MAX_SECONDS);
  });

  it("still ships the studio's one-tap way out of the refusal", () => {
    expect(STUDIO_SRC).toContain("verbatimTierFix");
    expect(
      STUDIO_SRC.includes("onClick={() => setSeconds(verbatimTierFix)}"),
      "the suggestion no longer changes the tier when tapped",
    ).toBe(true);
    expect(
      STUDIO_SRC.includes("MAX_PROMPT_CHARS"),
      "the paste-was-cut warning lost its shared ceiling",
    ).toBe(true);
  });
});

/**
 * The prompt cap, in every place that quotes it.
 *
 * Owner directive, 2026-08-14: 2000 -> 5000. Four copies enforce it — the
 * textarea, the claim RPC, story-plot's own guard, and the constant they are
 * all supposed to mirror. They fail in different directions when they drift:
 * a client cap ABOVE the RPC's rejects a story the user already typed, and a
 * story-plot cap BELOW the RPC's fails a job the claim already CHARGED for.
 * So they are pinned together rather than trusted to stay equal.
 */
describe("the prompt cap", () => {
  it("is 5000 and says so everywhere", () => {
    expect(MAX_PROMPT_CHARS).toBe(5000);
    expect(MIGRATION, "the claim RPC is the copy that cannot be bypassed").toContain(
      "length(prompt_clean) > 5000",
    );
    const plot = /const MAX_PROMPT = (\d+)/.exec(PLOT_SRC);
    expect(plot, "story-plot lost its MAX_PROMPT").not.toBeNull();
    expect(Number(plot![1]), "story-plot would refuse a prompt the claim already charged for").toBe(
      MAX_PROMPT_CHARS,
    );
    // The studio must not carry a literal of its own any more.
    expect(STUDIO_SRC).toContain("MAX_PROMPT_CHARS");
    expect(STUDIO_SRC).toContain("maxLength={MAX_PROMPT_CHARS}");
  });

  it("makes every tier on sale reachable, which was the point", () => {
    // A tier is reachable only if its floor can be spoken by a story the box
    // can hold: 5000 chars is ~833 words at ~6 chars/word, ~333s at 2.5 wps.
    const maxSpokenSeconds = MAX_PROMPT_CHARS / 6 / 2.5;
    for (const tier of [30, 60, 120, 300]) {
      expect(
        tier * VERBATIM_MIN_FILL,
        `the ${tier}s tier's floor cannot be reached inside the prompt cap`,
      ).toBeLessThanOrEqual(maxSpokenSeconds);
      expect(tier).toBeLessThanOrEqual(VERBATIM_MAX_SECONDS);
    }
    // The 300s tier specifically — unreachable at 2000, reachable now.
    expect(300 * VERBATIM_MIN_FILL).toBeGreaterThan(2000 / 6 / 2.5);
  });
});
