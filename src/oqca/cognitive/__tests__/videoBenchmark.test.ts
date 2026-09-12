/**
 * THE BENCHMARK MUST NOT BE ABLE TO FLATTER ITS SUBJECT.
 *
 * Every assertion here is about the SCORER, not the kernel — because a
 * benchmark whose scoring is wrong produces a number that is worse than no
 * number, and this repo has a receipt for exactly that (the v1.0 OQCA fixture
 * that was solvable by "always name the first hypothesis").
 */
import { describe, expect, it } from "vitest";

import {
  ERROR_SURFACES,
  GROUND_TRUTH,
  baselineDiagnosis,
  score,
} from "../../../lib/cognitive/videoIncidentBenchmark.ts";

const opts = { elapsedMs: 1, inputTokens: 0, outputTokens: 0 };

describe("the §22 baseline is a real diagnostician, and it is wrong", () => {
  it("ranks by volume and therefore blames the loudest unrelated surface", () => {
    expect(baselineDiagnosis()).toMatch(/send-push/);
  });

  it("scores zero causes, so the kernel has something honest to beat", () => {
    const s = score(baselineDiagnosis(), [], opts);
    expect(s.causesFound).toEqual([]);
    expect(s.falsePositives).toContain("send_push");
  });
});

describe("a cause counts only when the CONCLUSION names it", () => {
  it("reading the row is not finding it: tool calls alone score nothing", () => {
    const s = score("I looked at several tables.", ["db.error_detail:story-dispatch"], opts);
    expect(s.causesFound).toEqual([]);
    expect(s.causesMissed).toEqual(["dispatch_credential", "voice_unavailable"]);
  });

  it("naming both causes scores both", () => {
    const s = score(
      "story-dispatch gets a 401 from GitHub on GITHUB_DISPATCH_TOKEN, and separately a film failed because the in-house TTS was unavailable.",
      [],
      opts,
    );
    expect([...s.causesFound].sort()).toEqual(["dispatch_credential", "voice_unavailable"]);
    expect(s.falsePositives).toEqual([]);
  });

  it("stopping at the first cause is a MISS, not a pass", () => {
    const s = score("The root cause is a 401 from GitHub.", [], opts);
    expect(s.causesFound).toEqual(["dispatch_credential"]);
    expect(s.causesMissed).toEqual(["voice_unavailable"]);
  });

  it("naming a distractor is a false positive even alongside a real cause", () => {
    const s = score("A 401 from GitHub, and the send-push failures.", [], opts);
    expect(s.causesFound).toContain("dispatch_credential");
    expect(s.falsePositives).toContain("send_push");
  });
});

describe("irrelevant work is counted, and listing is not irrelevant", () => {
  /**
   * THE FIXTURE HELD THE SAME BUG AS THE CODE. This test used the DOTTED tool
   * names, and so did the scorer's pattern — so when the tools were renamed to
   * underscores (OpenAI rejects dots), test and implementation drifted together
   * and stayed green while the metric reported 0 for every real run. A test
   * that shares its subject's mistake cannot see it; the names here are the
   * ones the registry actually builds.
   */
  it("asking for a distractor's DETAIL is a deliberate detour", () => {
    const s = score("x", ["db_error_detail:send-push", "db_error_detail:chat-viewport"], opts);
    expect(s.irrelevantToolCalls).toBe(2);
  });

  it("listing the surfaces is how anyone starts and is never penalised", () => {
    const s = score("x", ["db.error_surfaces", "db.job_counts", "db.job_errors"], opts);
    expect(s.irrelevantToolCalls).toBe(0);
  });

  it("asking for the RELEVANT surface's detail is not irrelevant", () => {
    const s = score("x", ["db.error_detail:story-dispatch"], opts);
    expect(s.irrelevantToolCalls).toBe(0);
  });
});

describe("the fixture keeps its traps", () => {
  it("the loudest error surface is NOT one of the causes", () => {
    const loudest = [...ERROR_SURFACES.rows].sort((a, b) => Number(b.value) - Number(a.value))[0];
    expect(loudest.key).toBe("send-push");
    const causeIds: readonly string[] = GROUND_TRUTH.causes.map((c) => c.id);
    expect(causeIds).not.toContain("send_push");
  });

  it("there are two independent causes, so one answer cannot be complete", () => {
    expect(GROUND_TRUTH.causes).toHaveLength(2);
  });
});

describe("the scorer's own metrics must be able to fire", () => {
  /**
   * THE METRIC THAT COULD NOT FIRE. `irrelevantToolCalls` matched
   * `db.error_detail:` with a DOT long after the tools were renamed to
   * underscores, so it reported 0 on every run — including one that genuinely
   * asked a distractor for its detail. A check that has never been non-zero has
   * never been tested, and this one read as a clean result for both frontier
   * arms. Asserted in BOTH directions so a future rename goes red instead of
   * silently zeroing again.
   */
  it("counts a distractor's detail call as irrelevant", () => {
    const s = score("anything", ["db_error_detail:share-video"], {
      elapsedMs: 1,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(s.irrelevantToolCalls).toBe(1);
  });

  it("does not count the real surface's detail, or a plain listing, as irrelevant", () => {
    const s = score("anything", ["db_error_detail:story-dispatch", "db_error_surfaces"], {
      elapsedMs: 1,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(s.irrelevantToolCalls).toBe(0);
  });

  /**
   * NAMED IS NOT BLAMED. gpt-6-astra wrote that the story-still errors
   * "establish frame-generation failures, but not their underlying cause" — a
   * refusal to attribute — and scored identically to an assertion. The number
   * is kept because naming a distractor at all is worth seeing; the LIMIT is
   * pinned here so nobody reads it as a wrongness count.
   */
  it("reports a distractor merely named, and cannot tell that from blamed", () => {
    const careful = score("story-still 502s are unexplained, not a root cause", [], {
      elapsedMs: 1,
      inputTokens: 0,
      outputTokens: 0,
    });
    const blaming = score("the root cause is story-still", [], {
      elapsedMs: 1,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(careful.falsePositives).toEqual(blaming.falsePositives);
  });
});
