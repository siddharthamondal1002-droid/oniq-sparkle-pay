/**
 * COMPACT VERBATIM SPINE — the fix for the 300s / 43-shot 502.
 *
 * A >12-shot film takes the two-stage spine path: Claude writes a skeleton,
 * then batches expand it. In VERBATIM mode the beats are replaced wholesale by
 * the user's own narrations (`sp.beats = narrations`), so a full 43-beat spine
 * is generated only to be thrown away — and that discarded generation is what
 * overran the 45s spine budget and 502'd the job (both engines "timeout").
 *
 * The fix: for verbatim films the spine writes ONLY the structural locks the
 * batches copy — title, logline, setting, cast — and NO beats. The narrations
 * become the beats. Non-verbatim films are untouched.
 *
 * story-plot is a Deno function that cannot be imported here, so these pin the
 * mechanism at source, the same way verbatimNarration.test.ts pins the rest of
 * this path. The live 300s/43-shot end-to-end run is the acceptance test the
 * fix directive runs separately; it is not claimed here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PLOT = readFileSync(join(ROOT, "supabase/functions/story-plot/index.ts"), "utf8");

const spineBlock = PLOT.slice(
  PLOT.indexOf("LONG FILMS TAKE THE TWO-STAGE PATH"),
  PLOT.indexOf("if (!plan && hasClaude && shots <= SINGLE_CALL_RESCUE_MAX_SHOTS)"),
);
const verbatimSystem = PLOT.slice(
  PLOT.indexOf("const SPINE_SYSTEM_VERBATIM = ["),
  PLOT.indexOf("].join", PLOT.indexOf("const SPINE_SYSTEM_VERBATIM = [")),
);
const parser = PLOT.slice(
  PLOT.indexOf("function parseSpineStructure("),
  PLOT.indexOf("function movieFields("),
);

describe("A/B — the verbatim path takes the compact spine (any shot count > 12)", () => {
  it("branches the spine on verbatim and swaps in the compact system prompt", () => {
    expect(spineBlock).toContain("const isVerbatim = narrations.length === shots;");
    expect(spineBlock).toMatch(/isVerbatim \? SPINE_SYSTEM_VERBATIM : SPINE_SYSTEM/);
  });

  it("the verbatim spine request explicitly forbids beats/shots/scene text", () => {
    expect(spineBlock).toMatch(/isVerbatim[\s\S]*do NOT[\s\S]*write beats, shots, or scene text/);
    // The non-verbatim request is unchanged and still asks for beats.
    expect(spineBlock).toContain("Return exactly ${shots} beats.");
  });

  it("the compact system schema has NO beats field yet locks every downstream field", () => {
    expect(verbatimSystem).not.toContain('"beats"');
    expect(verbatimSystem).toContain("Do NOT write beats");
    for (const field of ['"title"', '"logline"', '"setting"', '"cast"', '"name"', '"lock"']) {
      expect(verbatimSystem, `compact spine must still lock ${field}`).toContain(field);
    }
  });
});

describe("F — the user's narration is authoritative and passes through untouched", () => {
  it("parseSpineStructure writes the narrations straight in as the beats", () => {
    expect(parser).toContain("beats: narrations");
    // The parser never rewrites, slices, reorders or joins the narrations.
    expect(parser).not.toMatch(/narrations\.(map|slice|filter|sort|reverse|join|splice)/);
  });

  it("the spine still adopts the narrations as beats, copied into the shot unchanged", () => {
    expect(PLOT).toContain("if (narrations.length === shots) sp.beats = narrations;");
    expect(PLOT).toContain("read aloud exactly as"); // batch instruction: copy narration verbatim
  });
});

describe("D — a malformed compact spine is rejected, never fabricated", () => {
  it("requires title and setting and returns a reason instead of inventing story", () => {
    expect(parser).toContain('missing ${!title ? "title" : "setting"}');
    expect(parser).toContain('jsonIn(text, "spine")'); // bad JSON also returns a reason
    // No story content is manufactured — beats come only from the narrations.
    expect(parser).not.toContain('beats: [');
  });
});

describe("C — the non-verbatim >12-shot path is unchanged", () => {
  it("still uses the full SPINE_SYSTEM and parseSpine that requires the model's own beats", () => {
    expect(spineBlock).toMatch(/: parseSpine\(t, shots\)/);
    expect(PLOT).toContain("Return EXACTLY the number of beats asked for");
  });
});

describe("E — the fallback stays bounded (no runaway retries introduced)", () => {
  it("the spine's only same-engine retry is the parse-failure corrective, not a timeout loop", () => {
    // A reply that ARRIVED but would not parse earns ONE corrective retry (told
    // what was wrong), inside the spine closure — the same parse-only intent as
    // before. A TIMEOUT is never retried on the same engine here: the shared
    // llm.ts helper already double-attempts a timeout, and the orchestrator adds
    // the cross-engine fallback, so this must NOT stack a third layer.
    expect(spineBlock).toContain("could not be used"); // the one corrective retry ask
    expect(spineBlock).toContain("maxTransientRetriesPerEngine: 0");
  });

  it("the spine budget was TIGHTENED, never widened to paper over the timeout", () => {
    // The old 45s spine budget, doubled by the helper's own timeout-retry, ate
    // ~90s and starved Gemini. The fix makes it SMALLER, not larger.
    expect(spineBlock).toContain("spineBudgetMs: 15_000");
    expect(spineBlock).not.toContain("claudeRoomFor(45_000)");
    expect(spineBlock).not.toMatch(/spineBudgetMs:\s*(4[5-9]|[5-9]\d|\d{3})_?000/); // ≥45s banned
  });

  it("BOTH engines run the SAME small spine contract — never a whole-film fallback", () => {
    // The core P0 fix: the second engine goes through spine+batches, not a
    // doomed whole-43-shot call. The whole-film Gemini last-resort is gated to
    // the single-call band so a large film can never reach it.
    expect(spineBlock).toContain("orchestratePlan<Spine, Plan>");
    expect(spineBlock).toMatch(/engines\s*=\s*\[hasClaude \? "anthropic" : null, hasGemini \? "gemini" : null\]/);
    expect(PLOT).toContain("if (!plan && hasGemini && shots <= SINGLE_CALL_MAX_SHOTS)");
  });
});
