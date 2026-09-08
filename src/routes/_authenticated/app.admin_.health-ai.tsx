// ADMIN-ONLY tool: exercise the Health AI gateway end to end, in production,
// against the SYNTHETIC provider — and read back exactly what the server said.
//
// WHY A SCREEN EXISTS FOR THIS. Phase 2 (docs/health/05) ships the gateway
// dark: in production every non-admin is refused synthetic_in_production, so
// the only way to prove that the deployed function, the receipt row, the
// audit chain and the contract all run on the real project is an admin
// pressing these buttons with `ai_admin_verification_enabled` set on the
// health_config row. Each tap is audited with method=admin_verification.
//
// THE SCREEN IS NOT THE GATE. health-ai re-derives the caller from the JWT,
// checks is_admin server-side and the row's switch; this page being unlinked
// would be cosmetic (it is linked from Profile — adminDoors.test.ts). The
// document ids below are the admin's OWN: the store is bound to the caller,
// so another person's id answers not_found by construction.
//
// THE UNDERSCORE IN THE FILENAME IS LOAD-BEARING: it opts the route out of
// nesting under app.admin.tsx, which has no <Outlet /> (routeNesting.test.ts).
//
// This is an AI surface: the answer panel carries AI_OUTPUT_LABEL and an
// <AiOutputReport />, and the file is declared in playCompliance.ts.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AI_OUTPUT_LABEL, AiOutputReport } from "@/components/safety/AiOutputReport";
import { healthApi, type CandidateRow, type HealthStatus } from "@/health/api";
import { healthAi } from "@/health/ai/client";
import type { AiTask } from "@/health/ai/types";

export const Route = createFileRoute("/_authenticated/app/admin_/health-ai")({
  head: () => ({
    meta: [{ title: "Health AI verification" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: HealthAiVerificationTool,
});

const DOCUMENT_TASKS: readonly AiTask[] = ["classify_document", "extract_document"];

function HealthAiVerificationTool() {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState("");
  const [question, setQuestion] = useState("");

  const show = (v: unknown) => setResult(JSON.stringify(v, null, 2));

  const status = async () => {
    setBusy("status");
    show(await healthApi<HealthStatus>("status"));
    setBusy(null);
  };

  const candidates = async () => {
    setBusy("candidates");
    show(await healthApi<CandidateRow[]>("records.candidates"));
    setBusy(null);
  };

  const run = async (task: AiTask) => {
    setBusy(task);
    // The server's own sentence is the one worth showing — a refusal names
    // the reason code, the purpose and the category, and a summary would lose it.
    show(
      await healthAi(task, {
        documentId: DOCUMENT_TASKS.includes(task) ? documentId.trim() || undefined : undefined,
        question: task === "answer_question" ? question.trim() || undefined : undefined,
      }),
    );
    setBusy(null);
  };

  const button = (label: string, key: string, onClick: () => void) => (
    <button
      type="button"
      data-testid={`health-ai-admin-${key}`}
      onClick={onClick}
      disabled={busy !== null}
      className="press rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
    >
      {busy === key ? "Asking…" : label}
    </button>
  );

  return (
    <div className="min-h-screen px-4 pt-12 pb-16">
      <h1 className="font-display text-2xl font-bold">Health AI verification</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Runs the Health AI gateway against the synthetic provider on the live project — gate,
        consent, receipt, contract, audit — and prints the server&apos;s answer verbatim. Needs the
        AI flag on both halves, an AI consent granted from the Health tab, and
        ai_admin_verification_enabled on the health_config row; otherwise every button prints the
        refusal that explains which of those is missing. Nothing here reaches any model outside
        ONIQ.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {button("Status", "status", () => void status())}
        {button("Summarise timeline", "summarize", () => void run("summarize_timeline"))}
        {button("Candidates", "candidates", () => void candidates())}
      </div>

      <div className="mt-4 grid max-w-prose gap-2">
        <input
          aria-label="Question"
          placeholder="Question for answer_question"
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
          value={question}
          maxLength={500}
          onChange={(e) => setQuestion(e.target.value)}
        />
        {button("Ask", "ask", () => void run("answer_question"))}
        <input
          aria-label="Document id"
          placeholder="One of your own document ids"
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {button("Classify document", "classify", () => void run("classify_document"))}
          {button("Extract document", "extract", () => void run("extract_document"))}
        </div>
      </div>

      <p className="mt-2 max-w-prose text-xs text-muted-foreground">
        Extract answers no_text in Phase 2: no text source is registered, and the receipt and audit
        row for that refusal are the proof the pipeline ran.
      </p>

      {result ? (
        <div className="mt-4">
          <pre
            data-testid="health-ai-admin-result"
            className="max-w-full overflow-x-auto rounded-2xl border border-border bg-card p-3 text-[11px] leading-relaxed"
          >
            {result}
          </pre>
          <p className="mt-2 text-[11px] text-muted-foreground">🤖 {AI_OUTPUT_LABEL}</p>
          <AiOutputReport surface="health_ai_output" targetId="health-ai-admin" />
        </div>
      ) : null}
    </div>
  );
}
