// Preview-before-export step for the generated CV.
// The bytes are built once and reused for the preview, the download and the
// share sheet, so what you see is exactly what leaves the app.
import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  Download,
  FileText,
  Loader2,
  Maximize2,
  Pencil,
  Printer,
  Share2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { isShareCancelled } from "@/lib/saveFile";
import { defaultCvShareMessage } from "@/lib/cvShareMessage";

import type { CvDeclared, CvGenerated } from "@/lib/cvValidation";
import type { CvInclude, CvSectionKey } from "@/lib/cvSections";
import type { CvTemplateId } from "@/lib/cvTemplates";

type Built = { blob: Blob; filename: string; pages: number };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

export function CvPdfPreviewDialog({
  declared,
  cv,
  order,
  template,
  include,
  onClose,
}: {
  declared: CvDeclared;
  cv: CvGenerated;
  /** Section order chosen in the workbench. */
  order?: readonly CvSectionKey[];
  /** Layout template chosen in the workbench. */
  template?: CvTemplateId;
  /** Sections switched on/off in the workbench. */
  include?: Partial<CvInclude>;
  onClose: () => void;
}) {

  const [built, setBuilt] = useState<Built | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<null | "download" | "share" | "print">(null);
  // Hidden iframe used to hand the PDF to the browser's print dialog.
  const printFrameRef = useRef<HTMLIFrameElement | null>(null);
  const [shareSubject, setShareSubject] = useState("");
  const [shareText, setShareText] = useState("");
  const [editingMessage, setEditingMessage] = useState(false);
  // Build progress for the PDF bytes (0–100) plus a "taking a while" hint.
  const [progress, setProgress] = useState(0);
  const [slow, setSlow] = useState(false);
  // Android/iOS WebViews cannot render a PDF in an iframe — no plugin behind it.
  const canEmbed = !Capacitor.isNativePlatform();
  const defaults = defaultCvShareMessage(declared.fullName);

  // Zoom for the embedded preview so fine details can be inspected.
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const zoomBy = useCallback((factor: number) => {
    setZoom((prev) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev * factor));
      const el = viewportRef.current;
      if (el && next !== prev) {
        // Keep the centre of the visible area anchored while zooming.
        const k = next / prev;
        const cx = el.scrollLeft + el.clientWidth / 2;
        const cy = el.scrollTop + el.clientHeight / 2;
        requestAnimationFrame(() => {
          el.scrollLeft = cx * k - el.clientWidth / 2;
          el.scrollTop = cy * k - el.clientHeight / 2;
        });
      }
      return next;
    });
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
    const el = viewportRef.current;
    if (el) requestAnimationFrame(() => el.scrollTo({ top: 0, left: 0 }));
  }, []);

  // Prefill the editable share message from the CV's name, once per name change.
  useEffect(() => {
    const d = defaultCvShareMessage(declared.fullName);
    setShareSubject(d.title);
    setShareText(d.text);
  }, [declared.fullName]);




  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    // Drive a visible progress bar while the bytes are built. The build is a
    // single synchronous jsPDF pass, so this is a time-based estimate that
    // never claims completion until the blob actually exists.
    const started = Date.now();
    setProgress(4);
    setSlow(false);
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - started;
      setSlow(elapsed > 6000);
      // Ease towards 92% and stop; the final jump to 100% is real.
      setProgress((p) => (p >= 92 ? p : p + Math.max(1, (92 - p) * 0.12)));
    }, 160);
    (async () => {
      try {
        const { buildCvPdfBlob } = await import("@/lib/cvPdf");
        const result = await buildCvPdfBlob(declared, cv, order, template, include);
        if (cancelled) return;
        setProgress(100);
        setBuilt(result);
        if (canEmbed) {
          objectUrl = URL.createObjectURL(result.blob);
          setUrl(objectUrl);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        window.clearInterval(tick);
      }
    })();
    return () => {
      window.clearInterval(tick);

      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [declared, cv, order, template, include, canEmbed]);

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

  // One-click print. On the web the freshly built bytes are loaded into a
  // hidden iframe and handed to the browser's print dialog; inside the native
  // app there is no print API, so the OS share sheet (which offers Print /
  // AirPrint) is used instead.
  const print = async () => {
    setBusy("print");
    let filename = built?.filename ?? "cv.pdf";
    try {
      const { buildCvPdfBlob, shareCvPdfBlob } = await import("@/lib/cvPdf");
      // Always print the latest fields, never a stale build.
      const fresh = await buildCvPdfBlob(declared, cv, order, template, include);
      filename = fresh.filename;
      setBuilt(fresh);

      if (!canEmbed) {
        await shareCvPdfBlob(fresh.filename, fresh.blob, declared.fullName, {
          title: shareSubject,
          text: shareText,
        });
        toast.success(`Choose Print in the sheet to print ${filename}`);
        return;
      }

      const objectUrl = URL.createObjectURL(fresh.blob);
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return objectUrl;
      });

      const frame = printFrameRef.current;
      if (!frame) throw new Error("print frame missing");

      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("print timeout")), 15000);
        frame.onload = () => {
          window.clearTimeout(timeout);
          try {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
            resolve();
          } catch (err) {
            reject(err);
          }
        };
        frame.src = objectUrl;
      });

      toast.success(`Print dialog opened for ${filename}`);
    } catch {
      // Some browsers refuse to print a PDF from an iframe — open it in a tab
      // so the built-in viewer's own print button is available.
      if (canEmbed && url) {
        window.open(url, "_blank", "noopener,noreferrer");
        toast(`Opened ${filename} in a new tab — use your viewer's print button`);
      } else {
        toast.error(`Couldn't print ${filename}. Try downloading it instead.`);
      }
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
      const fresh = await buildCvPdfBlob(declared, cv, order, template, include);
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
          <div
            role="status"
            aria-live="polite"
            className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center"
          >
            <Loader2 className="size-6 animate-spin text-[#00D4B8]" />
            <p className="text-sm font-medium text-white/80">
              Generating your PDF… {Math.round(progress)}%
            </p>
            <div
              className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              aria-label="PDF generation progress"
            >
              <div
                className="h-full rounded-full bg-[#00D4B8] transition-[width] duration-200 ease-out"
                style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
              />
            </div>
            <p className="text-[11px] leading-relaxed text-white/45">
              {slow
                ? "Still working — long CVs with lots of sections take a few extra seconds."
                : "Laying out pages and embedding fonts."}
            </p>
          </div>

        ) : canEmbed && url ? (
          <div ref={viewportRef} className="size-full overflow-auto">
            {/* The iframe is laid out at 1/zoom of the viewport and scaled up,
                so zooming grows the scrollable area instead of cropping it. */}
            <div
              style={{
                width: `${100 / zoom}%`,
                height: `${100 / zoom}%`,
                transform: `scale(${zoom})`,
                transformOrigin: "0 0",
              }}
            >
              <iframe title="CV PDF preview" src={url} className="size-full bg-white" />
            </div>
          </div>
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

      {canEmbed && url && !error && (
        <div className="mx-3 mt-2 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.25)}
            disabled={zoom <= MIN_ZOOM + 0.001}
            aria-label="Zoom out"
            className="rounded-full bg-white/10 p-2 text-white disabled:opacity-40"
          >
            <ZoomOut className="size-4" />
          </button>
          <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-white/60">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => zoomBy(1.25)}
            disabled={zoom >= MAX_ZOOM - 0.001}
            aria-label="Zoom in"
            className="rounded-full bg-white/10 p-2 text-white disabled:opacity-40"
          >
            <ZoomIn className="size-4" />
          </button>
          <button
            type="button"
            onClick={resetZoom}
            aria-label="Reset zoom to fit"
            className="ml-1 flex items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-[11px] font-medium text-white"
          >
            <Maximize2 className="size-3.5" /> Fit
          </button>
        </div>
      )}



      <div className="mx-3 mt-3 rounded-2xl bg-[#16181E] p-3">
        <button
          type="button"
          onClick={() => setEditingMessage((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
          aria-expanded={editingMessage}
        >
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-white">Share message</span>
            <span className="block truncate text-[11px] text-white/45">
              {shareSubject || defaults.title}
            </span>
          </span>
          <Pencil className="size-4 shrink-0 text-white/50" />
        </button>

        {editingMessage && (
          <div className="mt-3 space-y-2">
            <label className="block">
              <span className="mb-1 block text-[11px] text-white/45">Subject</span>
              <input
                value={shareSubject}
                onChange={(e) => setShareSubject(e.target.value)}
                maxLength={120}
                placeholder={defaults.title}
                className="w-full rounded-xl bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:ring-1 focus:ring-[#00D4B8]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-white/45">Short message</span>
              <textarea
                value={shareText}
                onChange={(e) => setShareText(e.target.value)}
                maxLength={280}
                rows={2}
                placeholder={defaults.text}
                className="w-full resize-none rounded-xl bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:ring-1 focus:ring-[#00D4B8]"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setShareSubject(defaults.title);
                setShareText(defaults.text);
              }}
              className="text-[11px] font-medium text-[#00D4B8]"
            >
              Reset to default
            </button>
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
          onClick={print}
          aria-label="Print CV"
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          <Printer className="size-4" /> {busy === "print" ? "Printing…" : "Print"}
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

      {/* Off-screen target for the browser print dialog. */}
      {canEmbed && (
        <iframe
          ref={printFrameRef}
          title="CV print"
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none fixed left-[-9999px] top-0 size-px opacity-0"
        />
      )}

    </div>
  );
}
