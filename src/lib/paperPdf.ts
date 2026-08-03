// Vector-text exam paper PDF. Built programmatically from the paper's
// structured question data — never by rasterising the DOM (html2canvas et al
// block the WebView main thread and ANR on multi-page papers).
import { Capacitor } from "@capacitor/core";

export type PaperPdfQuestion = {
  marks: number;
  question: string;
  /** MCQ options, if any. */
  options?: string[];
  /** Ruled answer lines to draw under the question. */
  answerLines: number;
};

export type PaperPdfSection = { label: string; items: PaperPdfQuestion[] };

export type PaperPdfInput = {
  board: string;
  classLabel: string;
  subject: string;
  totalMarks: number;
  time: string;
  sections: PaperPdfSection[];
};

const A4_W = 210;
const A4_H = 297;
const M = 15;
const CONTENT_W = A4_W - M * 2;
const BOTTOM = A4_H - M;

const yieldToLoop = () => new Promise<void>((r) => setTimeout(r, 0));

/** Reported as generation walks the paper, so the button is never a dead tap. */
export type PaperProgress = (done: number, total: number) => void;

export function paperFilename(subject: string): string {
  const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "paper";
  const d = new Date().toISOString().slice(0, 10);
  return `${slug}-question-paper-${d}.pdf`;
}

/** Build the PDF. Yields to the event loop on every page break. */
export async function buildPaperPdf(input: PaperPdfInput, onProgress?: PaperProgress) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });

  let y = M;
  let page = 1;

  const newPage = async () => {
    doc.addPage();
    page += 1;
    y = M;
    await yieldToLoop();
  };
  const ensure = async (needed: number) => {
    if (y + needed > BOTTOM - 6) await newPage();
  };

  // ---- header block ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(input.board.toUpperCase(), A4_W / 2, y + 4, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(input.classLabel, A4_W / 2, y + 9, { align: "center" });
  doc.setFontSize(10);
  doc.text(
    `Subject: ${input.subject}    Max Marks: ${input.totalMarks}    Time: ${input.time}`,
    A4_W / 2,
    y + 15,
    { align: "center" },
  );
  y += 19;
  doc.setLineWidth(0.3);
  doc.line(M, y, A4_W - M, y);
  y += 8;

  const totalQuestions = input.sections.reduce((n, sec) => n + sec.items.length, 0);
  let counter = 0;
  for (const section of input.sections) {
    await ensure(16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(section.label.toUpperCase(), A4_W / 2, y, { align: "center" });
    y += 7;

    for (const q of section.items) {
      counter += 1;
      const marksLabel = `[${q.marks} ${q.marks === 1 ? "mark" : "marks"}]`;
      const numText = `Q${counter}.`;
      const numW = 12;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      const body = doc.splitTextToSize(q.question, CONTENT_W - numW - 22) as string[];

      // Never split the question header from its first body line.
      await ensure(6 + 5);

      doc.setFont("helvetica", "bold");
      doc.text(numText, M, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(marksLabel, A4_W - M, y, { align: "right" });
      doc.setFontSize(11);

      for (const line of body) {
        doc.text(line, M + numW, y);
        y += 5.2;
        if (y > BOTTOM - 6) await newPage();
      }
      y += 1.5;

      if (q.options?.length) {
        doc.setFontSize(10);
        for (let i = 0; i < q.options.length; i++) {
          const label = String.fromCharCode(65 + i);
          const optLines = doc.splitTextToSize(`${label}. ${q.options[i]}`, CONTENT_W - numW - 6) as string[];
          for (const ol of optLines) {
            if (y > BOTTOM - 6) await newPage();
            doc.text(ol, M + numW + 4, y);
            y += 4.8;
          }
        }
        doc.setFontSize(11);
      }

      if (q.answerLines > 0) {
        doc.setDrawColor(180);
        doc.setLineWidth(0.15);
        for (let i = 0; i < q.answerLines; i++) {
          if (y > BOTTOM - 6) await newPage();
          y += 6.5;
          doc.line(M + numW, y, A4_W - M, y);
        }
        doc.setDrawColor(0);
      }
      y += 6;
      onProgress?.(counter, totalQuestions);
      // Yield every few questions as well as on page breaks: a 100-question
      // paper is otherwise one long synchronous pass that ANRs the WebView.
      if (counter % 3 === 0) await yieldToLoop();
    }
    y += 2;
  }

  await ensure(10);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.text("— End of paper —", A4_W / 2, y + 4, { align: "center" });

  // Page numbers.
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Page ${p} of ${total}`, A4_W / 2, A4_H - 8, { align: "center" });
    doc.setTextColor(0);
  }
  return doc;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Hand a generated file to the OS.
 *
 * Native: an <a download> or window.print() cannot save anything inside a
 * Capacitor WebView — there is no download manager behind it. We write the
 * bytes into the app's Cache dir (scoped storage: NO runtime storage
 * permission needed) and open the system share/save sheet, which is the
 * supported way to land a file on the device.
 *
 * Web: the ordinary anchor download, unchanged.
 */
async function deliverFile(
  filename: string,
  mime: string,
  base64: string,
  blob: Blob,
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const path = `papers/${filename}`;
    await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    const { Share } = await import("@capacitor/share");
    await Share.share({ title: filename, dialogTitle: "Save or share paper", files: [uri] });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  void mime;
}

/** Build + deliver the vector PDF. */
export async function exportPaperPdf(
  input: PaperPdfInput,
  onProgress?: PaperProgress,
): Promise<{ bytes: number; filename: string }> {
  const doc = await buildPaperPdf(input, onProgress);
  const filename = paperFilename(input.subject);
  const buf = doc.output("arraybuffer") as ArrayBuffer;
  await deliverFile(
    filename,
    "application/pdf",
    toBase64(buf),
    new Blob([buf], { type: "application/pdf" }),
  );
  return { bytes: buf.byteLength, filename };
}

/**
 * Non-Latin fallback. jsPDF's built-in fonts are WinAnsi-only and jsPDF has no
 * complex-script shaping engine, so Devanagari/Tamil/Arabic cannot be embedded
 * correctly as vector text (glyphs would reorder and matras detach). We save a
 * self-contained HTML paper instead: it renders through the OS text stack in
 * any viewer, and can be printed to PDF from there with correct shaping.
 */
export async function exportPaperHtml(
  html: string,
  subject: string,
): Promise<{ filename: string }> {
  const filename = paperFilename(subject).replace(/\.pdf$/, ".html");
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const base64 = toBase64(await blob.arrayBuffer());
  await deliverFile(filename, "text/html", base64, blob);
  return { filename };
}
