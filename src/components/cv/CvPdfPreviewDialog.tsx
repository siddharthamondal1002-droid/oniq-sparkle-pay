// Preview-before-export step for the generated CV.
// The bytes are built once and reused for the preview, the download and the
// share sheet, so what you see is exactly what leaves the app.
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Download, FileText, Loader2, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { isShareCancelled } from "@/lib/saveFile";
import { defaultCvShareMessage } from "@/lib/cvShareMessage";

import type { CvDeclared, CvGenerated } from "@/lib/cvValidation";
import type { CvSectionKey } from "@/lib/cvSections";

type Built = { blob: Blob; filename: string; pages: number };

export function CvPdfPreviewDialog({
  declared,
  cv,
  order,
  onClose,
}: {
  declared: CvDeclared;
  cv: CvGenerated;
  /** Section order chosen in the workbench. */
  order?: readonly CvSectionKey[];
  onClose: () => void;
}) {
  const [built, setBuilt] = useState<Built | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<null | "download" | "share">(null);
  const [shareSubject, setShareSubject] = useState("");
  const [shareText, setShareText] = useState("");
  const [editingMessage, setEditingMessage] = useState(false);
  // Android/iOS WebViews cannot render a PDF in an iframe — no plugin behind it.
  const canEmbed = !Capacitor.isNativePlatform();
  const defaults = defaultCvShareMessage(declared.fullName);

  // Prefill the editable share message from the CV's name, once per name change.
  useEffect(() => {
    const d = defaultCvShareMessage(declared.fullName);
    setShareSubject(d.title);
    setShareText(d.text);
  }, [declared.fullName]);




  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { buildCvPdfBlob } = await import("@/lib/cvPdf");
        const result = await buildCvPdfBlob(declared, cv, order);
        if (cancelled) return;
        setBuilt(result);
        if (canEmbed) {
          objectUrl = URL.createObjectURL(result.blob);
          setUrl(objectUrl);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [declared, cv, order, canEmbed]);

  const download = async () => {
    if (!built) return;
    setBusy("download");
    try {
      const { deliverCvPdfBlob } = await import("@/lib/cvPdf");
      await deliverCvPdfBlob(built.filename, built.blob);
      toast.success(`Exported ${built.filename}`);
      onClose();
    } catch (e) {
      if (!isShareCancelled(e)) toast.error("Couldn't export the PDF. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    setBusy("share");
    let filename = built?.filename ?? "cv.pdf";
    try {
      // Always regenerate from the latest fields so the shared file can never
      // be a stale build from an earlier edit.
      const { buildCvPdfBlob, shareCvPdfBlob } = await import("@/lib/cvPdf");
      const fresh = await buildCvPdfBlob(declared, cv, order);
      filename = fresh.filename;
      setBuilt(fresh);
      if (canEmbed) {
        const objectUrl = URL.createObjectURL(fresh.blob);
        setUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return objectUrl;
        });
      }
      const how = await shareCvPdfBlob(fresh.filename, fresh.blob, declared.fullName, {
        title: shareSubject,
        text: shareText,
      });

      toast.success(
        how === "shared"
          ? `Shared ${fresh.filename}`
          : `Saved ${fresh.filename}`,
      );
      onClose();
    } catch (e) {
      if (isShareCancelled(e)) {
        toast(`Sharing cancelled — ${filename} wasn't sent`);
      } else {
        toast.error(`Couldn't share ${filename}. Try again.`);
      }
    } finally {
      setBusy(null);
    }
  };


  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Preview your CV</p>
          <p className="truncate text-[11px] text-white/50">
            {built
              ? `${built.filename} · ${built.pages} page${built.pages > 1 ? "s" : ""}`
              : "Building the PDF…"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="rounded-full bg-white/10 p-2 text-white"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mx-3 flex-1 overflow-hidden rounded-2xl bg-[#16181E]">
        {error ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/60">
            Couldn&apos;t build the preview. Close this and try again.
          </div>
        ) : !built ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-white/60">
            <Loader2 className="size-4 animate-spin" /> Preparing preview…
          </div>
        ) : canEmbed && url ? (
          <iframe title="CV PDF preview" src={url} className="size-full bg-white" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <FileText className="size-8 text-white/40" />
            <p className="text-sm text-white/70">
              {built.pages} page{built.pages > 1 ? "s" : ""} ready.
            </p>
            <p className="text-xs leading-relaxed text-white/45">
              Your device can&apos;t show a PDF inside the app. Save or share it to open the full
              layout in your PDF viewer.
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          disabled={!built || busy !== null}
          onClick={download}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          <Download className="size-4" /> {busy === "download" ? "Saving…" : "Download"}
        </button>
        <button
          type="button"
          disabled={!built || busy !== null}
          onClick={share}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#00D4B8] px-4 py-3 text-sm font-semibold text-black disabled:opacity-40"
        >
          <Share2 className="size-4" /> {busy === "share" ? "Preparing…" : "Share"}
        </button>
      </div>
    </div>
  );
}
