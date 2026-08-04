// WYSIWYG paper renderer for the CV.
//
// This mirrors src/lib/cvPdf.ts one-for-one: same section order, same
// headings + rules, same font family/sizes, same margins, same separators.
// Everything is expressed in millimetres so the sheet is literally an A4
// page; the wrapper scales it down to whatever width it is given, so what
// the user sees here is what buildCvPdf() writes out.
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CV_PAGE, PT } from "@/lib/cvPdf";
import type { CvDeclared, CvGenerated } from "@/lib/cvValidation";
import { pruneDeclaredForExport, pruneGenerated } from "@/lib/cvValidation";
import { normalizeSectionOrder, type CvSectionKey } from "@/lib/cvSections";
import { getCvTemplate, rgbCss, type CvTemplate, type CvTemplateId } from "@/lib/cvTemplates";

/** pt -> mm, matching jsPDF's text metrics. */
const mm = (pt: number) => `${(pt * PT).toFixed(3)}mm`;

function Line({
  size,
  bold,
  gap,
  children,
  align,
  color,
}: {
  size: number;
  bold?: boolean;
  /** Baseline advance in mm, same numbers cvPdf.ts uses. */
  gap: number;
  children: ReactNode;
  align?: "right";
  color?: string;
}) {
  return (
    <div
      style={{
        fontSize: mm(size),
        lineHeight: `${gap}mm`,
        fontWeight: bold ? 700 : 400,
        textAlign: align,
        color,
      }}
    >
      {children}
    </div>
  );
}

function Heading({ text, tpl }: { text: string; tpl: CvTemplate }) {
  return (
    <div style={{ paddingTop: "3mm" }}>
      <div
        style={{
          fontSize: mm(10),
          fontWeight: 700,
          lineHeight: "4mm",
          textTransform: "uppercase",
          color: rgbCss(tpl.headingColor),
          letterSpacing: `${tpl.headingCharSpace}mm`,
        }}
      >
        {text}
      </div>
      <div
        style={{
          borderTop: `${tpl.ruleWidth}mm solid ${rgbCss(tpl.ruleColor)}`,
          marginTop: "0.6mm",
          marginBottom: "2.6mm",
        }}
      />
    </div>
  );
}


export type CvPaperDoc = Pick<CvGenerated, "summary" | "roles" | "credentials" | "skills">;

/** Usable content height per printed page, in mm — the same window
 * buildCvPdf() fills before it calls doc.addPage(). */
const PAGE_CONTENT_H = CV_PAGE.bottom - CV_PAGE.margin;

/**
 * Dashed rules drawn where the exporter will break the page, so long
 * Experience / Qualifications / Skills blocks show their split up front.
 */
function PageBreaks({ sheetHeight }: { sheetHeight: number }) {
  if (!sheetHeight) return null;
  // sheetHeight is in mm; content starts at the top margin.
  const breaks: number[] = [];
  for (let k = 1; k * PAGE_CONTENT_H + CV_PAGE.margin < sheetHeight - 2; k++) {
    breaks.push(k);
  }
  if (breaks.length === 0) return null;
  return (
    <>
      {breaks.map((k) => (
        <div
          key={k}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `${CV_PAGE.margin + k * PAGE_CONTENT_H}mm`,
            borderTop: "0.4mm dashed #d11a6b",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              position: "absolute",
              right: `${CV_PAGE.margin}mm`,
              top: "0.8mm",
              fontSize: mm(7.5),
              color: "#d11a6b",
              fontWeight: 700,
              letterSpacing: "0.2mm",
            }}
          >
            {`page ${k} ends · page ${k + 1} starts`}
          </span>
        </div>
      ))}
    </>
  );
}

