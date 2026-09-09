/**
 * ONIQ HEALTH AI — a PDF's text layer, read on ONIQ's side (Phase 3b, B).
 *
 * THE ONE THIRD-PARTY MODULE IN THE HEALTH TREE, and the only file that may
 * name it: `unpdf`, pinned to an exact version, a serverless build of PDF.js.
 * It is handed BYTES and nothing else — no URL, no path, no credential — and
 * it opens no socket: PDF.js fetches nothing when given data, external file
 * streams are never followed, and `isEvalSupported: false` keeps PostScript
 * functions off the `Function` constructor. `ai/isolation.test.ts` admits the
 * specifier here and nowhere else, and scripts/health-mutate-guards.sh proves
 * a second importer and a second package both go red.
 *
 * It is parsing an UNTRUSTED file inside the function that holds the service
 * role, so the reader is bounded: the bucket's 10 MiB, PDF_MAX_PAGES pages,
 * and the function's own wall clock. A PDF that cannot be opened throws, and
 * the seam (textSource.ts) sends the file to transcription instead.
 *
 * Measured on Deno 2.9 before it was written into the tree: a generated
 * one-page PDF came back as its four lines, in order (docs/health/07,
 * 2026-09-09 later). The deployed edge runtime is proven by the live test.
 */
import { getDocumentProxy } from "npm:unpdf@1.8.1";
import type { PdfTextResult } from "./textSource.ts";

/** Pages read at most; a discharge summary is a few, a lab report one or two. */
export const PDF_MAX_PAGES = 40;

export const PDF_OPEN_OPTIONS = {
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  stopAtErrors: false,
} as const;

type TextItem = { str?: unknown; hasEOL?: unknown };
type Disposable = { cleanup?: () => unknown; destroy?: () => unknown };

/** PDF.js frees a page or a document through cleanup()/destroy(); the serverless build may carry only one. */
async function release(x: unknown): Promise<void> {
  const d = x as Disposable;
  try {
    if (typeof d.destroy === "function") await d.destroy();
    else if (typeof d.cleanup === "function") await d.cleanup();
  } catch {
    /* releasing a parsed page is best-effort; the isolate's end frees it anyway */
  }
}

export async function pdfText(bytes: Uint8Array): Promise<PdfTextResult> {
  const pdf = await getDocumentProxy(bytes, PDF_OPEN_OPTIONS);
  try {
    const total = Number(pdf.numPages) || 0;
    const pages = Math.min(total, PDF_MAX_PAGES);
    const lines: string[] = [];
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      for (const item of content.items as TextItem[]) {
        const str = typeof item.str === "string" ? item.str : "";
        line += str;
        if (item.hasEOL === true) {
          lines.push(line);
          line = "";
        } else if (str && !str.endsWith(" ")) {
          line += " ";
        }
      }
      if (line.trim()) lines.push(line);
      lines.push("");
      await release(page);
    }
    return { text: lines.join("\n"), pages: total, truncated: total > pages };
  } finally {
    await release(pdf);
  }
}
