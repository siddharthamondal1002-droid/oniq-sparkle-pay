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
import { useT } from "@/lib/i18n/LanguageProvider";
import { HEALTH_ENABLED } from "@/health/flags";
import { healthApi, type TimelineRow } from "@/health/api";
import { RECORD_KINDS, validateRecordInput, type RecordKind } from "@/health/domain";
import {
  formatDate,
  formatValue,
  kindLabel,
  needsAiLabel,
  provenanceLabel,
  reasonText,
  todayIso,
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
 * PHASE 1 RECORDS ARE ALL `user_entry`. When Phase 2 adds AI-extracted rows,
 * `needsAiLabel` becomes true for them, this file must join `AI_SURFACES` in
 * playCompliance.ts, and the row must render the AI label — the guard in
 * playCompliance.test.ts is what will say so.
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

  return (
    <div className="space-y-4">
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
                      {needsAiLabel(r.provenance?.source) ? "✨ " : ""}
                      {provenanceLabel(t, r.provenance?.source)}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="health-record-delete"
                    className="shrink-0 text-xs text-muted-foreground underline"
                    onClick={() => (armed === r.id ? remove.mutate(r.id) : setArmed(r.id))}
                  >
                    {armed === r.id
                      ? t("health.delete.confirm", "Delete for good?")
                      : t("health.delete", "Delete")}
                  </button>
                </div>
              </OniqCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
