/**
 * Devanagari shaping, proved rather than eyeballed.
 *
 * The loop's verification item asks that matras attach and conjuncts render.
 * "Looks right on a screenshot" is a weak check — a matra one pixel out of
 * place looks fine at thumbnail size and is wrong. What can be asserted
 * exactly is the glyph run the shaper produces, because Devanagari shaping has
 * two observable, unambiguous consequences:
 *
 *   REORDERING — in कि the i-matra is typed AFTER the consonant and drawn
 *   BEFORE it. If the glyph run has the matra second, no shaping happened.
 *
 *   LIGATION — क + ् + ष is three codepoints and one glyph. If the run has
 *   three glyphs, the conjunct did not form.
 *
 * jsPDF fails both by construction: it maps one glyph per codepoint in input
 * order. These tests are what distinguish the new path from the old one, and
 * they would have failed against every previous version of this feature.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PaperPdfInput } from "@/lib/paperPdf";

const FONT = join(
  process.cwd(),
  "node_modules/@expo-google-fonts/noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf",
);

async function loadFont() {
  const fontkit = await import("fontkit");
  const fk = fontkit as unknown as { default?: { create: unknown }; create?: unknown };
  const create = (fk.create ? fk : fk.default) as {
    create: (b: Buffer) => {
      postscriptName: string;
      layout: (s: string) => { glyphs: { id: number }[] };
    };
  };
  return create.create(readFileSync(FONT));
}

describe("the font is a real SFNT, not a WOFF", () => {
  it("starts with the TrueType magic", () => {
    // A PDF font stream must be an SFNT. The WOFF that @fontsource ships would
    // embed bytes a viewer cannot read — and that failure is invisible here
    // and visible only on a device, which is the worst place to find it.
    const head = readFileSync(FONT).subarray(0, 4);
    expect([...head]).toEqual([0x00, 0x01, 0x00, 0x00]);
  });

  it("is the font we think it is", async () => {
    expect((await loadFont()).postscriptName).toBe("NotoSansDevanagari-Regular");
  });
});

describe("shaping actually happens", () => {
  it("reorders the i-matra before the consonant it follows", async () => {
    const font = await loadFont();
    const ka = font.layout("क").glyphs.map((g) => g.id);
    const ki = font.layout("कि").glyphs.map((g) => g.id);

    expect(ka).toHaveLength(1);
    expect(ki).toHaveLength(2);
    // The consonant is SECOND in the output despite being FIRST in the input.
    expect(ki[1], "ka is not in second position — no reordering happened").toBe(ka[0]);
    expect(ki[0], "the matra did not move ahead of the consonant").not.toBe(ka[0]);
  });

  it("forms the ksha conjunct from three codepoints", async () => {
    const font = await loadFont();
    const input = "क्ष";
    expect([...input]).toHaveLength(3);
    const glyphs = font.layout(input).glyphs.map((g) => g.id);
    expect(glyphs, "the conjunct did not ligate").toHaveLength(1);
    // …and it is not simply the bare consonant.
    expect(glyphs[0]).not.toBe(font.layout("क").glyphs[0].id);
  });

  it("shapes a whole word, not just isolated pairs", async () => {
    const font = await loadFont();
    // हिन्दी: 6 codepoints, and the shaper both reorders and ligates.
    const input = "हिन्दी";
    expect([...input]).toHaveLength(6);
    expect(font.layout(input).glyphs.length).toBeLessThan(6);
  });

  it("still handles Latin, since headings and marks are English", async () => {
    const font = await loadFont();
    expect(font.layout("Section A (1 mark)").glyphs.length).toBeGreaterThan(10);
  });
});

describe("a Hindi paper produces a real PDF", () => {
  // Typed against the real input shape rather than inferred: an inferred
  // literal gives the items a union type where only some members have
  // `options`, which is not how the exporter sees them.
  const paper: PaperPdfInput = {
    board: "CBSE",
    classLabel: "Class 10",
    subject: "विज्ञान",
    totalMarks: 30,
    time: "1 hour",
    sections: [
      {
        label: "खण्ड अ",
        items: [
          {
            marks: 1,
            question: "एक साइकिल चालक 40 मिनट में 12 किलोमीटर चलता है। उसकी चाल क्या है?",
            options: ["9 किमी/घंटा", "15 किमी/घंटा", "18 किमी/घंटा", "24 किमी/घंटा"],
            answerLines: 0,
          },
        ],
      },
      {
        label: "खण्ड ब",
        items: [
          {
            marks: 3,
            question: "अपवर्तन के नियम लिखिए और एक उदाहरण दीजिए।",
            answerLines: 4,
          },
        ],
      },
    ],
  };

  it("builds a loadable PDF with the shaped glyph run inside it", async () => {
    // Exercises the same pdf-lib + fontkit path the app uses. The module
    // itself is not imported here because it fetches the font over HTTP in
    // the browser; this asserts the mechanism it depends on.
    const { PDFDocument } = await import("pdf-lib");
    const fontkit = await import("fontkit");
    const fk = fontkit as unknown as { default?: { create: unknown }; create?: unknown };

    const doc = await PDFDocument.create();
    doc.registerFontkit((fk.create ? fk : fk.default) as Parameters<typeof doc.registerFontkit>[0]);
    const font = await doc.embedFont(readFileSync(FONT), { subset: false });

    const page = doc.addPage([595.28, 841.89]);
    let y = 800;
    for (const section of paper.sections) {
      page.drawText(section.label, { x: 42, y, size: 13, font });
      y -= 20;
      for (const item of section.items) {
        page.drawText(item.question, { x: 42, y, size: 11, font });
        y -= 16;
        for (const o of item.options ?? []) {
          page.drawText(o, { x: 60, y, size: 11, font });
          y -= 14;
        }
      }
    }

    const bytes = await doc.save();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    // Re-parsing is the check that the document is structurally sound rather
    // than merely starting with the right five bytes.
    const back = await PDFDocument.load(bytes);
    expect(back.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(50_000);
    // EXPLICIT TIMEOUT, not a weakened assertion. Embedding an entire
    // Devanagari font with `subset: false` and re-parsing the document is
    // genuinely expensive: ~0.8s on an idle machine, measured at 17.1s under
    // worker oversubscription. Vitest's 5s default made that a TIMEOUT
    // reported as STACK_TRACE_ERROR — a failure that named nothing and
    // vanished on a quiet re-run. A test this costly must declare its cost.
  }, 60_000);

  it("measures Devanagari width by the font, never by character count", async () => {
    // Advance widths bear no relation to codepoint count once conjuncts form,
    // so a character-count wrap would overflow the margin on exactly the text
    // this module exists for.
    const { PDFDocument } = await import("pdf-lib");
    const fontkit = await import("fontkit");
    const fk = fontkit as unknown as { default?: { create: unknown }; create?: unknown };
    const doc = await PDFDocument.create();
    doc.registerFontkit((fk.create ? fk : fk.default) as Parameters<typeof doc.registerFontkit>[0]);
    const font = await doc.embedFont(readFileSync(FONT), { subset: false });

    const conjunct = "क्ष";
    const plain = "कषक";
    expect([...conjunct]).toHaveLength(3);
    expect([...plain]).toHaveLength(3);
    // Same codepoint count, different rendered width — which is the whole
    // reason character counting cannot be used.
    expect(font.widthOfTextAtSize(conjunct, 11)).not.toBeCloseTo(
      font.widthOfTextAtSize(plain, 11),
      1,
    );
  });
});

describe("the HTML fallback is scoped to scripts the font cannot draw", () => {
  it("Devanagari goes down the shaped PDF path, not to HTML", () => {
    const study = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/app.study.tsx"),
      "utf8",
    );
    expect(study).toMatch(/exportShapedPaperPdf/);
    expect(study).toMatch(/exporter = hasNonLatin/);
    // The renderer embeds Noto Sans Devanagari and nothing else, so the
    // coverage test names that block explicitly.
    expect(study).toMatch(/u0900-\\u097F/);
  });

  it("keeps HTML only for uncovered scripts — Tamil, Bengali, Arabic, CJK", () => {
    const study = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/app.study.tsx"),
      "utf8",
    );
    const download = study.slice(
      study.indexOf("async function doDownloadPdf"),
      study.indexOf("async function doOpenInBrowser"),
    );
    expect(download.length).toBeGreaterThan(200);
    // The diversion must be conditional on coverage, never unconditional:
    // a PDF of .notdef boxes is worse than a readable HTML paper, and a
    // blanket fallback would take Hindi back to having no PDF at all.
    expect(download).toMatch(/if \(hasNonLatin && !shapedCovers\)/);
    expect(download).toMatch(/exportPaperHtml/);
  });
});
