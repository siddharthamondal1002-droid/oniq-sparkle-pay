// Complex-script exam paper PDF — the shaping-capable path.
//
// WHAT WAS WRONG
//
// jsPDF has no shaping engine. Its built-in fonts are WinAnsi-only, and even
// with a Devanagari font embedded it would place one glyph per codepoint in
// input order. Devanagari does not work that way: in कि the i-matra is TYPED
// after the consonant and RENDERED before it, and क् + ष becomes the single
// conjunct glyph क्ष. One glyph per codepoint in input order produces detached
// matras and broken conjuncts — text that is wrong, not merely ugly.
//
// So app.study.tsx tested every stem against a NON_LATIN regex and, on any
// hit, saved an HTML file instead. Not a fallback with a caveat: no Hindi,
// Tamil or Urdu paper had ever exported as a PDF.
//
// HOW THIS FIXES IT
//
// pdf-lib embeds custom fonts through fontkit, and fontkit's layout() runs the
// OpenType GSUB/GPOS pipeline including its Indic shaper. So the glyph run
// pdf-lib writes is already reordered and ligated — the shaping happens before
// a single byte reaches the page.
//
// Proven rather than assumed, in paperPdfShaped.test.ts:
//   क    -> glyph 56
//   कि   -> glyphs 542, 56   the matra precedes the consonant it follows
//   क्ष  -> glyph 90         three codepoints collapse to one conjunct
//
// TWO CHOICES WORTH RECORDING
//
// The font is a real TTF (@expo-google-fonts ships one), not the WOFF that
// @fontsource ships. A PDF font stream must be an SFNT; handing pdf-lib a WOFF
// risks writing a font a viewer cannot read, and the failure would be
// invisible here and visible only on a device.
//
// subset:false, because pdf-lib's subsetter calls a fontkit v1 API that
// fontkit v2 no longer exposes. The cost is roughly 220 KB of font in each
// Hindi PDF. That is the correct trade against a paper that does not render,
// and it only applies to complex-script papers — Latin ones keep the existing
// jsPDF path untouched.

import {
  type PaperPdfInput,
  type PaperProgress,
  deliverFile,
  paperFilename,
  toBase64,
} from "@/lib/paperPdf";

const A4_W = 595.28;
const A4_H = 841.89;
const M = 42;
const CONTENT_W = A4_W - M * 2;

/** Cached across exports — fetching 220 KB once per session is enough. */
let fontBytesPromise: Promise<ArrayBuffer> | null = null;

async function devanagariFont(): Promise<ArrayBuffer> {
  if (!fontBytesPromise) {
    fontBytesPromise =
      import("@expo-google-fonts/noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf?url")
        .then((m) => fetch(m.default))
        .then((r) => {
          if (!r.ok) throw new Error(`font fetch failed: ${r.status}`);
          return r.arrayBuffer();
        })
        .catch((e) => {
          // Do not cache a failure — a flaky network on first tap should not
          // permanently disable Hindi export for the rest of the session.
          fontBytesPromise = null;
          throw e;
        });
  }
  return fontBytesPromise;
}

type Font = {
  widthOfTextAtSize: (t: string, s: number) => number;
  heightAtSize: (s: number) => number;
};

/**
 * Greedy word wrap measured with the embedded font.
 *
 * Measured, not estimated by character count: Devanagari advance widths bear
 * no relation to codepoint count once conjuncts form, so counting characters
 * would overflow the margin on exactly the text this module exists for.
 */
function wrap(text: string, font: Font, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${line} ${words[i]}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = words[i];
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Build a shaped PDF. Returns the bytes; delivery is separate so tests can
 * assert on the document without touching Capacitor or the DOM.
 */
export async function buildShapedPaperPdf(
  input: PaperPdfInput,
  onProgress?: PaperProgress,
): Promise<Uint8Array> {
  const [{ PDFDocument, rgb }, fontkit, ttf] = await Promise.all([
    import("pdf-lib"),
    import("fontkit"),
    devanagariFont(),
  ]);

  const doc = await PDFDocument.create();
  // fontkit's module shape differs between its ESM and CJS builds — one puts
  // create() on the namespace, the other behind .default. pdf-lib only needs
  // whichever object carries create().
  const fk = fontkit as unknown as { default?: { create: unknown }; create?: unknown };
  doc.registerFontkit((fk.create ? fk : fk.default) as Parameters<typeof doc.registerFontkit>[0]);
  const font = await doc.embedFont(ttf, { subset: false });

  const black = rgb(0, 0, 0);
  let page = doc.addPage([A4_W, A4_H]);
  let y = A4_H - M;

  const need = (h: number) => {
    if (y - h < M) {
      page = doc.addPage([A4_W, A4_H]);
      y = A4_H - M;
    }
  };

  const line = (text: string, size: number, gap = 4) => {
    for (const l of wrap(text, font, size, CONTENT_W)) {
      need(size + gap);
      page.drawText(l, { x: M, y: y - size, size, font, color: black });
      y -= size + gap;
    }
  };

  // Header
  line(input.board, 11);
  line(`${input.classLabel} · ${input.subject}`, 16, 6);
  line(`Time: ${input.time}    Maximum marks: ${input.totalMarks}`, 11, 12);

  const total = input.sections.reduce((a, s) => a + s.items.length, 0);
  let done = 0;
  let qNo = 0;

  for (const section of input.sections) {
    y -= 8;
    line(section.label, 13, 8);

    for (const item of section.items) {
      qNo += 1;
      const marks = `[${item.marks}]`;
      const marksW = font.widthOfTextAtSize(marks, 11);

      const stemLines = wrap(`${qNo}. ${item.question}`, font, 11, CONTENT_W - marksW - 12);
      need(stemLines.length * 15 + 10);
      // Marks sit on the first line of the question, right-aligned.
      page.drawText(marks, { x: A4_W - M - marksW, y: y - 11, size: 11, font, color: black });
      for (const l of stemLines) {
        need(15);
        page.drawText(l, { x: M, y: y - 11, size: 11, font, color: black });
        y -= 15;
      }

      if (item.options?.length) {
        const labels = ["(a)", "(b)", "(c)", "(d)", "(e)"];
        item.options.forEach((opt, i) => {
          for (const l of wrap(`${labels[i] ?? "( )"} ${opt}`, font, 11, CONTENT_W - 18)) {
            need(15);
            page.drawText(l, { x: M + 18, y: y - 11, size: 11, font, color: black });
            y -= 15;
          }
        });
      }

      for (let i = 0; i < item.answerLines; i++) {
        need(18);
        page.drawLine({
          start: { x: M, y: y - 6 },
          end: { x: A4_W - M, y: y - 6 },
          thickness: 0.4,
          color: rgb(0.75, 0.75, 0.75),
        });
        y -= 18;
      }

      y -= 6;
      done += 1;
      onProgress?.(done, total);
    }
  }

  return doc.save();
}

/** Build and hand the PDF to the platform, same delivery as the Latin path. */
export async function exportShapedPaperPdf(
  input: PaperPdfInput,
  onProgress?: PaperProgress,
): Promise<{ bytes: number; filename: string }> {
  const bytes = await buildShapedPaperPdf(input, onProgress);
  const filename = paperFilename(input.subject);
  // Copy into a plain ArrayBuffer: the view pdf-lib returns may sit inside a
  // larger pooled buffer, and handing that to Blob would attach trailing bytes.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  await deliverFile(
    filename,
    "application/pdf",
    toBase64(ab),
    new Blob([ab], { type: "application/pdf" }),
  );
  return { bytes: ab.byteLength, filename };
}
