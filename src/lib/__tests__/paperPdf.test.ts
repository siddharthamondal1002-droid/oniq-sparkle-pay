/**
 * Question-paper PDF: content completeness, multi-page handling, progress
 * reporting and yielding (the WebView-freeze guard), and filenames.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

import { buildPaperPdf, paperFilename, type PaperPdfInput } from "@/lib/paperPdf";

function makePaper(nLong: number, nMcq: number): PaperPdfInput {
  return {
    board: "CBSE",
    classLabel: "Class 10",
    subject: "Physics",
    totalMarks: 80,
    time: "3 hours",
    sections: [
      {
        label: "Section A — Objective",
        items: Array.from({ length: nMcq }, (_, i) => ({
          marks: 1,
          question: `MCQ number ${i + 1}: which of the following is correct about motion?`,
          options: ["First option", "Second option", "Third option", "Fourth option"],
          answerLines: 0,
        })),
      },
      {
        label: "Section C — Long answer",
        items: Array.from({ length: nLong }, (_, i) => ({
          marks: 5,
          question: `Long question ${i + 1}: derive the expression and explain each term used in it.`,
          answerLines: 10,
        })),
      },
    ],
  };
}

function pdfText(doc: Awaited<ReturnType<typeof buildPaperPdf>>): string {
  return String(doc.output("string"));
}

describe("paper PDF generation", () => {
  it("emits a multi-page document for a long paper", async () => {
    const doc = await buildPaperPdf(makePaper(40, 40));
    expect(doc.getNumberOfPages()).toBeGreaterThan(3);
  });

  it("reports progress for every question", async () => {
    const seen: number[] = [];
    await buildPaperPdf(makePaper(10, 10), (done, total) => {
      expect(total).toBe(20);
      seen.push(done);
    });
    expect(seen).toHaveLength(20);
    expect(seen[seen.length - 1]).toBe(20);
  });

  it("yields to the event loop while generating (no frozen WebView)", async () => {
    let ticked = false;
    const timer = setInterval(() => {
      ticked = true;
    }, 0);
    await buildPaperPdf(makePaper(30, 30));
    clearInterval(timer);
    expect(ticked).toBe(true);
  });

  it("contains the whole paper, not just the first screen", async () => {
    const doc = await buildPaperPdf(makePaper(25, 25));
    const raw = pdfText(doc);
    // last question and the closing line both made it into the document
    expect(raw).toContain("Long question 25");
    expect(raw).toContain("End of paper");
    expect(raw).toContain("Page 1 of");
  });

  it("keeps ruled answer space for written questions", async () => {
    const withLines = await buildPaperPdf(makePaper(5, 0));
    const withoutLines = await buildPaperPdf(makePaper(0, 5));
    // ruled lines are vector strokes, so the lined paper is materially longer
    expect(pdfText(withLines).length).toBeGreaterThan(pdfText(withoutLines).length);
  });

  it("names the file by subject and date", () => {
    const name = paperFilename("Physics — Term 2");
    expect(name).toMatch(/^physics-term-2-question-paper-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(name).not.toBe("download.pdf");
  });
});
