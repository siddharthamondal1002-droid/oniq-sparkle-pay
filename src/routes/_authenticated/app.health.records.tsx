import { useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  OniqCard,
  OniqChip,
  OniqEmpty,
  OniqSectionHeader,
  OniqSkeletonRows,
} from "@/components/oniq";
import { AiOutputReport } from "@/components/safety/AiOutputReport";
import { useT } from "@/lib/i18n/LanguageProvider";
import { HEALTH_AI_ENABLED, HEALTH_UPLOADS_ENABLED } from "@/health/flags";
import { HEALTH_ROUTE } from "@/health/doors";
import {
  healthApi,
  type DocumentRow,
  type HealthStatus,
  type RegisteredUpload,
} from "@/health/api";
import { healthAi } from "@/health/ai/client";
import {
  DOCUMENT_MIMES,
  MAX_DOCUMENT_BYTES,
  sniffDocumentMime,
  type DocumentMime,
} from "@/health/domain";
import { fill } from "@/health/i18n";
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
 * This is an AI surface: it carries HEALTH_AI_LABEL ("AI-assisted", owner
 * directive B12) and <AiOutputReport />, and is declared in playCompliance.ts.
 */
export const Route = createFileRoute("/_authenticated/app/health/records")({
  component: HealthDocuments,
});

/** Everything ONIQ can read values out of arrives as one of these; the kind is metadata. */
const DEFAULT_KIND = "lab_report";

async function headBytes(file: Blob, n = 12): Promise<Uint8Array> {
  const reader = file.stream().getReader();
  const bytes: number[] = [];
  try {
    while (bytes.length < n) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      for (const b of value) {
        bytes.push(b);
        if (bytes.length >= n) break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Uint8Array.from(bytes);
}

function HealthDocuments() {
  const { t, lang } = useT();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"uploading" | "reading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consentNeeded, setConsentNeeded] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const docs = useQuery({
    queryKey: ["health", "documents"],
    queryFn: () => healthApi<DocumentRow[]>("documents.list"),
    enabled: HEALTH_UPLOADS_ENABLED,
  });

  const status = useQuery({
    queryKey: ["health", "status"],
    queryFn: () => healthApi<HealthStatus>("status"),
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

  const aiAvailable =
    HEALTH_AI_ENABLED && (status.data?.ok ? status.data.data.aiAvailable === true : false);

  const badFile = () =>
    setError(t("health.records.badfile", "Only PDF, JPEG, PNG or WebP, under 10 MB."));

  /**
   * THE ONE ACTION. Validate, upload, and — when the AI is available — read
   * the report, all from a single file choice. A failure to READ is not a
   * failure to STORE: the document is safely uploaded either way, and the
   * note says which happened.
   */
  async function attachFile(file: File) {
    setError(null);
    setNote(null);
    setConsentNeeded(false);
    const declared = file.type as DocumentMime;
    if (!(DOCUMENT_MIMES as readonly string[]).includes(declared)) return badFile();
    if (file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) return badFile();
    const sniffed = sniffDocumentMime(await headBytes(file));
    if (sniffed !== declared) return badFile();

    setBusy("uploading");
    let documentId: string | null = null;
    try {
      const reg = await healthApi<RegisteredUpload>("documents.register", {
        document: {
          kind: DEFAULT_KIND,
          title: file.name.slice(0, 120),
          mime: declared,
          sizeBytes: file.size,
        },
      });
      if (!reg.ok) {
        if (reg.reason === "consent_required") setConsentNeeded(true);
        throw new Error(reasonText(t, reg));
      }
      const up = await supabase.storage
        .from(reg.data.bucket)
        .uploadToSignedUrl(reg.data.path, reg.data.token, file, { contentType: declared });
      if (up.error) throw new Error(t("health.error.generic", "Something went wrong. Try again."));
      const confirmed = await healthApi<{ id: string }>("documents.confirm", { id: reg.data.id });
      if (!confirmed.ok) throw new Error(reasonText(t, confirmed));
      documentId = reg.data.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("health.error.generic", "Something went wrong."));
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    if (!aiAvailable) {
      toast.success(t("health.records.uploaded", "Stored."));
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["health"] });
      return;
    }

    setBusy("reading");
    const res = await healthAi("extract_document", { documentId });
    if (!res.ok) {
      // The report is stored; only the reading failed. Say exactly that.
      setNote(`${t("health.records.uploaded", "Stored.")} ${reasonText(t, res)}`);
    } else {
      const n = res.data.kind === "extraction" ? res.data.candidates : 0;
      setNote(
        n > 0
          ? fill(
              t("health.records.read", "{count} readings from that report are in your timeline."),
              { count: String(n) },
            )
          : t("health.ai.read.nothing", "No lab values or vitals were found in that document."),
      );
    }
    setBusy(null);
    if (inputRef.current) inputRef.current.value = "";
    void qc.invalidateQueries({ queryKey: ["health"] });
  }

  const rows = docs.data?.ok ? docs.data.data : [];

  return (
    <div className="space-y-4">
      <OniqCard variant="surface" padding="md" testId="health-upload">
        <OniqSectionHeader title={t("health.records.pick", "Add a report")} />
        <p className="mt-1 text-xs text-muted-foreground">
          {aiAvailable
            ? t(
                "health.records.ai_note",
                "Pick a report and ONIQ reads it: its text — or, for a photo or scan, the file itself — goes to Google Cloud Vertex AI (Gemini), and the readings it states go into your timeline, labelled AI-assisted. Nothing is sent until you pick a file.",
              )
            : t(
                "health.records.plain_note",
                "Your reports are stored privately. Only you can open them.",
              )}
        </p>
        <div className="mt-3 grid gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={DOCUMENT_MIMES.join(",")}
            className="text-sm"
            disabled={busy !== null}
            data-testid="health-doc-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void attachFile(f);
            }}
          />
          {busy ? (
            <p className="text-sm text-muted-foreground" role="status">
              {busy === "uploading"
                ? t("health.records.uploading", "Uploading…")
                : t("health.records.reading", "Reading the report…")}
            </p>
          ) : consentNeeded ? (
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
        </div>
      </OniqCard>

      {note ? (
        <OniqCard variant="surface" padding="md" testId="health-read-result">
          <p className="text-sm" data-testid="health-ai-note" role="status">
            {note}
          </p>
          <Link to={HEALTH_ROUTE} className="mt-2 inline-block text-sm underline">
            {t("health.records.see_timeline", "See your timeline")}
          </Link>
          <p className="mt-3 text-[11px] text-muted-foreground">
            🤖 {t("health.ai.label", HEALTH_AI_LABEL)}
          </p>
          <AiOutputReport surface="health_ai_output" targetId="health-read-result" />
        </OniqCard>
      ) : null}

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
              </OniqCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
