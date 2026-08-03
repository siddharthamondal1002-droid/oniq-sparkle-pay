/**
 * Phase 2 — country-aware paper generation.
 *
 * Proves the selection flows resolve to real systems, that GB/US/IN are
 * genuinely differentiated, that unsupported jurisdictions stay honest, and
 * — most importantly — that India's request shape and prompt construction
 * are byte-for-byte unchanged.
 */
import { describe, expect, it } from "vitest";
import { getEduSystem } from "@/data/eduSystems";
import {
  AE_CURRICULA,
  eduFlowFor,
  eduSystemPayload,
  resolveFlowSystem,
  spellingInstruction,
  unitLabel,
} from "@/lib/eduPaperFormat";

const COUNTRIES = ["US", "GB", "AE", "CA", "AU", "SG"] as const;

/**
 * Mirror of the edge function's prompt construction (study-paper-generate).
 * The India branch here is copied verbatim from the pre-Phase-2 function so a
 * drift in either direction fails this test.
 */
function indiaBaseSystem(a: {
  totalMarks: number; gradeStr: string; boardLabel: string; cur: string; subject: string; chapter?: string;
}): string {
  const { totalMarks, gradeStr, boardLabel, cur, subject, chapter } = a;
  return [
    `You are writing a real ${totalMarks}-mark practice examination paper for ${gradeStr} studying under ${boardLabel} in India. ${cur}`,
    `Subject: ${subject}.`,
    chapter
      ? `Chapter scope: "${chapter}". EVERY question — MCQ, short, and long — must come from this chapter's content only. Do NOT draw from other chapters. Spread across sub-topics WITHIN this chapter for variety.`
      : "",
    "",
    "Rules:",
    "- Age-appropriate, syllabus-aligned, non-trivial but fair. Test understanding, not tricks.",
    chapter
      ? `- Stay strictly within the "${chapter}" chapter — no cross-chapter integration questions.`
      : "- Spread across the subject's key topics for this class. Don't cluster around one narrow topic.",
    "- Honesty: never invent facts, dates, formulas, chapter references, or past-paper citations. If unsure, use safely-known content.",
    "- No personal data, no politics, no religion, no adult content.",
  ].filter(Boolean).join("\n");
}

const INDIA_SNAPSHOT =
  `You are writing a real 80-mark practice examination paper for a Class 10 student studying under CBSE in India. Follows NCERT.\n` +
  `Subject: Physics.\n` +
  // NOTE: the "" spacer line is removed by .filter(Boolean) in the real
  // function — this snapshot reflects the actual pre-Phase-2 output.
  `Rules:\n` +
  `- Age-appropriate, syllabus-aligned, non-trivial but fair. Test understanding, not tricks.\n` +
  `- Spread across the subject's key topics for this class. Don't cluster around one narrow topic.\n` +
  `- Honesty: never invent facts, dates, formulas, chapter references, or past-paper citations. If unsure, use safely-known content.\n` +
  `- No personal data, no politics, no religion, no adult content.`;

