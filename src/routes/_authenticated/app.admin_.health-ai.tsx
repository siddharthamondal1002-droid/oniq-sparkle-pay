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
// This is an AI surface: the answer panel carries HEALTH_AI_LABEL ("AI-assisted",
// owner directive B12) and an <AiOutputReport />, and the file is declared in
// playCompliance.ts.
//
// THE EMERGENCY STOP LIVES HERE TOO. "Stop Health AI now" sets the kill
// switch on the health_config row through health-api (admin.ai_kill, admin
// re-derived from the JWT, audited); every function reads it on its next
// request and every AI flag reads false — seconds, no SQL, no deploy. Two
// taps, so a stray touch cannot flip it either way.
//
// AND THE CAPS (owner directive, later the same day — the house cap approved
// at 500). The house cap is a system-wide ceiling, every operation, everyone;
// the per-operation caps are the tighter, per-person control. Both are set
// here through health-api (admin.ai_caps): configurable without a migration,
// admin re-derived on the server, every change audited — and a row trigger
// audits the change again whatever path made it. 0 refuses; nothing is ever
// "unlimited". Blank fields leave that cap alone; Status fills them in.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AiOutputReport } from "@/components/safety/AiOutputReport";
import { healthApi, type AiCaps, type CandidateRow, type HealthStatus } from "@/health/api";
import { HEALTH_AI_LABEL } from "@/health/labels";
import { healthAi } from "@/health/ai/client";
import { AI_TASKS, type AiTask } from "@/health/ai/types";

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
  const [armed, setArmed] = useState<"on" | "off" | null>(null);
  const [house, setHouse] = useState("");
  const [taskCaps, setTaskCaps] = useState<Record<string, string>>({});
  const [capsArmed, setCapsArmed] = useState(false);

  const show = (v: unknown) => setResult(JSON.stringify(v, null, 2));

  const fillCaps = (c: AiCaps) => {
    setHouse(String(c.house));
    setTaskCaps(Object.fromEntries(Object.entries(c.tasks).map(([k, v]) => [k, String(v)])));
  };

  const status = async () => {
    setBusy("status");
    const res = await healthApi<HealthStatus>("status");
    if (res.ok && res.data.aiCaps) fillCaps(res.data.aiCaps);
    show(res);
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

  const killSwitch = async (on: boolean) => {
    const position = on ? "on" : "off";
    if (armed !== position) {
      setArmed(position);
      return;
    }
    setArmed(null);
    setBusy(`kill-${position}`);
    show(await healthApi<{ aiKillSwitch: boolean }>("admin.ai_kill", { on }));
    setBusy(null);
  };

  const saveCaps = async () => {
    if (!capsArmed) {
      setCapsArmed(true);
      return;
    }
    setCapsArmed(false);
    setBusy("caps");
    // Only what the admin filled in travels; a blank field leaves that cap alone.
    const tasks: Record<string, number> = {};
    for (const task of AI_TASKS) if (taskCaps[task]?.trim()) tasks[task] = Number(taskCaps[task]);
    const res = await healthApi<AiCaps>("admin.ai_caps", {
      ...(house.trim() ? { house: Number(house) } : {}),
      ...(Object.keys(tasks).length > 0 ? { tasks } : {}),
    });
    if (res.ok) fillCaps(res.data);
    show(res);
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
        Extract answers no_text in Phase 2: no text source is registered, and the audit row for that
        refusal is the proof the pipeline ran.
      </p>

      <div className="mt-6 max-w-prose rounded-2xl border border-border p-3">
        <h2 className="text-sm font-semibold">Daily caps</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The house cap is a ceiling for everyone, every operation, per day; the per-operation caps
          are the tighter, per-person control. 0 refuses. Every change is audited. Tap Status to
          load the current values; blank fields are left alone. Tap Save twice.
        </p>
        <div className="mt-2 grid gap-2">
          <label className="text-xs">
            House cap (all operations, everyone, per day)
            <input
              aria-label="House cap"
              data-testid="health-ai-admin-house-cap"
              type="number"
              inputMode="numeric"
              min={0}
              max={100000}
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              value={house}
              onChange={(e) => setHouse(e.target.value)}
            />
          </label>
          {AI_TASKS.map((task) => (
            <label key={task} className="text-xs">
              {task} (per person, per day)
              <input
                aria-label={`Cap for ${task}`}
                data-testid={`health-ai-admin-cap-${task}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={100000}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                value={taskCaps[task] ?? ""}
                onChange={(e) => setTaskCaps({ ...taskCaps, [task]: e.target.value })}
              />
            </label>
          ))}
          <button
            type="button"
            data-testid="health-ai-admin-caps-save"
            onClick={() => void saveCaps()}
            disabled={busy !== null}
            className="press rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {busy === "caps" ? "Saving…" : capsArmed ? "Tap again to save caps" : "Save caps"}
          </button>
        </div>
      </div>

      <div className="mt-6 max-w-prose rounded-2xl border border-destructive/40 p-3">
        <h2 className="text-sm font-semibold">Emergency stop</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Turns every Health AI path off for everyone, on the next request, without a deploy. Status
          shows the switch as aiKillSwitch. Tap twice.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="health-ai-admin-kill"
            onClick={() => void killSwitch(true)}
            disabled={busy !== null}
            className="press rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
          >
            {busy === "kill-on"
              ? "Stopping…"
              : armed === "on"
                ? "Tap again to stop Health AI"
                : "Stop Health AI now"}
          </button>
          <button
            type="button"
            data-testid="health-ai-admin-unkill"
            onClick={() => void killSwitch(false)}
            disabled={busy !== null}
            className="press rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {busy === "kill-off"
              ? "Allowing…"
              : armed === "off"
                ? "Tap again to allow Health AI"
                : "Allow Health AI again"}
          </button>
        </div>
      </div>

      {result ? (
        <div className="mt-4">
          <pre
            data-testid="health-ai-admin-result"
            className="max-w-full overflow-x-auto rounded-2xl border border-border bg-card p-3 text-[11px] leading-relaxed"
          >
            {result}
          </pre>
          <p className="mt-2 text-[11px] text-muted-foreground">🤖 {HEALTH_AI_LABEL}</p>
          <AiOutputReport surface="health_ai_output" targetId="health-ai-admin" />
        </div>
      ) : null}
    </div>
  );
}