/** The A4 sheet itself, drawn at true size; the parent scales it. */
function Sheet({
  declared: declaredIn,
  cv: cvIn,
  order,
  pageBreaks = true,
  template,
}: {
  declared: CvDeclared;
  cv: CvPaperDoc;
  order?: readonly CvSectionKey[];
  pageBreaks?: boolean;
  template?: CvTemplateId;
}) {
  const tpl = getCvTemplate(template);
  const sheetEl = useRef<HTMLDivElement>(null);
  const [sheetMm, setSheetMm] = useState(0);


  // Measure the rendered sheet so the break rules land where the exporter
  // actually runs out of page. CSS mm is a fixed 96/25.4 px, and offsetHeight
  // is pre-transform, so the parent's scale doesn't skew this.
  useEffect(() => {
    const el = sheetEl.current;
    if (!el) return;
    const measure = () => setSheetMm(el.offsetHeight / (96 / 25.4));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);


  // Identical pruning to buildCvPdf(): placeholders and empty rows never
  // reach the page, in the preview or the export.
  const declared = pruneDeclaredForExport(declaredIn);
  const pruned = pruneGenerated({ ...cvIn, personal: undefined } as CvGenerated);
  const contact = [declared.email, declared.phone, declared.location].filter(Boolean).join("  ·  ");
  const personal = Object.values(declared.personal ?? {})
    .filter(Boolean)
    .join("  ·  ");
  const cv = pruned;
  const roles = pruned.roles;
  const credentials = pruned.credentials;
  const skills = pruned.skills;

  // Same order the PDF prints in.
  const sections: Record<CvSectionKey, ReactNode> = {
    summary: cv.summary?.trim() ? (
      <>
        <Heading text="Summary" tpl={tpl} />
        <Line size={10} gap={4.6}>
          {cv.summary.trim()}
        </Line>
      </>
    ) : null,
    experience:
      roles.length > 0 ? (
        <>
          <Heading text="Experience" tpl={tpl} />
          {roles.map((r, i) => (
            <div key={i} style={{ paddingBottom: "2.5mm" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "4mm" }}>
                <div style={{ flex: 1 }}>
                  <Line size={10.5} bold gap={5}>
                    {`${r.title}${r.employer ? ` — ${r.employer}` : ""}`}
                  </Line>
                </div>
                {(r.start || r.end) && (
                  <div style={{ whiteSpace: "nowrap" }}>
                    <Line size={9} gap={5} align="right">
                      {`${r.start}${r.start || r.end ? " – " : ""}${r.end || "present"}`}
                    </Line>
                  </div>
                )}
              </div>
              {(r.bullets ?? []).map((b, j) => (
                <div key={j} style={{ display: "flex" }}>
                  <div style={{ width: "5mm", flexShrink: 0 }}>
                    <Line size={10} gap={4.6}>
                      {tpl.bullet}

                    </Line>
                  </div>
                  <div style={{ flex: 1 }}>
                    <Line size={10} gap={4.6}>
                      {b}
                    </Line>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      ) : null,
    qualifications:
      credentials.length > 0 ? (
        <>
          <Heading text="Qualifications" tpl={tpl} />
          {credentials.map((c, i) => (
            <Line key={i} size={10} gap={4.6}>
              {[c.name, c.issuer, c.year].filter(Boolean).join(", ")}
            </Line>
          ))}
        </>
      ) : null,
    skills:
      skills.length > 0 ? (
        <>
          <Heading text="Skills" tpl={tpl} />
          <Line size={10} gap={4.6}>
            {skills.join(" · ")}
          </Line>
        </>
      ) : null,
  };

  return (
    <div
      ref={sheetEl}
      style={{
        width: `${CV_PAGE.width}mm`,
        minHeight: `${CV_PAGE.height}mm`,
        padding: `${CV_PAGE.margin}mm`,
        paddingBottom: `${CV_PAGE.height - CV_PAGE.bottom + CV_PAGE.margin}mm`,
        background: "#fff",
        color: "#000",
        fontFamily: "Helvetica, Arial, sans-serif",
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      {pageBreaks && <PageBreaks sheetHeight={sheetMm} />}

      {declared.fullName && (
        <Line size={18} bold gap={10} color={rgbCss(tpl.nameColor)}>
          {declared.fullName}
        </Line>
      )}

      {declared.headline && (
        <Line size={11} gap={5}>
          {declared.headline}
        </Line>
      )}
      {contact && (
        <Line size={9} gap={5}>
          {contact}
        </Line>
      )}
      {personal && (
        <Line size={9} gap={5}>
          {personal}
        </Line>
      )}

      {normalizeSectionOrder(order).map((key) => (
        <div key={key}>{sections[key]}</div>
      ))}

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "5mm",
          textAlign: "center",
          color: "#787878",
          fontSize: mm(8),
        }}
      >
        Page 1
      </div>
    </div>
  );
}

/**
 * Scales the true-size A4 sheet down to the available width, so the preview
 * is the exported page rather than an approximation of it.
 */
export function CvPaper({
  declared,
  cv,
  order,
  pageBreaks = true,
  template,
}: {
  declared: CvDeclared;
  cv: CvPaperDoc;
  order?: readonly CvSectionKey[];
  /** Show dashed rules where the export will split pages. Default on. */
  pageBreaks?: boolean;
  /** Layout style; matches the template used by the PDF export. */
  template?: CvTemplateId;
}) {

  const box = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const measure = () => {
      const boxEl = box.current;
      const sheetEl = sheet.current;
      if (!boxEl || !sheetEl) return;
      const sheetW = sheetEl.offsetWidth || 1;
      const next = Math.min(1, boxEl.clientWidth / sheetW);
      setScale(next);
      setHeight(sheetEl.offsetHeight * next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    if (sheet.current) ro.observe(sheet.current);
    return () => ro.disconnect();
  }, [declared, cv, order, template]);

  return (
    <div ref={box} className="w-full overflow-hidden" style={{ height: height || undefined }}>
      <div
        ref={sheet}
        style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "fit-content" }}
      >
        <Sheet
          declared={declared}
          cv={cv}
          order={order}
          pageBreaks={pageBreaks}
          template={template}
        />
      </div>
    </div>
  );

}
