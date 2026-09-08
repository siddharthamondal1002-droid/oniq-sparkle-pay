import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  OniqCard,
  OniqChip,
  OniqEmpty,
  OniqSectionHeader,
  OniqSkeletonRows,
} from "@/components/oniq";
import { AiOutputReport } from "@/components/safety/AiOutputReport";
import { useT } from "@/lib/i18n/LanguageProvider";
import { HEALTH_AI_ENABLED, HEALTH_ENABLED } from "@/health/flags";
import { healthApi, type HealthStatus, type TimelineRow } from "@/health/api";
import { healthAi, languageFor } from "@/health/ai/client";
import type { ClientAiResponse } from "@/health/ai/types";
import { RECORD_KINDS, validateRecordInput, type RecordKind } from "@/health/domain";
import { fill } from "@/health/i18n";
import {
  formatDate,
  formatValue,
  kindLabel,
  needsAiLabel,
  provenanceLabel,
  reasonText,
  todayIso,
  HEALTH_AI_DISCLOSURE,
  HEALTH_AI_LABEL,
} from "@/health/labels";

/**
 * ONIQ HEALTH — the timeline: every active record, newest first, each with
 * the provenance it was recorded with, and a form to enter one by hand.
 *
 * NOTHING HERE READS A TABLE. `healthApi` is the only way in, so consent,
 * the ownership filter and the audit chain apply to this screen exactly as
 * they do to every other. A refusal for missing consent is shown as a link to
 * the Consent tab rather than as an error.
 *
 * PHASE 2 — AI-READ ROWS AND THE ANSWER PANEL. A confirmed candidate keeps
 * its `document_extraction` provenance, so `needsAiLabel` is true for it and
 * the row renders HEALTH_AI_LABEL ("AI-assisted", B12) and an <AiOutputReport />; this file is
 * declared in AI_SURFACES. The panel ("Summarise", "Explain", "Ask") appears
 * only when the server's `status.aiAvailable` says health-ai would answer —
 * in Phase 2 production that is never for anyone but a verifying admin — and
 * every answer it shows came through the gateway's contract, labelled by
 * class, with the disclaimer resolved from its i18n key.
 */
export const Route = createFileRoute("/_authenticated/app/health/")({
  component: HealthTimeline,
});

const ENTRY_KINDS: readonly RecordKind[] = RECORD_KINDS;

