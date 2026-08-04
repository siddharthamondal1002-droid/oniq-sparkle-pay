// One-click CV export. Vector text via jsPDF — never a DOM rasterisation
// (html2canvas blocks the WebView main thread and ANRs on multi-page docs).
import { deliverFile } from "@/lib/saveFile";
import type { CvDeclared, CvGenerated } from "@/lib/cvValidation";

const A4_W = 210;
const A4_H = 297;
const M = 16;
const CONTENT_W = A4_W - M * 2;
const BOTTOM = A4_H - M;

export function cvFilename(fullName: string): string {
  const slug =
    (fullName || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my";
  return `${slug}-cv-${new Date().toISOString().slice(0, 10)}.pdf`;
}

export async function buildCvPdf(declared: CvDeclared, cv: CvGenerated) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });

  let y = M;
  const page = () => {
    doc.addPage();
    y = M;
  };
  const ensure = (needed: number) => {
    if (y + needed > BOTTOM) page();
  };
  const para = (text: string, size: number, style: "normal" | "bold" | "italic", gap = 4.6) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    for (const line of doc.splitTextToSize(text, CONTENT_W) as string[]) {
      ensure(gap);
      doc.text(line, M, y);
      y += gap;
    }
  };
  const heading = (text: string) => {
    ensure(12);
    y += 3;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(text.toUpperCase(), M, y);
    y += 2;
    doc.setLineWidth(0.3);
    doc.line(M, y, A4_W - M, y);
    y += 5;
  };

  // ---- header ----
  if (declared.fullName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(declared.fullName, M, y + 4);
    y += 10;
  }
  if (declared.headline) para(declared.headline, 11, "normal", 5);
  const contact = [declared.email, declared.phone, declared.location].filter(Boolean).join("  ·  ");
  if (contact) para(contact, 9, "normal", 5);
  const personal = Object.values(declared.personal ?? {}).filter(Boolean).join("  ·  ");
  if (personal) para(personal, 9, "normal", 5);

  if (cv.summary?.trim()) {
    heading("Summary");
    para(cv.summary.trim(), 10, "normal");
  }

  if (cv.roles?.length) {
    heading("Experience");
    for (const r of cv.roles) {
      ensure(10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.text(`${r.title}${r.employer ? ` — ${r.employer}` : ""}`, M, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`${r.start}${r.start || r.end ? " – " : ""}${r.end || "present"}`, A4_W - M, y, {
        align: "right",
      });
      y += 5;
      for (const b of r.bullets ?? []) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        const lines = doc.splitTextToSize(b, CONTENT_W - 5) as string[];
        lines.forEach((line, i) => {
          ensure(4.6);
          if (i === 0) doc.text("•", M, y);
          doc.text(line, M + 5, y);
          y += 4.6;
        });
      }
      y += 2.5;
    }
  }

  if (cv.credentials?.length) {
    heading("Qualifications");
    for (const c of cv.credentials) {
      const text = [c.name, c.issuer, c.year].filter(Boolean).join(", ");
      if (text) para(text, 10, "normal");
    }
  }

  if (cv.skills?.length) {
    heading("Skills");
    para(cv.skills.join(" · "), 10, "normal");
  }

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

/** Build + hand to the OS. Returns the filename written. */
export async function exportCvPdf(
  declared: CvDeclared,
  cv: CvGenerated,
): Promise<{ filename: string }> {
  const doc = await buildCvPdf(declared, cv);
  const filename = cvFilename(declared.fullName);
  const buf = doc.output("arraybuffer") as ArrayBuffer;
  await deliverFile(filename, "application/pdf", new Blob([buf], { type: "application/pdf" }));
  return { filename };
}
