import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { OniqCard, OniqChip, OniqEmpty, OniqSkeletonRows } from "@/components/oniq";
import { AiOutputReport } from "@/components/safety/AiOutputReport";
import { useT } from "@/lib/i18n/LanguageProvider";
import { HEALTH_UPLOADS_ENABLED } from "@/health/flags";
import { HealthAddReport, readStoredDocument } from "@/health/AddReport";
import { healthApi, type DocumentRow } from "@/health/api";

import {
  documentKindLabel,
  formatDate,
  provenanceLabel,
  reasonText,
  HEALTH_AI_LABEL,
} from "@/health/labels";

/**
 * ONIQ HEALTH — your reports. ONE ACTION: pick a file, and what it says is in
 * your timeline.
 *
 * OWNER DIRECTIVE, 2026-09-09: "the system is very complicated make it
 * simple", and, asked which complexity, they chose the app's steps. This
 * screen used to take eleven: choose a type from a dropdown, type a title,
 * choose a file, wait, find and tap Explain, read a note, scroll to a
 * suggestions card, tap Add to timeline three times, then switch tabs to see
 * them. It now takes one. The type defaults, the title is the filename, the
 * report is read the moment it finishes uploading, and the values it states
 * land in the timeline as ordinary records.
 *
 * WHAT WAS GIVEN UP, AND WHAT REPLACED IT. The per-value confirm step is
 * gone — the owner made that call with the cost stated. Three things carry
 * the weight instead, and none of them is a tap:
 *   - a value is stored only if it is PRINTED on the page
 *     (_shared/health/ai/grounding.ts), so a sentence on a report cannot talk
 *     the reader into a number the report does not carry;
 *   - every stored value renders with the AI-assisted label on the timeline,
 *     because its provenance is document_extraction (isAiDerived);
 *   - each one deletes in one tap, and the document it came from stays open
 *     next to it.
 * A wrongly-kept value is therefore visible and removable. That is the trade
 * the shape rests on, and it is why grounding is not optional here.
 *
 * THE BYTES NEVER PASS THROUGH THE SERVER. `documents.register` writes the
 * metadata row and hands back a signed-upload token for one path under the
 * person's own prefix; the file goes straight to the private bucket with
 * `uploadToSignedUrl`, which streams the Blob; `documents.confirm` checks the
 * object arrived at the declared size. Reads are 60-second signed URLs.
 *
 * THE FILE IS NEVER READ WHOLE. Only a 12-byte head is pulled through a
 * stream reader to check the magic bytes against the declared type
 * (`routes.test.ts` bans whole-file reads here).
 *
 * THE PICKER ITSELF LIVES IN src/health/AddReport.tsx and is rendered here
 * AND on the timeline — owner report 2026-09-09, "nowhere to upload", from
 * the timeline, which is where the 🩺 tile lands. The AI label and
 * <AiOutputReport /> went with it, and so did its playCompliance declaration:
 * this file now lists documents, and the component is the AI surface.
 */
export const Route = createFileRoute("/_authenticated/app/health/records")({
  component: HealthDocuments,
});

function HealthDocuments() {
  const { t, lang } = useT();
  const qc = useQueryClient();
  const [armed, setArmed] = useState<string | null>(null);
  // ANALYSE A DOCUMENT ALREADY STORED. The upload path reads a report as it
  // arrives; this is the same read, on demand, for everything uploaded before
  // that existed — and for a retry when a read failed. Owner report
  // 2026-09-09, "analysis is gone": the simplification removed the per-document
  // Explain button and left no way to read a stored report at all. Re-reading
  // is safe because the SERVER skips readings it already stored for the
  // document (health-ai insertCandidates); the client is not the authority.
  const [reading, setReading] = useState<string | null>(null);
  const [readNote, setReadNote] = useState<{ id: string; note: string } | null>(null);

  const docs = useQuery({
    queryKey: ["health", "documents"],
    queryFn: () => healthApi<DocumentRow[]>("documents.list"),
    enabled: HEALTH_UPLOADS_ENABLED,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await healthApi<{ id: string }>("documents.delete", { id });
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

  const open = useMutation({
    mutationFn: async (id: string) => {
      const res = await healthApi<{ url: string }>("documents.url", { id });
      if (!res.ok) throw new Error(reasonText(t, res));
      return res.data.url;
    },
    onSuccess: (url) => {
      window.open(url, "_blank", "noopener");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!HEALTH_UPLOADS_ENABLED) {
    return (
      <OniqEmpty
        emoji="📄"
        title={t("health.records.off", "Document uploads aren't switched on yet.")}
      />
    );
  }

  const rows = docs.data?.ok ? docs.data.data : [];

  return (
    <div className="space-y-4">
      <HealthAddReport />

      {docs.isPending ? (
        <OniqSkeletonRows rows={3} />
      ) : rows.length === 0 ? (
        <OniqEmpty emoji="📄" title={t("health.records.empty", "No documents yet.")} />
      ) : (
        <ul className="space-y-2" data-testid="health-documents">
          {rows.map((d) => (
            <li key={d.id}>
              <OniqCard variant="surface" padding="md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <OniqChip>{documentKindLabel(t, d.kind)}</OniqChip>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(d.capturedAt ?? d.createdAt, lang)}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-sm font-medium">{d.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {provenanceLabel(t, d.provenance?.source)} · {Math.round(d.sizeBytes / 1024)}{" "}
                      KB
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      type="button"
                      className="text-xs underline disabled:opacity-50"
                      data-testid="health-doc-analyse"
                      disabled={reading !== null}
                      onClick={() => {
                        setReading(d.id);
                        setReadNote(null);
                        void readStoredDocument(d.id, t)
                          .then((r) => setReadNote({ id: d.id, note: r.note }))
                          .finally(() => {
                            setReading(null);
                            void qc.invalidateQueries({ queryKey: ["health"] });
                          });
                      }}
                    >
                      {reading === d.id
                        ? t("health.records.reading", "Reading the report…")
                        : t("health.records.analyse", "Analyse")}
                    </button>
                    <button
                      type="button"
                      className="text-xs underline"
                      data-testid="health-doc-open"
                      onClick={() => open.mutate(d.id)}
                    >
                      {t("health.records.open", "Open")}
                    </button>
                    <button
                      type="button"
                      data-testid="health-doc-delete"
                      className="text-xs text-muted-foreground underline"
                      onClick={() => (armed === d.id ? remove.mutate(d.id) : setArmed(d.id))}
                    >
                      {armed === d.id
                        ? t("health.delete.confirm", "Delete for good?")
                        : t("health.delete", "Delete")}
                    </button>
                  </div>
                </div>
                {readNote?.id === d.id ? (
                  <div className="mt-2" data-testid="health-doc-analyse-note">
                    <p className="text-sm" role="status">
                      {readNote.note}
                    </p>
                    {/* The label goes where the output goes (owner directive
                        B12): this sentence is what the AI read back, so it
                        carries HEALTH_AI_LABEL and its report control exactly
                        as the upload path's note does. */}
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      🤖 {t("health.ai.label", HEALTH_AI_LABEL)}
                    </p>
                    <AiOutputReport surface="health_ai_output" targetId={d.id} />
                  </div>
                ) : null}
              </OniqCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
