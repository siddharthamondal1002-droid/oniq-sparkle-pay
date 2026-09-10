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
/** Repo-relative, for surfaces that are components rather than routes. */
const readRel = (rel: string) => stripComments(readFileSync(join(ROOT, rel), "utf8"));
/**
 * "Add a report" moved out of the Documents screen and onto BOTH health
 * screens as one component — owner report 2026-09-09, "nowhere to upload",
 * from the timeline. The AI output, its label and its declaration went with
 * it, so the assertions below follow it rather than the screen that hosts it.
 */
const ADD_REPORT = "src/health/AddReport.tsx";
const DESCRIBE_REPORT = "src/health/ReportDescription.tsx";

const HEALTH_SURFACES = AI_SURFACES.filter((s) => s.id === "health_ai_output");

describe("AI_SURFACES", () => {
  it("declares the timeline, the documents tab and the admin door under health_ai_output", () => {
    expect(HEALTH_SURFACES.map((s) => s.file).sort()).toEqual([
      ADD_REPORT,
      // "What does this report say?" — shown, never stored (2026-09-10). Its
      // own component, so the declaration is its own too: the label follows
      // the output, and this output is rendered from two screens.
      DESCRIBE_REPORT,
      "src/routes/_authenticated/app.admin_.health-ai.tsx",
      "src/routes/_authenticated/app.health.index.tsx",
      // "Analyse" on a stored document renders what the AI read back, so the
      // documents screen is a declared surface again (2026-09-09).
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
    for (const f of ["app.health.index.tsx", "app.admin_.health-ai.tsx"]) {
      expect(read(f), f).not.toMatch(/<AiOutputReport[^>]*context=/);
    }
    expect(readRel(ADD_REPORT), ADD_REPORT).not.toMatch(/<AiOutputReport[^>]*context=/);
  });
});

describe("add a report", () => {
  const src = readRel(ADD_REPORT);

  // ONE ACTION (owner directive 2026-09-09, "make it simple"): the screen no
  // longer asks for a type, a title, an Explain tap, or a confirm per value.
  // What it must still do is say what will happen BEFORE the file is picked,
  // and label what came back.
  it("takes a file and nothing else: no type dropdown, no title field, no per-value confirm", () => {
    expect(src).not.toContain("records.candidates");
    expect(src).not.toContain("records.confirm");
    expect(src).not.toContain("records.reject");
    expect(src).not.toContain("health-candidate");
    expect(src).not.toContain("health-doc-extract");
    expect(src).not.toMatch(/setKind|setTitle/);
    // The one input, and the one thing it triggers.
    expect(src).toContain('data-testid="health-doc-input"');
    expect(src).toContain("if (f) void attachFile(f);");
  });

  it("reads the report as part of the upload, gated on aiAvailable AND the client flag", () => {
    expect(src).toContain('healthAi("extract_document", { documentId })');
    expect(src).toContain(
      "HEALTH_AI_ENABLED && (status.data?.ok ? status.data.data.aiAvailable === true : false)",
    );
    // The read happens inside the one action, after the upload is confirmed.
    // ORDERED BY THE CALL SITE, NOT THE DEFINITION: the request moved into
    // readStoredDocument (shared with the documents screen's "Analyse"), which
    // is declared ABOVE the component — so indexOf of the request itself now
    // points at the helper and orders before everything. What must come after
    // the confirm and the gate is the CALL.
    const confirm = src.indexOf('"documents.confirm"');
    // The gate grew a second clause when DICOM arrived (owner directive
    // 2026-09-10): a scan is stored and rendered but never sent to the text
    // pipeline, so the read is skipped for it. Match the opening of the
    // condition rather than its full text, so adding a THIRD reason to skip
    // does not silently stop this test from finding the gate at all.
    const gate = src.indexOf("if (!aiAvailable");
    const read = src.indexOf("await readStoredDocument(documentId, t)");
    expect(confirm).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(confirm);
    expect(read).toBeGreaterThan(gate);
  });

  it("says what will be sent BEFORE the file is picked, and labels what came back", () => {
    const disclosure = src.indexOf('"health.records.ai_note"');
    const picker = src.indexOf('data-testid="health-doc-input"');
    expect(disclosure).toBeGreaterThan(-1);
    expect(disclosure).toBeLessThan(picker);
    expect(src).toMatch(/Google Cloud Vertex AI \(Gemini\)/);
    const i = src.indexOf('testId="health-read-result"');
    expect(i).toBeGreaterThan(-1);
    // TO THE CARD'S CLOSING TAG, NOT THE FIRST ") : null". The card grew an
    // inner conditional (the timeline link is hidden on the timeline itself)
    // and that literal then matched INSIDE it, cutting the slice before the
    // label and reporting a missing label on source that carries one. Same
    // shape as marketingCopy.test.ts's fixed 400-character window: where a
    // test reads source by offset, bound it by structure.
    const section = src.slice(i, src.indexOf("</OniqCard>", i));
    expect(section).toContain("HEALTH_AI_LABEL");
    expect(section).not.toContain("AI_OUTPUT_LABEL");
    expect(section).toContain('surface="health_ai_output"');
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

describe("the admin door — the caps", () => {
  it("carries the caps control: house and per-task inputs, one audited action, two taps, the server decides", () => {
    const src = read("app.admin_.health-ai.tsx");
    expect(src).toContain('healthApi<AiCaps>("admin.ai_caps"');
    expect(src).toContain('data-testid="health-ai-admin-house-cap"');
    expect(src).toContain("data-testid={`health-ai-admin-cap-${task}`}");
    expect(src).toContain('data-testid="health-ai-admin-caps-save"');
    expect(src).toContain("AI_TASKS.map((task) =>");
    expect(src).toMatch(/if \(!capsArmed\) \{\s*setCapsArmed\(true\);\s*return;\s*\}/);
    // A blank field travels nowhere: it must never become 0 (= refuse) by accident.
    expect(src).toContain("house.trim() ? { house: Number(house) } : {}");
    expect(src).toContain("tasks[task] = Number(taskCaps[task])");
    expect(src).not.toMatch(/is_admin|isAdmin/);
  });
});

describe("the consent tab", () => {
  it("offers the AI switch to the server's registered recipient, read from status", () => {
    const src = read("app.health.consent.tsx");
    expect(src).toContain("health-consent-ai-toggle");
    expect(src).toContain('grant.mutate("ai_interpretation")');
    expect(src).toContain("c.recipient === aiRecipient");
    expect(src).not.toContain('c.recipient === "oniq"');
  });
});

describe("the label — owner directive 2026-09-08, B12", () => {
  const FILES = ["app.health.index.tsx", "app.admin_.health-ai.tsx"];
  const withComponent = (f: string) => (f === ADD_REPORT ? readRel(f) : read(f));
  const ALL = [...FILES, ADD_REPORT];

  it('is "AI-assisted", one constant, rendered on every health AI surface in place of the app-wide label', () => {
    expect(HEALTH_AI_LABEL).toBe("AI-assisted");
    expect(HEALTH_AI_DISCLOSURE).toBe(
      "AI-assisted information — check your medical records and a qualified healthcare professional for medical decisions.",
    );
    expect(AI_LABEL_OVERRIDES.health_ai_output).toBe("HEALTH_AI_LABEL");
    for (const f of ALL) {
      const src = withComponent(f);
      expect(src, f).toContain("HEALTH_AI_LABEL");
      expect(src, f).not.toContain("AI_OUTPUT_LABEL");
    }
    // The answer panel's disclosure is the owner's sentence, under the gateway's own key.
    expect(read("app.health.index.tsx")).toContain("t(answer.disclaimerKey, HEALTH_AI_DISCLOSURE)");
  });

  it("never claims clinical authority: no 'AI Doctor', 'Medical AI' or 'Diagnosis' label on a health screen or in the label module", () => {
    const banned = /AI Doctor|Medical AI|AI Diagnos|Diagnosis:|Diagnosed by/i;
    for (const f of ALL) expect(withComponent(f), f).not.toMatch(banned);
    const labels = stripComments(readFileSync(join(ROOT, "src/health/labels.ts"), "utf8"));
    expect(labels).not.toMatch(banned);
    expect(labels).not.toMatch(/AI-generated —/);
  });
});
