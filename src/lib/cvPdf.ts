// One-click CV export. Vector text via jsPDF — never a DOM rasterisation
// (html2canvas blocks the WebView main thread and ANRs on multi-page docs).
import { deliverFile, shareFile } from "@/lib/saveFile";
import { defaultCvShareMessage } from "@/lib/cvShareMessage";

import type { CvDeclared, CvGenerated } from "@/lib/cvValidation";
import { pruneDeclaredForExport, pruneGenerated } from "@/lib/cvValidation";
import {
  normalizeInclude,
  normalizeSectionOrder,
  type CvInclude,
  type CvSectionKey,
} from "@/lib/cvSections";
import { getCvTemplate, type CvTemplateId } from "@/lib/cvTemplates";
import { CONTACT_SEP, contactParts } from "@/lib/cvLinks";


const A4_W = 210;
const A4_H = 297;
const M = 16;
const CONTENT_W = A4_W - M * 2;
const BOTTOM = A4_H - 18; // leaves room for the page-number footer

/** Page geometry, shared with the on-screen paper preview (CvPaper.tsx). */
export const CV_PAGE = {
  width: A4_W,
  height: A4_H,
  margin: M,
  contentWidth: CONTENT_W,
  bottom: BOTTOM,
} as const;

/** Points -> millimetres, matching jsPDF's text metrics. */
export const PT = 0.3528;

export function cvFilename(fullName: string): string {
  const slug =
    (fullName || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "my";
  return `${slug}-cv-${new Date().toISOString().slice(0, 10)}.pdf`;
}

export async function buildCvPdf(
  declaredIn: CvDeclared,
  cvIn: CvGenerated,
  order?: readonly CvSectionKey[],
  templateId?: CvTemplateId,
  include?: Partial<CvInclude>,
) {
  const { jsPDF } = await import("jspdf");
  // Sections the user switched off are skipped entirely — no heading, no rule.
  const inc = normalizeInclude(include);
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  // Decoration only — never changes vertical advances, so pagination is
  // identical across templates.
  const tpl = getCvTemplate(templateId);

  // Export exactly the declared content: placeholders ("not declared", "N/A",
  // "—") and empty rows are stripped, and any section left empty is skipped
  // entirely rather than printing a bare heading.
  const declared = pruneDeclaredForExport(declaredIn);
  const cv = pruneGenerated(cvIn);

  let y = M;
  // Section currently being emitted — repeated as "… (cont.)" after a break so
  // a split Experience/Skills block never looks orphaned.
  let section: string | null = null;

  const drawHeading = (text: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(tpl.headingColor[0], tpl.headingColor[1], tpl.headingColor[2]);
    doc.setCharSpace(tpl.headingCharSpace);
    doc.text(text.toUpperCase(), M, y);
    doc.setCharSpace(0);
    doc.setTextColor(0);
    y += 2;
    doc.setLineWidth(tpl.ruleWidth);
    doc.setDrawColor(tpl.ruleColor[0], tpl.ruleColor[1], tpl.ruleColor[2]);

    doc.line(M, y, A4_W - M, y);
    doc.setDrawColor(0);
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
      doc.setTextColor(tpl.nameColor[0], tpl.nameColor[1], tpl.nameColor[2]);
      doc.text(line, M, y + 4);
      doc.setTextColor(0);
      y += 10;

    }
  }
  if (declared.headline) para(declared.headline, 11, "normal", 5);
  // Contact line: email / phone / website print as real PDF link annotations
  // (mailto:, tel:, https:) so they are tappable in any viewer; plain values
  // such as the location are drawn as ordinary text.
  const parts = inc.contact ? contactParts(declared) : [];
  if (parts.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const w = (t: string) => doc.getStringUnitWidth(t) * 9 * PT;
    const sepW = w(CONTACT_SEP);
    let x = M;
    ensure(5);
    parts.forEach((part, i) => {
      const partW = w(part.text);
      if (i > 0) {
        if (x + sepW + partW > M + CONTENT_W) {
          y += 5;
          ensure(5);
          x = M;
        } else {
          doc.text(CONTACT_SEP, x, y);
          x += sepW;
        }
      }
      if (part.href) {
        doc.textWithLink(part.text, x, y, { url: part.href });
        // Faint underline: the only visual cue a PDF viewer gives for a link.
        doc.setLineWidth(0.15);
        doc.setDrawColor(120);
        doc.line(x, y + 0.9, x + partW, y + 0.9);
        doc.setDrawColor(0);
      } else {
        doc.text(part.text, x, y);
      }
      x += partW;
    });
    y += 5;
  }
  const personal = Object.values(declared.personal ?? {})
    .filter(Boolean)
    .join("  ·  ");
  if (personal) para(personal, 9, "normal", 5);

  // Body sections print in the user's chosen order (drag-and-drop in the CV
  // workbench); anything empty is still skipped entirely.
  const emit: Record<CvSectionKey, () => void> = {
    summary: () => {
      if (!cv.summary?.trim()) return;
      heading("Summary");
      para(cv.summary.trim(), 10, "normal");
    },
    experience: () => {
      if (!inc.experience || !cv.roles?.length) return;
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
            if (i === 0) doc.text(tpl.bullet, M, y);
            doc.text(line, M + 5, y);
            y += 4.6;
          });
        }
        y += 2.5;
      }
    },
    qualifications: () => {
      if (!inc.qualifications || !cv.credentials?.length) return;
      heading("Qualifications");
      for (const c of cv.credentials) {
        const text = [c.name, c.issuer, c.year].filter(Boolean).join(", ");
        if (text) para(text, 10, "normal");
      }
    },
    skills: () => {
      if (!inc.skills || !cv.skills?.length) return;
      heading("Skills");
      para(cv.skills.join(" · "), 10, "normal");
    },
  };
  for (const key of normalizeSectionOrder(order)) emit[key]();

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