function HealthTimeline() {
  const { t, lang } = useT();
  const qc = useQueryClient();
  const timeline = useQuery({
    queryKey: ["health", "timeline"],
    queryFn: () => healthApi<TimelineRow[]>("timeline"),
    enabled: HEALTH_ENABLED,
  });

  const [kind, setKind] = useState<RecordKind>("vital");
  const [display, setDisplay] = useState("");
  const [valueNum, setValueNum] = useState("");
  const [unit, setUnit] = useState("");
  const [text, setText] = useState("");
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [consentNeeded, setConsentNeeded] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<ClientAiResponse | null>(null);
  /** The receipt the answer came with — the content-free id a report is filed against. */
  const [answerReceipt, setAnswerReceipt] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["health", "status"],
    queryFn: () => healthApi<HealthStatus>("status"),
    enabled: HEALTH_ENABLED,
  });

  const ask = useMutation({
    mutationFn: async (input: {
      task: "summarize_timeline" | "explain_record" | "answer_question";
      recordId?: string;
      question?: string;
    }) => {
      setAiError(null);
      const res = await healthAi(input.task, {
        recordId: input.recordId,
        question: input.question,
        language: languageFor(lang),
      });
      if (!res.ok) throw new Error(reasonText(t, res));
      if (res.data.kind !== "response")
        throw new Error(t("health.error.generic", "Something went wrong."));
      return { response: res.data.response, receiptId: res.receiptId };
    },
    onSuccess: ({ response, receiptId }) => {
      setAnswer(response);
      setAnswerReceipt(receiptId);
    },
    onError: (e: Error) => setAiError(e.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      const num = valueNum.trim() === "" ? undefined : Number(valueNum);
      const record = {
        kind,
        display,
        valueNum: num,
        valueUnit: unit.trim() || undefined,
        valueText: text.trim() || undefined,
        effectiveAt: new Date(`${date}T12:00:00`).toISOString(),
      };
      const v = validateRecordInput(record);
      if (!v.ok) throw new Error(t("health.error.generic", "Something went wrong. Try again."));
      const res = await healthApi<{ id: string }>("records.create", { record: v.value });
      if (!res.ok) {
        if (res.reason === "consent_required") setConsentNeeded(true);
        throw new Error(reasonText(t, res));
      }
      return res.data;
    },
    onSuccess: () => {
      toast.success(t("health.add.saved", "Saved."));
      setDisplay("");
      setValueNum("");
      setUnit("");
      setText("");
      setConsentNeeded(false);
      void qc.invalidateQueries({ queryKey: ["health"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await healthApi<{ id: string }>("records.delete", { id });
      if (!res.ok) throw new Error(reasonText(t, res));
      return res.data;
    },
    onSuccess: () => {
      toast.success(t("health.deleted", "Deleted."));
      setArmed(null);
      void qc.invalidateQueries({ queryKey: ["health"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = timeline.data?.ok ? timeline.data.data : [];
  // Both halves gate the controls: the server's word on whether health-ai
  // would answer, and the client constant that is the rollback (05 §13).
  const aiAvailable =
    HEALTH_AI_ENABLED && (status.data?.ok ? status.data.data.aiAvailable === true : false);

  return (
    <div className="space-y-4">
      {aiAvailable ? (
        <OniqCard variant="surface" padding="md" testId="health-ai-panel">
          <OniqSectionHeader title={t("health.ai.ask", "Ask about my records")} />
          <div className="mt-3 grid gap-2">
            <input
              aria-label={t("health.ai.ask", "Ask about my records")}
              placeholder={t("health.ai.ask.placeholder", "e.g. What was my last HbA1c?")}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
              value={question}
              maxLength={500}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="health-ai-ask"
                className="rounded-full bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
                disabled={ask.isPending || !question.trim()}
                onClick={() => ask.mutate({ task: "answer_question", question: question.trim() })}
              >
                {t("health.ai.ask", "Ask about my records")}
              </button>
              <button
                type="button"
                data-testid="health-ai-summarize"
                className="rounded-full oniq-surface px-4 py-2 text-sm disabled:opacity-50"
                disabled={ask.isPending}
                onClick={() => ask.mutate({ task: "summarize_timeline" })}
              >
                {t("health.ai.summarize", "Summarise my timeline")}
              </button>
            </div>
            {aiError ? (
              <p className="text-sm text-destructive" role="alert">
                {aiError}
              </p>
            ) : null}
            {answer ? (
              <div className="mt-2 space-y-2" data-testid="health-ai-answer">
                {answer.segments.map((seg, i) => (
                  <div key={i} className="rounded-xl border border-border p-2">
                    <OniqChip>{t(`health.ai.class.${seg.class}`, seg.class)}</OniqChip>
                    <p className="mt-1 text-sm">{seg.text}</p>
                  </div>
                ))}
                {answer.refusals.map((code) => (
                  <p
                    key={code}
                    className="text-xs text-muted-foreground"
                    data-testid="health-ai-refusal"
                  >
                    {t(`health.ai.refusal.${code}`, code)}
                  </p>
                ))}
                {answer.excluded.count > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {fill(
                      t(
                        "health.ai.excluded",
                        "{count} item(s) were left out of the answer for safety.",
                      ),
                      { count: String(answer.excluded.count) },
                    )}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {t(answer.disclaimerKey, HEALTH_AI_DISCLOSURE)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  🤖 {t("health.ai.label", HEALTH_AI_LABEL)}
                </p>
                <AiOutputReport surface="health_ai_output" targetId={answerReceipt ?? "unsaved"} />
              </div>
            ) : null}
          </div>
        </OniqCard>
      ) : null}

      <OniqCard variant="surface" padding="md" testId="health-add">
        <OniqSectionHeader title={t("health.add.title", "Add a reading")} />
        <div className="mt-3 grid gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="health-kind">
            {t("health.add.kind", "Type")}
          </label>
          <select
            id="health-kind"
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as RecordKind)}
          >
            {ENTRY_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(t, k)}
              </option>
            ))}
          </select>
          <input
            aria-label={t("health.add.display", "What is it?")}
            placeholder={t("health.add.display", "What is it?")}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            value={display}
            maxLength={120}
            onChange={(e) => setDisplay(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              aria-label={t("health.add.value", "Value")}
              placeholder={t("health.add.value", "Value")}
              inputMode="decimal"
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
              value={valueNum}
              onChange={(e) => setValueNum(e.target.value)}
            />
            <input
              aria-label={t("health.add.unit", "Unit")}
              placeholder={t("health.add.unit", "Unit")}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
              value={unit}
              maxLength={24}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
          <textarea
            aria-label={t("health.kind.note", "Note")}
            placeholder={t("health.kind.note", "Note")}
            className="min-h-16 rounded-xl border border-border bg-background px-3 py-2 text-sm"
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
          />
          <label className="text-xs text-muted-foreground" htmlFor="health-date">
            {t("health.add.date", "When")}
          </label>
          <input
            id="health-date"
            type="date"
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
          />
          {consentNeeded ? (
            <Link
              to="/app/health/consent"
              className="text-sm underline"
              data-testid="health-consent-link"
            >
              {t("health.consent.required", "Turn on the storage consent first.")}
            </Link>
          ) : error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            data-testid="health-record-save"
            className="rounded-full bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
            disabled={save.isPending || !display.trim()}
            onClick={() => save.mutate()}
          >
            {t("health.add.save", "Save")}
          </button>
        </div>
      </OniqCard>

      {timeline.isPending ? (
        <OniqSkeletonRows rows={3} />
      ) : rows.length === 0 ? (
        <OniqEmpty
          emoji="🗂️"
          title={t("health.timeline.empty", "No records yet. Add a reading, or upload a report.")}
        />
      ) : (
        <ul className="space-y-2" data-testid="health-timeline">
          {rows.map((r) => (
            <li key={r.id}>
              <OniqCard variant="surface" padding="md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <OniqChip>{kindLabel(t, r.kind)}</OniqChip>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(r.effectiveAt, lang)}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-sm font-medium">{r.display}</div>
                    <div className="text-sm text-muted-foreground">
                      {formatValue(r.valueNum, r.valueUnit, r.valueText)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {provenanceLabel(t, r.provenance?.source)}
                    </div>
                    {needsAiLabel(r.provenance?.source) ? (
                      <div data-testid="health-record-ai-label">
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          🤖 {t("health.ai.label", HEALTH_AI_LABEL)}
                        </p>
                        <AiOutputReport surface="health_ai_output" targetId={r.id} />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {aiAvailable ? (
                      <button
                        type="button"
                        data-testid="health-record-explain"
                        className="text-xs underline"
                        disabled={ask.isPending}
                        onClick={() => ask.mutate({ task: "explain_record", recordId: r.id })}
                      >
                        {t("health.ai.explain", "Explain")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      data-testid="health-record-delete"
                      className="text-xs text-muted-foreground underline"
                      onClick={() => (armed === r.id ? remove.mutate(r.id) : setArmed(r.id))}
                    >
                      {armed === r.id
                        ? t("health.delete.confirm", "Delete for good?")
                        : t("health.delete", "Delete")}
                    </button>
                  </div>
                </div>
              </OniqCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
