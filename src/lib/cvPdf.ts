// One-click CV export. Vector text via jsPDF — never a DOM rasterisation
// (html2canvas blocks the WebView main thread and ANRs on multi-page docs).
import { deliverFile, shareFile } from "@/lib/saveFile";
import type { CvDeclared, CvGenerated } from "@/lib/cvValidation";

const A4_W = 210;
const A4_H = 297;
const M = 16;
const CONTENT_W = A4_W - M * 2;
const BOTTOM = A4_H - M;

export function cvFilename(fullName: string): string {
  const slug =
    (fullName || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "my";
  return `${slug}-cv-${new Date().toISOString().slice(0, 10)}.pdf`;
}

export async function buildCvPdf(declared: CvDeclared, cv: CvGenerated) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });

  let y = M;
  // Section currently being emitted — repeated as "… (cont.)" after a break so
  // a split Experience/Skills block never looks orphaned.
  let section: string | null = null;

  const drawHeading = (text: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(text.toUpperCase(), M, y);
    y += 2;
    doc.setLineWidth(0.3);
    doc.line(M, y, A4_W - M, y);
    y += 5;
  };
  const page = () => {
    doc.addPage();
    y = M;
    if (section) drawHeading(`${section} (cont.)`);
  };
  const ensure = (needed: number) => {
    if (y + needed > BOTTOM) page();
  };
  const wrap = (text: string, size: number, style: "normal" | "bold" | "italic", width: number) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    return doc.splitTextToSize(text, width) as string[];
  };
  const para = (text: string, size: number, style: "normal" | "bold" | "italic", gap = 4.6) => {
    for (const line of wrap(text, size, style, CONTENT_W)) {
      ensure(gap);
      doc.setFont("helvetica", style);
      doc.setFontSize(size);
      doc.text(line, M, y);
      y += gap;
    }
  };
  const heading = (text: string) => {
    section = null;
    // Keep the rule with at least one line of its section.
    ensure(3 + 7 + 5);
    y += 3;
    drawHeading(text);
    section = text;
  };

  // ---- header ----
  if (declared.fullName) {
    for (const line of wrap(declared.fullName, 18, "bold", CONTENT_W)) {
      ensure(10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text(line, M, y + 4);
      y += 10;
    }
  }
  if (declared.headline) para(declared.headline, 11, "normal", 5);
  const contact = [declared.email, declared.phone, declared.location].filter(Boolean).join("  ·  ");
  if (contact) para(contact, 9, "normal", 5);
  const personal = Object.values(declared.personal ?? {})
    .filter(Boolean)
    .join("  ·  ");
  if (personal) para(personal, 9, "normal", 5);

  if (cv.summary?.trim()) {
    heading("Summary");
    para(cv.summary.trim(), 10, "normal");
  }

  if (cv.roles?.length) {
    heading("Experience");
    for (const r of cv.roles) {
      const titleText = `${r.title}${r.employer ? ` — ${r.employer}` : ""}`;
      const dates = `${r.start}${r.start || r.end ? " – " : ""}${r.end || "present"}`;
      const dateW = dates ? doc.getStringUnitWidth(dates) * 9 * 0.3528 + 4 : 0;
      const titleLines = wrap(titleText, 10.5, "bold", CONTENT_W - dateW);
      // Never strand a role header at the foot of a page: it needs its own
      // lines plus the first line of its first bullet.
      ensure(titleLines.length * 5 + (r.bullets?.length ? 4.6 : 0));
      titleLines.forEach((line, i) => {
        ensure(5);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        doc.text(line, M, y);
        if (i === 0 && dates) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.text(dates, A4_W - M, y, { align: "right" });
        }
        y += 5;
      });
      for (const b of r.bullets ?? []) {
        const lines = wrap(b, 10, "normal", CONTENT_W - 5);
        lines.forEach((line, i) => {
          ensure(4.6);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
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
  section = null;


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

/** Build + open the platform share sheet. Returns how the file was handed off. */
export async function shareCvPdf(
  declared: CvDeclared,
  cv: CvGenerated,
): Promise<{ filename: string; how: "shared" | "downloaded" }> {
  const doc = await buildCvPdf(declared, cv);
  const filename = cvFilename(declared.fullName);
  const buf = doc.output("arraybuffer") as ArrayBuffer;
  const how = await shareFile(filename, "application/pdf", new Blob([buf], { type: "application/pdf" }), {
    title: declared.fullName ? `${declared.fullName} — CV` : "My CV",
    text: "My CV",
  });
  return { filename, how };
}
