/**
 * THE AI OUTPUT IS LABELLED WHERE IT RENDERS, AND THE DOORS EXIST. Both
 * health screens and the admin door are declared in AI_SURFACES under one
 * id, the timeline labels a row exactly when needsAiLabel() says so (not
 * with a sparkle), the candidates section carries the label, the client has
 * a caller for extraction and for confirm/reject (reachability, the lesson
 * of /app/creations), and the admin door is linked from Profile.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";
import { AI_LABEL_OVERRIDES, AI_SURFACES } from "@/config/playCompliance";
import { HEALTH_AI_DISCLOSURE, HEALTH_AI_LABEL } from "@/health/labels";

const ROOT = join(__dirname, "..", "..", "..", "..");
const ROUTES = join(ROOT, "src/routes/_authenticated");
const read = (f: string) => stripComments(readFileSync(join(ROUTES, f), "utf8"));

const HEALTH_SURFACES = AI_SURFACES.filter((s) => s.id === "health_ai_output");

describe("AI_SURFACES", () => {
  it("declares the timeline, the documents tab and the admin door under health_ai_output", () => {
    expect(HEALTH_SURFACES.map((s) => s.file).sort()).toEqual([
      "src/routes/_authenticated/app.admin_.health-ai.tsx",
      "src/routes/_authenticated/app.health.index.tsx",
      "src/routes/_authenticated/app.health.records.tsx",
    ]);
  });

  it("the AiSurface union carries the id", () => {
    const src = readFileSync(join(ROOT, "src/components/safety/AiOutputReport.tsx"), "utf8");
    expect(src).toContain('| "health_ai_output"');
  });
});

describe("the timeline", () => {
  const src = read("app.health.index.tsx");

  it("labels a row exactly when needsAiLabel() is true, with the label and the report control", () => {
    const i = src.indexOf("needsAiLabel(r.provenance?.source) ? (");
    expect(i).toBeGreaterThan(-1);
    const branch = src.slice(i, src.indexOf(") : null", i));
    expect(branch).toContain("HEALTH_AI_LABEL");
    expect(branch).not.toContain("AI_OUTPUT_LABEL");
    expect(branch).toContain('surface="health_ai_output"');
    expect(branch).toContain("targetId={r.id}");
    expect(src).not.toContain("✨");
  });

  it("offers Explain, Summarise and Ask on the server's aiAvailable AND the client flag, and renders the disclaimer by key", () => {
    // Both halves: the server says whether health-ai would answer; the
    // client constant is the rollback. Gating on the server field alone
    // left every control visible after a client-only rollback, each tap
    // refused locally — a door to a room you cannot enter.
    expect(src).toContain(
      "HEALTH_AI_ENABLED && (status.data?.ok ? status.data.data.aiAvailable === true : false)",
    );
    expect(src).toMatch(/aiAvailable \? \(/);
    expect(src).not.toMatch(/HEALTH_AI_ENABLED \?/);
    expect(src).toContain("healthAi(input.task");
    expect(src).toContain("answer.disclaimerKey");
    expect(src).toContain("health.ai.class.${seg.class}");
  });

  it("renders a provider's own refusals under their i18n keys, and reports the answer against its receipt", () => {
    expect(src).toContain("health.ai.refusal.${code}");
    expect(src).toContain('targetId={answerReceipt ?? "unsaved"}');
    expect(src).toContain("setAnswerReceipt(");
  });

  it("passes no content to a report: the report carries an id, never a segment or a display", () => {
    for (const f of [
      "app.health.index.tsx",
      "app.health.records.tsx",
      "app.admin_.health-ai.tsx",
    ]) {
      expect(read(f), f).not.toMatch(/<AiOutputReport[^>]*context=/);
    }
  });
});

describe("the documents tab", () => {
  const src = read("app.health.records.tsx");

  it("lists candidates whenever they exist, with confirm and reject, labelled", () => {
    expect(src).toContain('healthApi<CandidateRow[]>("records.candidates")');
    expect(src).toContain('"records.confirm" : "records.reject"');
    const i = src.indexOf("suggested.length > 0 ? (");
    expect(i).toBeGreaterThan(-1);
    const section = src.slice(i, src.indexOf(") : null", i));
    expect(section).toContain("HEALTH_AI_LABEL");
    expect(section).not.toContain("AI_OUTPUT_LABEL");
    expect(section).toContain('surface="health_ai_output"');
    expect(section).toContain("health-candidate-confirm");
    expect(section).toContain("health-candidate-reject");
  });

  it("has a caller for extraction, shown only on aiAvailable AND the client flag", () => {
    expect(src).toContain('healthAi("extract_document", { documentId })');
    expect(src).toMatch(/aiAvailable \? \(/);
    expect(src).toContain(
      "HEALTH_AI_ENABLED && (status.data?.ok ? status.data.data.aiAvailable === true : false)",
    );
  });

  it("keeps every hook above the uploads-off early return", () => {
    const gate = src.indexOf("if (!HEALTH_UPLOADS_ENABLED)");
    for (const hook of ["useQuery(", "useMutation(", "useState", "useRef", "useT("]) {
      expect(src.lastIndexOf(hook), hook).toBeLessThan(gate);
    }
  });
});

describe("the admin door", () => {
  it("exists, opts out of nesting, is linked from Profile, and exercises every task through the real client", () => {
    const src = read("app.admin_.health-ai.tsx");
    expect(src).toContain('createFileRoute("/_authenticated/app/admin_/health-ai")');
    for (const task of [
      "summarize_timeline",
      "answer_question",
      "classify_document",
      "extract_document",
    ]) {
      expect(src, task).toContain(task);
    }
    expect(src).toContain('healthApi<CandidateRow[]>("records.candidates")');
    expect(src).toContain("HEALTH_AI_LABEL");
    expect(src).toContain('surface="health_ai_output"');
    const profile = read("app.profile.tsx");
    expect(profile).toContain('to="/app/admin/health-ai"');
  });

  it("carries the emergency stop: two taps, one action, the server decides who may", () => {
    const src = read("app.admin_.health-ai.tsx");
    expect(src).toContain('healthApi<{ aiKillSwitch: boolean }>("admin.ai_kill", { on })');
    expect(src).toContain('data-testid="health-ai-admin-kill"');
    expect(src).toContain('data-testid="health-ai-admin-unkill"');
    // The first tap arms and returns; only the second sends.
    expect(src).toMatch(/if \(armed !== position\) \{\s*setArmed\(position\);\s*return;\s*\}/);
    // The client carries no admin check of its own: the gate is health-api's.
    expect(src).not.toMatch(/is_admin|isAdmin/);
  });
});

describe("the consent tab", () => {
  it("offers the AI switch to ONIQ only", () => {
    const src = read("app.health.consent.tsx");
    expect(src).toContain("health-consent-ai-toggle");
    expect(src).toContain('grant.mutate("ai_interpretation")');
    expect(src).toContain('c.recipient === "oniq"');
  });
});

describe("the label — owner directive 2026-09-08, B12", () => {
  const FILES = ["app.health.index.tsx", "app.health.records.tsx", "app.admin_.health-ai.tsx"];

  it('is "AI-assisted", one constant, rendered on every health AI surface in place of the app-wide label', () => {
    expect(HEALTH_AI_LABEL).toBe("AI-assisted");
    expect(HEALTH_AI_DISCLOSURE).toBe(
      "AI-assisted information — check your medical records and a qualified healthcare professional for medical decisions.",
    );
    expect(AI_LABEL_OVERRIDES.health_ai_output).toBe("HEALTH_AI_LABEL");
    for (const f of FILES) {
      const src = read(f);
      expect(src, f).toContain("HEALTH_AI_LABEL");
      expect(src, f).not.toContain("AI_OUTPUT_LABEL");
    }
    // The answer panel's disclosure is the owner's sentence, under the gateway's own key.
    expect(read("app.health.index.tsx")).toContain("t(answer.disclaimerKey, HEALTH_AI_DISCLOSURE)");
  });

  it("never claims clinical authority: no 'AI Doctor', 'Medical AI' or 'Diagnosis' label on a health screen or in the label module", () => {
    const banned = /AI Doctor|Medical AI|AI Diagnos|Diagnosis:|Diagnosed by/i;
    for (const f of FILES) expect(read(f), f).not.toMatch(banned);
    const labels = stripComments(readFileSync(join(ROOT, "src/health/labels.ts"), "utf8"));
    expect(labels).not.toMatch(banned);
    expect(labels).not.toMatch(/AI-generated —/);
  });
});