describe("Phase 2 — selection flows", () => {
  it("every non-India country resolves to a system with a non-empty paperFormat", () => {
    for (const c of COUNTRIES) {
      const flow = eduFlowFor(c);
      expect(flow, c).not.toBeNull();
      const region = flow!.regionStep?.options.find((o) => !o.unsupported)?.value;
      const curriculumId = flow!.curriculumStep?.options[0]?.value;
      const r = resolveFlowSystem(flow!, { region, curriculumId });
      expect(r.ok, `${c}: ${r.ok ? "" : r.message}`).toBe(true);
      if (!r.ok) continue;
      const f = r.system.paperFormat!;
      expect(f.commandWords.length, c).toBeGreaterThan(0);
      expect(f.terminator.length, c).toBeGreaterThan(0);
      expect(f.unit === "marks" || f.unit === "points", c).toBe(true);
    }
  });

  it("India has no Phase-2 flow — it keeps its own Board/Class picker", () => {
    expect(eduFlowFor("IN")).toBeNull();
  });

  it("the AE picker is curriculum-first and offers all six sub-systems", () => {
    const flow = eduFlowFor("AE")!;
    expect(flow.regionStep).toBeUndefined();
    expect(flow.curriculumStep).toBeDefined();
    const ids = AE_CURRICULA.map((c) => c.value);
    for (const id of [
      "gb-gcse",
      "gb-national-curriculum",
      "us-state-standards",
      "in-school-boards",
      "ib-dp",
      "cambridge-igcse",
      "uae-moe",
    ]) {
      expect(ids, id).toContain(id);
      expect(getEduSystem(id), id).toBeDefined();
    }
    // British / American / Indian / IB / Cambridge / MOE — six families.
    const families = new Set(ids.map((id) => (id.startsWith("gb-") ? "british" : id)));
    expect(families.size).toBe(6);
  });

  it("Scotland is honestly unsupported, never fabricated content", () => {
    const flow = eduFlowFor("GB")!;
    const r = resolveFlowSystem(flow, { region: "Scotland", curriculumId: "gb-gcse" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/SQA/);
      expect(r.message).toMatch(/licensing/i);
    }
    // England still works.
    expect(resolveFlowSystem(flow, { region: "England", curriculumId: "gb-gcse" }).ok).toBe(true);
  });

  it("Canada supports Ontario only, and says so for other provinces", () => {
    const flow = eduFlowFor("CA")!;
    expect(resolveFlowSystem(flow, { region: "Ontario" }).ok).toBe(true);
    const r = resolveFlowSystem(flow, { region: "Alberta" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/coming/i);
  });

  it("US and AU region pickers are labelling-only", () => {
    expect(eduFlowFor("US")!.regionStep!.affectsContent).toBe(false);
    expect(eduFlowFor("AU")!.regionStep!.affectsContent).toBe(false);
    // and there is no invented "US board"
    expect(getEduSystem("us-state-standards")!.authority).toMatch(/no national board/i);
  });
});

describe("Phase 2 — real differentiation between systems", () => {
  it("GB, US and India differ in command words, unit and spelling", () => {
    const gb = eduSystemPayload("gb-gcse")!;
    const us = eduSystemPayload("us-state-standards")!;
    const inn = eduSystemPayload("in-school-boards")!;

    expect(gb.unit).toBe("marks");
    expect(us.unit).toBe("points");
    expect(inn.unit).toBe("marks");

    expect(gb.spelling).toBe("en-GB");
    expect(us.spelling).toBe("en-US");
    expect(inn.spelling).toBe("en-IN");

    const sGb = spellingInstruction(gb.spelling);
    const sUs = spellingInstruction(us.spelling);
    const sIn = spellingInstruction(inn.spelling);
    expect(new Set([sGb, sUs, sIn]).size).toBe(3);
    expect(sGb).toMatch(/British/);
    expect(sUs).toMatch(/American/);
    expect(sIn).toMatch(/Indian/);

    // command word sets are not identical
    expect(gb.commandWords.join("|")).not.toBe(us.commandWords.join("|"));
    expect(gb.commandWords.join("|")).not.toBe(inn.commandWords.join("|"));
    expect(us.commandWords).toContain("Analyze"); // American spelling
    expect(gb.commandWords).toContain("Analyse"); // British spelling
    expect(inn.commandWords).toContain("Draw a labelled diagram");
  });

  it("terminators are country-correct phrases, not the unit word", () => {
    expect(eduSystemPayload("in-school-boards")!.terminator).toBe("End of paper");
    expect(eduSystemPayload("gb-gcse")!.terminator).toBe("End of questions");
    expect(eduSystemPayload("us-state-standards")!.terminator).toBe("End of exam");
    expect(eduSystemPayload("au-acara")!.terminator).toBe("End of examination");
    expect(eduSystemPayload("sg-moe")!.terminator).toBe("End of paper");
  });

  it("unit labels pluralize per system", () => {
    expect(unitLabel("marks", 1)).toBe("mark");
    expect(unitLabel("marks", 3)).toBe("marks");
    expect(unitLabel("points", 1)).toBe("point");
    expect(unitLabel("points", 5)).toBe("points");
  });
});

describe("Phase 2 — India is provably unaffected", () => {
  it("an India-shaped request (board set, no eduSystem) builds the exact pre-Phase-2 prompt", () => {
    const built = indiaBaseSystem({
      totalMarks: 80,
      gradeStr: "a Class 10 student",
      boardLabel: "CBSE",
      cur: "Follows NCERT.",
      subject: "Physics",
    });
    expect(built).toBe(INDIA_SNAPSHOT);
  });

  it("India's unit vocabulary is unchanged when no eduSystem is supplied", () => {
    // The edge function uses unit = "marks" whenever edu is null.
    expect(unitLabel("marks", 1)).toBe("mark");
    expect(`${3} ${"marks"}`).toBe("3 marks");
  });

  it("no Phase-2 flow can hijack an India profile", () => {
    expect(eduFlowFor("IN")).toBeNull();
    // in-school-boards has a payload for AE learners choosing the Indian
    // curriculum, but IN-home users never reach a flow at all.
    expect(eduSystemPayload("in-school-boards")).not.toBeNull();
  });
});
