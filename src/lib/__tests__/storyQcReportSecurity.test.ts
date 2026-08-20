import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_QC_REPORT_BYTES,
  sanitizeQcReport,
} from "../../../supabase/functions/_shared/storyQcReport";

const ROOT = join(__dirname, "../../..");
const CALLBACK_SRC = readFileSync(
  join(ROOT, "supabase/functions/story-callback/index.ts"),
  "utf8",
);

describe("qc-report sanitization", () => {
  it("accepts a bounded report and normalizes shape", () => {
    const out = sanitizeQcReport({
      version: 1,
      stage: "pre-assembly-shot-validator",
      shots: [
        {
          shot: 1,
          attempt: 1,
          score: 88,
          checks: [{ name: "clip.fps", pass: true, detail: "ok" }],
          continuity: { score: 82 },
          cinematic: { score: 71 },
        },
      ],
      failures: [],
      warnings: [],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(Array.isArray(out.report.shots)).toBe(true);
      expect(out.report.version).toBe(1);
    }
  });

  it("rejects oversized payloads", () => {
    const tooLarge = { x: "a".repeat(MAX_QC_REPORT_BYTES + 20) };
    const out = sanitizeQcReport(tooLarge);
    expect(out.ok).toBe(false);
  });

  it("rejects malformed payloads", () => {
    const out = sanitizeQcReport("not-an-object");
    expect(out.ok).toBe(false);
  });
});

describe("callback qc-report write scope", () => {
  it("uses explicit qc report sanitization before patch", () => {
    expect(CALLBACK_SRC).toContain("sanitizeQcReport");
    expect(CALLBACK_SRC).toContain("if (!sanitized.ok) return json({ error: sanitized.error }, 400)");
  });

  it("scopes qc-report patch to generating/assembling states", () => {
    expect(CALLBACK_SRC).toContain("status=in.(generating,assembling)");
  });
});
