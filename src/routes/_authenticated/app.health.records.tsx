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
import { useT } from "@/lib/i18n/LanguageProvider";
import { HEALTH_UPLOADS_ENABLED } from "@/health/flags";
import { healthApi, type DocumentRow, type RegisteredUpload } from "@/health/api";
import {
  DOCUMENT_KINDS,
  DOCUMENT_MIMES,
  MAX_DOCUMENT_BYTES,
  sniffDocumentMime,
  type DocumentKind,
  type DocumentMime,
} from "@/health/domain";
import { documentKindLabel, formatDate, provenanceLabel, reasonText } from "@/health/labels";

/**
 * ONIQ HEALTH — documents: a report, a prescription, a discharge summary.
 *
 * THE BYTES NEVER PASS THROUGH THE SERVER. `documents.register` writes the
 * metadata row and hands back a signed-upload token for one path under the
 * person's own prefix; the file goes straight to the private bucket with
 * `uploadToSignedUrl`, which streams the Blob; `documents.confirm` checks the
 * object exists at the declared size. Reads are 60-second signed URLs minted
 * per request and audited.
 *
 * THE FILE IS NEVER READ WHOLE. Only a 12-byte head is pulled through a
 * stream reader to check the magic bytes against the declared type; the
 * whole-file reads are banned on upload paths repo-wide (actorPhoto.test.ts
 * records why) and `routes.test.ts` bans them here.
 */
export const Route = createFileRoute("/_authenticated/app/health/records")({
  component: HealthDocuments,
});

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
  const [kind, setKind] = useState<DocumentKind>("lab_report");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentNeeded, setConsentNeeded] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);

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

  const badFile = () =>
    setError(t("health.records.badfile", "Only PDF, JPEG, PNG or WebP, under 10 MB."));

  async function attachFile(file: File) {
    setError(null);
    setConsentNeeded(false);
    const declared = file.type as DocumentMime;
    if (!(DOCUMENT_MIMES as readonly string[]).includes(declared)) return badFile();
    if (file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) return badFile();
    const sniffed = sniffDocumentMime(await headBytes(file));
    if (sniffed !== declared) return badFile();

    setBusy(true);
    try {
      const reg = await healthApi<RegisteredUpload>("documents.register", {
        document: {
          kind,
          title: title.trim() || file.name.slice(0, 120),
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
      toast.success(t("health.records.uploaded", "Stored."));
      setTitle("");
      void qc.invalidateQueries({ queryKey: ["health"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("health.error.generic", "Something went wrong."));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const rows = docs.data?.ok ? docs.data.data : [];

  return (
    <div className="space-y-4">
      <OniqCard variant="surface" padding="md" testId="health-upload">
        <OniqSectionHeader title={t("health.records.pick", "Upload a report")} />
        <div className="mt-3 grid gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="health-doc-kind">
            {t("health.records.kind", "Document type")}
          </label>
          <select
            id="health-doc-kind"
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as DocumentKind)}
          >
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {documentKindLabel(t, k)}
              </option>
            ))}
          </select>
          <input
            aria-label={t("health.records.title", "Title")}
            placeholder={t("health.records.title", "Title")}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            ref={inputRef}
            type="file"
            accept={DOCUMENT_MIMES.join(",")}
            className="text-sm"
            disabled={busy}
            data-testid="health-doc-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void attachFile(f);
            }}
          />
          {busy ? (
            <p className="text-sm text-muted-foreground">
              {t("health.records.uploading", "Uploading…")}
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