/** Build once, keep the bytes — lets the preview, download and share reuse
 * the exact same document instead of regenerating it three times. */
export async function buildCvPdfBlob(
  declared: CvDeclared,
  cv: CvGenerated,
  order?: readonly CvSectionKey[],
  templateId?: CvTemplateId,
  include?: Partial<CvInclude>,
): Promise<{ blob: Blob; filename: string; pages: number }> {
  const doc = await buildCvPdf(declared, cv, order, templateId, include);

  const buf = doc.output("arraybuffer") as ArrayBuffer;
  return {
    blob: new Blob([buf], { type: "application/pdf" }),
    filename: cvFilename(declared.fullName),
    pages: doc.getNumberOfPages(),
  };
}

/** Hand an already-built CV PDF to the OS (save/download). */
export function deliverCvPdfBlob(filename: string, blob: Blob) {
  return deliverFile(filename, "application/pdf", blob);
}

/** Default share-sheet subject/body for a CV, used when the user hasn't
 * customised the message. Re-exported from the light module. */
export { defaultCvShareMessage } from "@/lib/cvShareMessage";


/** Hand an already-built CV PDF to the platform share sheet.
 * `message` lets the caller override the share-sheet subject and body. */
export function shareCvPdfBlob(
  filename: string,
  blob: Blob,
  fullName?: string,
  message?: { title?: string; text?: string },
) {
  const fallback = defaultCvShareMessage(fullName);
  return shareFile(filename, "application/pdf", blob, {
    title: message?.title?.trim() || fallback.title,
    text: message?.text?.trim() || fallback.text,
  });
}


/** Build + hand to the OS. Returns the filename written. */
export async function exportCvPdf(
  declared: CvDeclared,
  cv: CvGenerated,
  order?: readonly CvSectionKey[],
  templateId?: CvTemplateId,
  include?: Partial<CvInclude>,
): Promise<{ filename: string }> {
  const doc = await buildCvPdf(declared, cv, order, templateId, include);
  const filename = cvFilename(declared.fullName);
  const buf = doc.output("arraybuffer") as ArrayBuffer;
  await deliverFile(filename, "application/pdf", new Blob([buf], { type: "application/pdf" }));
  return { filename };
}

/** Build + open the platform share sheet. Returns how the file was handed off. */
export async function shareCvPdf(
  declared: CvDeclared,
  cv: CvGenerated,
  order?: readonly CvSectionKey[],
  templateId?: CvTemplateId,
  include?: Partial<CvInclude>,
): Promise<{ filename: string; how: "shared" | "downloaded" }> {
  const doc = await buildCvPdf(declared, cv, order, templateId, include);

  const filename = cvFilename(declared.fullName);
  const buf = doc.output("arraybuffer") as ArrayBuffer;
  const how = await shareFile(
    filename,
    "application/pdf",
    new Blob([buf], { type: "application/pdf" }),
    {
      title: declared.fullName ? `${declared.fullName} — CV` : "My CV",
      text: "My CV",
    },
  );
  return { filename, how };
}
