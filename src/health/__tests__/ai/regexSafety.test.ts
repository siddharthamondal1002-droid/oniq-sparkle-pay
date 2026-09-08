/**
 * EVERY PATTERN HAS BOUNDED GAPS, AND THE PROOF IS A CLOCK. Attacker-chosen
 * text of 20,000 characters goes through the scrubber, the detector, the
 * forbidden groups, the extractor and the classifier; none may pin the
 * isolate. And the source is read for the shapes that cause it: `.*`, `.+`,
 * and a quantified group.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";
import {
  detectInjection,
  normalizeForMatch,
  scrubText,
} from "../../../../supabase/functions/_shared/health/ai/scrub";
import { forbiddenIn } from "../../../../supabase/functions/_shared/health/ai/contract";
import { extractCandidates } from "../../../../supabase/functions/_shared/health/ai/extract";
import { classifyDocument } from "../../../../supabase/functions/_shared/health/ai/classify";
import { LIMITS } from "../../ai/types";

const ROOT = join(__dirname, "..", "..", "..", "..");
const FILES = ["scrub.ts", "contract.ts", "extract.ts", "classify.ts"];

describe("banned regex shapes", () => {
  it.each(FILES)("%s has no unbounded gap or quantified group in any regex literal", (f) => {
    const src = stripComments(
      readFileSync(join(ROOT, "supabase/functions/_shared/health/ai", f), "utf8"),
    );
    const literals = [
      ...src.matchAll(/\/(?![/*])((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+)\/[dgimsuvy]*/g),
    ].map((m) => m[1]);
    expect(literals.length).toBeGreaterThan(5);
    for (const re of literals) {
      expect(re, `${f}: ${re}`).not.toMatch(/(?<!\\)\.\*|(?<!\\)\.\+/);
      // A group followed by + or * (or {n,}) can backtrack quadratically.
      expect(re, `${f}: ${re}`).not.toMatch(/\)[+*]|\)\{\d+,\}/);
      expect(re, `${f}: ${re}`).not.toMatch(/\{\d+,\}/);
    }
  });
});

describe("timing on adversarial input", () => {
  const N = LIMITS.MAX_DOCUMENT_CHARS;
  const inputs = [
    "a".repeat(N),
    "ignore ".repeat(N / 7),
    "ignore previous ".repeat(N / 16),
    "take 5 ".repeat(N / 7),
    "1 mg ".repeat(N / 5),
    "@".repeat(N),
    "http://".repeat(N / 7),
    "haemoglobin ".repeat(N / 12),
    "x@y.".repeat(N / 4),
    "​".repeat(N),
    "system".repeat(N / 6),
    "you have ".repeat(N / 9),
  ];

  it.each(inputs.map((s, i) => [i, s] as const))("input %i stays fast everywhere", (_i, s) => {
    const t0 = performance.now();
    normalizeForMatch(s);
    scrubText(s);
    detectInjection(s, "hi");
    detectInjection(s, "bn");
    forbiddenIn(normalizeForMatch(s), "hi");
    forbiddenIn(normalizeForMatch(s), "bn");
    extractCandidates(s, "2026-09-01");
    classifyDocument({ title: s.slice(0, 120), mime: "application/pdf", sizeBytes: 1, text: s });
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
