import { useState } from "react";
import { OniqCard } from "@/components/oniq";
import { useT } from "@/lib/i18n/LanguageProvider";
import { healthApi } from "@/health/api";
import { reasonText } from "@/health/labels";
import { fill } from "@/health/i18n";

/**
 * ONIQ HEALTH — looking at a scan you uploaded. Owner directive 2026-09-10,
 * "B and C"; this is B.
 *
 * **IT IS NOT AN AI SURFACE, AND THAT IS A DELIBERATE CLAIM RATHER THAN AN
 * OMISSION.** Nothing here is generated, inferred or interpreted: the server
 * decodes a file the person uploaded and re-encodes its pixels as a PNG or
 * hands back the JPEG the file already contained. Putting `HEALTH_AI_LABEL` on
 * it would be a FALSE claim pointing the other way — the mirror of the
 * 2026-09-06 case where a photo the person took was nearly labelled
 * "AI-generated". Over-label AI, never under-label it; but a re-encoding is
 * not AI, and saying it is trains people to ignore the label where it matters.
 *
 * `playCompliance.test.ts` therefore does NOT list this file, and that absence
 * is the assertion: `scanPreview.test.ts` fails if the label appears here.
 *
 * WHAT IT SHOWS BESIDE THE IMAGE is the file's own header — modality, body
 * part, study date — and nothing else. `dicom.ts` reads no patient name, id,
 * birth date, accession number or referring physician, so there is nothing
 * here that could leak one. The summary line is assembled from those fields
 * and states no finding: "X-ray chest (2026-09-01)" is a description of the
 * FILE, never of what is in the picture.
 *
 * THE PREVIEW IS DOWNSCALED AND SAYS SO. The stored original is untouched and
 * "Download" still hands back a signed link to every byte of it — which is the
 * copy that matters if it ever goes to a radiologist.
 */
type Study = {
  modality: string | null;
  modalityLabel: string | null;
  bodyPart: string | null;
  studyDate: string | null;
  description: string | null;
  frames: number;
  summary: string;
};

type Preview = {
  image: string;
  method: "jpeg_passthrough" | "windowed_png";
  width: number;
  height: number;
  downscaledFrom: { width: number; height: number } | null;
  study: Study;
};

export function HealthScanPreview({ documentId }: { documentId: string }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  async function view() {
    setBusy(true);
    setError(null);
    const res = await healthApi<Preview>("documents.preview", { id: documentId });
    setBusy(false);
    if (!res.ok) {
      setPreview(null);
      // WHY IT COULD NOT BE OPENED, IN THE FORMAT'S OWN WORDS. The server
      // sends the transfer syntax's name for a scan it cannot decode — "JPEG
      // 2000 Lossless" rather than "unsupported" — because a refusal with no
      // reason is what gets the same file uploaded five times.
      const detail = res.format;
      setError(
        detail
          ? fill(t("health.scan.unreadable", "ONIQ cannot open this scan format ({format})."), {
              format: detail,
            })
          : reasonText(t, res),
      );
      return;
    }
    setPreview(res.data);
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-xs underline disabled:opacity-50"
        data-testid="health-scan-view"
        disabled={busy}
        onClick={() => void view()}
      >
        {busy
          ? t("health.scan.opening", "Opening the scan…")
          : preview
            ? t("health.scan.again", "Show it again")
            : t("health.scan.view", "View the scan")}
      </button>

      {error ? (
        <p className="mt-1 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {preview ? (
        <OniqCard variant="surface" padding="md" testId="health-scan-image">
          <img
            src={preview.image}
            // THE ALT TEXT IS THE HEADER, NOT A READING. A screen reader must
            // get what the file says it is and nothing anyone could mistake
            // for a finding.
            alt={preview.study.summary}
            className="mx-auto max-h-[70vh] w-auto max-w-full rounded bg-black"
          />
          <p className="mt-2 text-sm font-medium">{preview.study.summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {preview.downscaledFrom
              ? fill(
                  t(
                    "health.scan.downscaled",
                    "Shown at {w}×{h}, reduced from {ow}×{oh}. Download gives you the original.",
                  ),
                  {
                    w: String(preview.width),
                    h: String(preview.height),
                    ow: String(preview.downscaledFrom.width),
                    oh: String(preview.downscaledFrom.height),
                  },
                )
              : fill(t("health.scan.size", "Shown at {w}×{h}."), {
                  w: String(preview.width),
                  h: String(preview.height),
                })}
          </p>
          {preview.study.frames > 1 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {fill(
                t(
                  "health.scan.frames",
                  "This file holds {n} frames; the first one is shown. ONIQ takes one image, not a whole study.",
                ),
                { n: String(preview.study.frames) },
              )}
            </p>
          ) : null}
          {/* THE LINE THAT KEEPS THIS HONEST. ONIQ decoded a picture; it did
              not look at it. Without this a person can reasonably read the
              act of "ONIQ opening my X-ray" as ONIQ having checked it. */}
          <p className="mt-3 text-xs text-muted-foreground" data-testid="health-scan-not-read">
            {t(
              "health.scan.not_read",
              "ONIQ has shown you this image, not read it. Nobody and nothing has checked it for findings — that is for a doctor.",
            )}
          </p>
        </OniqCard>
      ) : null}
    </div>
  );
}
