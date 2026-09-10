import { useEffect, useRef, useState } from "react";
import { OniqCard } from "@/components/oniq";
import { AiOutputReport } from "@/components/safety/AiOutputReport";
import { useT } from "@/lib/i18n/LanguageProvider";
import { HEALTH_AI_ENABLED } from "@/health/flags";
import { healthAi, languageFor } from "@/health/ai/client";
import type { ClientAiResponse } from "@/health/ai/types";
import { reasonText, HEALTH_AI_LABEL, HEALTH_AI_DISCLOSURE } from "@/health/labels";

/**
 * ONIQ HEALTH — "What does this report say?", for the reports ONIQ cannot file
 * as numbers.
 *
 * OWNER DIRECTIVE, 2026-09-10, asked what ONIQ should do with a radiology
 * report: **"Show it, don't store it."** The AI reads the report and shows
 * what it states, on screen. Nothing enters the timeline.
 *
 * WHY IT EXISTS AT ALL. Owner report 2026-09-09, _"no result came up on an
 * xray report"_: extraction stores a value only when it matches one of ~28
 * numeric blood and urine analytes, and a scan report is findings and an
 * impression — it names none of them. Zero from an X-ray is the design, not a
 * fault, and no change to any extractor alters it. So the answer was never a
 * better extractor; it was a second, different way to read a report.
 *
 * WHY IT STORES NOTHING, and why that is the safe half rather than the lazy
 * one. `health_records` is analyte + number + unit; a radiologist's findings
 * are prose. Filing prose there would need a new record shape AND a new safety
 * story — summarising an impression is interpretation, not transcription. On
 * screen, under the AI-assisted label, with nothing kept, a wrong sentence is
 * read once and gone; in a timeline it would be read as the person's own
 * medical history for as long as the account lives.
 *
 * THE NUMBERS ARE STILL GROUNDED. Nothing being stored is NOT a reason to
 * loosen the check: a wrong figure shown to a person about their own scan is
 * still a wrong figure. `document_fact` is a segment class of its own for
 * exactly this — every number in it must be PRINTED in the document it cites
 * (`contract.ts`, `documentNumbers`). Emitting a description as `general_info`
 * would have been the one-line version of this feature and would have applied
 * NO number rule at all.
 *
 * IT RUNS AUTOMATICALLY WHEN A READ FILED NOTHING — owner directive
 * 2026-09-10 (later), "make it automatic". That is exactly the spend decision
 * B14 put to them: a description is a SECOND paid read of the same document,
 * so chaining it was theirs to authorise and never an agent's call. It fires
 * only on the ZERO case, because that is the one the owner reported ("no
 * result came up on an xray report") and the one where the person is otherwise
 * told nothing. A read that DID file readings has already answered them, and
 * describing it as well would be a second charge for a question nobody asked —
 * so the button stays for that case, and for a re-read.
 *
 * ONCE, AND ONLY ONCE. `auto` fires from an EFFECT behind a ref, never from
 * render: React StrictMode double-invokes effects in development, and a second
 * invocation here is a second billed call on the metered Google key. The ref
 * holds the document id rather than a boolean, so a different document still
 * describes and the same one never twice.
 *
 * This is an AI surface: HEALTH_AI_LABEL (owner directive B12),
 * <AiOutputReport />, and the answer disclosure, declared in playCompliance.ts
 * under `health_ai_output`.
 */
export function HealthReportDescription({
  documentId,
  /**
   * Read the document without waiting to be asked. Set by both callers on the
   * ZERO case only (owner directive 2026-09-10, "make it automatic").
   */
  auto = false,
}: {
  documentId: string;
  auto?: boolean;
}) {
  const { t, lang } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<ClientAiResponse | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  /** The document this component has already spent a call on. */
  const describedRef = useRef<string | null>(null);

  // EVERY HOOK ABOVE EVERY EARLY RETURN — react-hooks/rules-of-hooks is a
  // release blocker in this repo (CLAUDE.md, 2026-08-04).
  useEffect(() => {
    if (!auto || !HEALTH_AI_ENABLED) return;
    if (describedRef.current === documentId) return;
    describedRef.current = documentId;
    void describe();
    // The document id is the WHOLE dependency on purpose: `describe` closes
    // over the language too, and re-running on a language change would bill a
    // second read of a report already described.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, documentId]);

  if (!HEALTH_AI_ENABLED) return null;

  async function describe() {
    setBusy(true);
    setError(null);
    const res = await healthAi("describe_document", {
      documentId,
      language: languageFor(lang),
    });
    setBusy(false);
    if (!res.ok) {
      setAnswer(null);
      setError(reasonText(t, res));
      return;
    }
    if (res.data.kind !== "response") {
      setAnswer(null);
      setError(t("health.error.generic", "Something went wrong. Try again."));
      return;
    }
    setAnswer(res.data.response);
    setReceipt(res.receiptId);
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-xs underline disabled:opacity-50"
        data-testid="health-doc-describe"
        disabled={busy}
        onClick={() => void describe()}
      >
        {busy
          ? t("health.records.describing", "Reading what it says…")
          : answer
            ? t("health.records.describe.again", "Read it again")
            : t("health.records.describe", "What does this report say?")}
      </button>

      {error ? (
        <p className="mt-1 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {answer ? (
        <OniqCard variant="surface" padding="md" testId="health-doc-description">
          <div className="space-y-2" role="status">
            {answer.segments.map((seg, i) => (
              <p key={i} className="text-sm">
                {seg.text}
              </p>
            ))}
          </div>
          {answer.refusals.map((code) => (
            <p key={code} className="mt-2 text-xs text-muted-foreground">
              {t(`health.ai.refusal.${code}`, code)}
            </p>
          ))}
          {answer.segments.length === 0 && answer.refusals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("health.records.describe.nothing", "ONIQ could not read anything from that file.")}
            </p>
          ) : null}
          {/* SAY THAT NOTHING WAS KEPT. The person has just watched an upload
              put readings into their timeline; without this line they would
              reasonably assume this went there too, and go looking for it. */}
          <p className="mt-3 text-xs text-muted-foreground" data-testid="health-doc-describe-note">
            {t(
              "health.records.describe.not_stored",
              "Shown here only — nothing from this reading was added to your timeline.",
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(answer.disclaimerKey, HEALTH_AI_DISCLOSURE)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            🤖 {t("health.ai.label", HEALTH_AI_LABEL)}
          </p>
          <AiOutputReport surface="health_ai_output" targetId={receipt ?? documentId} />
        </OniqCard>
      ) : null}
    </div>
  );
}
