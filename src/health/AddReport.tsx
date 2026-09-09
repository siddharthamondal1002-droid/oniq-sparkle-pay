import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { OniqCard, OniqSectionHeader } from "@/components/oniq";
import { AiOutputReport } from "@/components/safety/AiOutputReport";
import { useT } from "@/lib/i18n/LanguageProvider";
import { HEALTH_AI_ENABLED, HEALTH_UPLOADS_ENABLED } from "@/health/flags";
import { HEALTH_ROUTE } from "@/health/doors";
import { healthApi, type HealthStatus, type RegisteredUpload } from "@/health/api";
import { healthAi } from "@/health/ai/client";
import {
  DOCUMENT_MIMES,
  MAX_DOCUMENT_BYTES,
  sniffDocumentMime,
  type DocumentMime,
} from "@/health/domain";
import { fill } from "@/health/i18n";
import { reasonText, HEALTH_AI_LABEL } from "@/health/labels";

/**
 * ONIQ HEALTH — "Add a report", the one action, as a component both health
 * screens render.
 *
 * WHY IT IS A COMPONENT AND NOT A SCREEN. Owner report, 2026-09-09:
 * _"nowhere to upload"_ — from the Health TIMELINE, which is where the 🩺
 * tile lands. The picker existed, was ungated, and was served correctly; it
 * simply lived one tab across, behind a label ("Documents") that nobody
 * looking to add a report reads as the way to add a report. That is
 * `upiDoors` and `/app/creations` for the third time in this repo: **a
 * feature is where its doors are.** So the door moved to the landing screen
 * rather than a sign being hung pointing at it.
 *
 * ONE COMPONENT, ONE COPY OF THE STATE. It owns busy / error / consent /
 * note itself, exactly as OniqDeleteCreation does (2026-09-07): the
 * alternative — the same picker written twice — is two places for the upload
 * step to drift, and the drift would be silent because both would still
 * compile and both would still upload.
 *
 * THE BYTES NEVER PASS THROUGH THE SERVER. `documents.register` writes the
 * metadata row and hands back a signed-upload token for one path under the
 * person's own prefix; the file goes straight to the private bucket with
 * `uploadToSignedUrl`, which streams the Blob; `documents.confirm` checks the
 * object arrived at the declared size.
 *
 * THE FILE IS NEVER READ WHOLE. Only a 12-byte head is pulled through a
 * stream reader to check the magic bytes against the declared type — the
 * `megaLoopGuardrails` shape, and `routes.test.ts` bans whole-file reads on
 * this path.
 *
 * This is an AI surface: it carries HEALTH_AI_LABEL ("AI-assisted", owner
 * directive B12) and <AiOutputReport />, and is declared in playCompliance.ts
 * under `health_ai_output` — the declaration moved here with the output.
 */

/** The shape of `t` from useT, narrowed to what this module needs. */
type Translate = (key: string, fallback?: string) => string;

/**
 * READ ONE STORED DOCUMENT AND SAY WHAT HAPPENED, in one sentence.
 *
 * Shared by the upload path here and the "Analyse" control on every stored
 * document (app.health.records.tsx), so the two cannot describe the same
 * outcome differently — the wording is the part a person reads, and two copies
 * of it drift the first time one is edited.
 *
 * THE ZERO CASE NO LONGER CLAIMS WHY. It used to say "No lab values or vitals
 * were found in that document." Since a document can be read TWICE and the
 * server now skips readings it already stored, zero can equally mean "found,
 * already yours" — and the old sentence would then be simply false. This says
 * only what is true in both cases.
 */
export async function readStoredDocument(
  documentId: string,
  t: Translate,
): Promise<{ ok: boolean; note: string }> {
  const res = await healthAi("extract_document", { documentId });
  if (!res.ok) return { ok: false, note: reasonText(t, res) };
  const n = res.data.kind === "extraction" ? res.data.candidates : 0;
  return {
    ok: true,
    note:
      n > 0
        ? fill(
            t("health.records.read", "{count} readings from that report are in your timeline."),
            {
              count: String(n),
            },
          )
        : // WHAT ONIQ CAN READ, SAID OUT LOUD. Owner report 2026-09-09, "no
          // result came up on an xray report": the note said only "nothing new
          // was added", which reads as a failure when the truth is that there
          // was nothing here for ONIQ to find. Extraction stores a value only
          // when it matches one of ~28 numeric blood and urine analytes; a
          // radiology report is findings and an impression, and names none of
          // them. Saying so is the difference between a person retrying twice
          // (which is what happened, and cost two paid reads) and knowing.
          t(
            "health.records.no_values",
            "No lab values found. ONIQ reads numbers from blood and urine reports — a scan or X-ray report has none for it to read.",
          ),
  };
}

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

/**
 * @param showTimelineLink false on the timeline itself, where "See your
 *   timeline" would point at the screen the person is already reading.
 */
export function HealthAddReport({ showTimelineLink = true }: { showTimelineLink?: boolean }) {
  const { t } = useT();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"uploading" | "reading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consentNeeded, setConsentNeeded] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["health", "status"],
    queryFn: () => healthApi<HealthStatus>("status"),
    enabled: HEALTH_UPLOADS_ENABLED,
  });

  if (!HEALTH_UPLOADS_ENABLED) return null;

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
    const read = await readStoredDocument(documentId, t);
    // The report is stored either way; only the reading can fail. Say which.
    setNote(read.ok ? read.note : `${t("health.records.uploaded", "Stored.")} ${read.note}`);
    setBusy(null);
    if (inputRef.current) inputRef.current.value = "";
    void qc.invalidateQueries({ queryKey: ["health"] });
  }

  return (
    <>
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
          {showTimelineLink ? (
            <Link to={HEALTH_ROUTE} className="mt-2 inline-block text-sm underline">
              {t("health.records.see_timeline", "See your timeline")}
            </Link>
          ) : null}
          <p className="mt-3 text-[11px] text-muted-foreground">
            🤖 {t("health.ai.label", HEALTH_AI_LABEL)}
          </p>
          <AiOutputReport surface="health_ai_output" targetId="health-read-result" />
        </OniqCard>
      ) : null}
    </>
  );
}
