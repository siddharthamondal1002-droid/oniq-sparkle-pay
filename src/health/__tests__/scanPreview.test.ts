/**
 * A SCAN IS SHOWN, NEVER READ — and the whole of B rests on that being true in
 * three places at once: on the screen, in the pipeline, and in the label.
 *
 * Owner directive 2026-09-10, "B and C". B takes a DICOM in, parses its
 * header, renders its pixels and files it. It interprets NOTHING; the moment
 * anything here starts saying what is IN the picture, that is C, and C is a
 * different provider, a different flag and a medical-device question for
 * counsel.
 *
 * THE THREE ASSERTIONS THAT MATTER, and why each is a separate one:
 *
 *   1. THE DOOR. The viewer renders on a DICOM row — not behind a tab, not
 *      only after a disappointing note. Three features in this repo shipped
 *      working and unreachable (`upiDoors`, `/app/creations`, "nowhere to
 *      upload"), all three recorded in CLAUDE.md by the agents who then
 *      repeated them.
 *   2. NO TEXT PIPELINE. A DICOM never reaches Analyse or "What does this
 *      report say?". The text burned into a radiograph is the patient's name
 *      and the accession number — exactly the fields `dicom.ts` refuses to
 *      read — so sending one to a provider would hand over identifiers ONIQ
 *      went out of its way not to parse, for no benefit.
 *   3. NO AI LABEL, and that is a CLAIM rather than an omission. Nothing in
 *      `ScanPreview.tsx` is generated or inferred: the server decodes the
 *      person's own file and re-encodes its pixels. Labelling that
 *      "AI-assisted" is false in the other direction — the mirror of the
 *      2026-09-06 case where a photo the person took was nearly labelled
 *      "AI-generated". Over-label AI; never mislabel what is not.
 *
 * Comments are stripped first. Every file below EXPLAINS these rules in prose
 * that quotes the identifiers being asserted about — `HEALTH_AI_LABEL`,
 * `health-doc-analyse`, `application/dicom` — which is the tenth time in this
 * repo a source-reading guard would otherwise have read its own explanation as
 * the code (CLAUDE.md, 2026-09-09).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";
import {
  DOCUMENT_MIMES,
  TEXT_READABLE_MIMES,
  isTextReadableMime,
  sniffDocumentMime,
  MIME_HEAD_BYTES,
  EXT_FOR_MIME,
} from "@/health/domain";
import { AI_TASKS } from "@/health/ai/types";

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => stripComments(readFileSync(join(ROOT, p), "utf8"));

const PREVIEW = "src/health/ScanPreview.tsx";
const DOCUMENTS = "src/routes/_authenticated/app.health.records.tsx";
const TIMELINE = "src/routes/_authenticated/app.health.index.tsx";
const ADD_REPORT = "src/health/AddReport.tsx";
const API = "src/health/api.ts";
const FUNCTION = "supabase/functions/health-api/index.ts";

describe("a DICOM is a document ONIQ accepts", () => {
  it("the mime is registered and gets its own extension", () => {
    expect(DOCUMENT_MIMES).toContain("application/dicom");
    expect(EXT_FOR_MIME["application/dicom"]).toBe("dcm");
  });

  it("but is NOT text-readable, so no AI task can be asked to read it", () => {
    expect(TEXT_READABLE_MIMES).not.toContain("application/dicom");
    expect(isTextReadableMime("application/dicom")).toBe(false);
    // The control: everything else still is, or this assertion would pass by
    // the helper simply returning false for everything.
    for (const m of TEXT_READABLE_MIMES) expect(isTextReadableMime(m)).toBe(true);
  });

  it("the sniff reads DICOM's magic BEFORE the start-of-file magics", () => {
    // A DICOM preamble is 128 unconstrained bytes, and a real one often holds
    // a valid JPEG or PDF header so ordinary viewers can open the file.
    // Sniffing the start first classifies exactly those as what they imitate,
    // and the file then goes into the text pipeline as an "image".
    const head = new Uint8Array(MIME_HEAD_BYTES);
    head.set([0xff, 0xd8, 0xff, 0xe0], 0); // a JPEG header, in the preamble
    head.set([0x44, 0x49, 0x43, 0x4d], 128); // "DICM"
    expect(sniffDocumentMime(head)).toBe("application/dicom");

    const jpeg = new Uint8Array(MIME_HEAD_BYTES);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
    expect(sniffDocumentMime(jpeg)).toBe("image/jpeg");
  });

  it("the head the client reads is long enough to reach the magic at 128", () => {
    // MIME_HEAD_BYTES < 132 would make every DICOM sniff as whatever its
    // preamble happens to start with, silently.
    expect(MIME_HEAD_BYTES).toBeGreaterThanOrEqual(132);
  });
});

describe("the door: a scan row shows the viewer", () => {
  it("the documents screen renders the viewer for a non-text-readable file", () => {
    const src = read(DOCUMENTS);
    expect(src).toMatch(/<HealthScanPreview\b/);
    expect(src).toContain("isTextReadableMime(d.mime)");
  });

  it("Analyse and the description are gated on the SAME predicate", () => {
    // Two different gates would drift: one would open on a DICOM while the
    // other stayed shut, and the open one is the one that sends text.
    const src = read(DOCUMENTS);
    const gates = src.match(/isTextReadableMime\(d\.mime\)/g) ?? [];
    expect(gates.length).toBe(2);
    const analyse = src.indexOf('data-testid="health-doc-analyse"');
    const describe_ = src.indexOf("<HealthReportDescription");
    const preview = src.indexOf("<HealthScanPreview");
    expect(analyse).toBeGreaterThan(-1);
    expect(describe_).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(-1);
    // Each control sits AFTER a gate, and the viewer is the else branch of the
    // one the description sits in.
    expect(src.lastIndexOf("isTextReadableMime(d.mime)", analyse)).toBeGreaterThan(-1);
    expect(src.lastIndexOf("isTextReadableMime(d.mime)", describe_)).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(describe_);
  });

  it("the upload path stores a scan and stops, without reading it", () => {
    const src = read(ADD_REPORT);
    expect(src).toContain("isTextReadableMime(mime)");
    // The gate is the SAME expression that decides whether readStoredDocument
    // runs at all, so a scan cannot fall through into the reader.
    const gate = src.indexOf("if (!aiAvailable || !isTextReadableMime(mime))");
    const reader = src.indexOf("await readStoredDocument(");
    expect(gate).toBeGreaterThan(-1);
    expect(reader).toBeGreaterThan(gate);
  });

  it("a picked .dcm is admitted by the file input", () => {
    // Browsers report "" for a .dcm — there is no registered media type on
    // most desktops — so an accept list of mimes alone hides every scan
    // behind "no files match" in the picker.
    expect(read(ADD_REPORT)).toContain(".dcm");
  });

  it("neither the timeline nor the viewer grows its own scan renderer", () => {
    // One implementation of "decode this file", the OniqDeleteCreation shape.
    expect(read(TIMELINE)).not.toMatch(/<HealthScanPreview\b/);
    expect(read(PREVIEW)).not.toMatch(/parseDicom|renderDicom/);
  });
});

describe("the viewer is not an AI surface, and says nothing about the image", () => {
  it("it carries no AI label and no AI output report", () => {
    // NOT an omission — see the header. If a future change makes this file
    // interpret anything, this test is the one that must be edited, and
    // editing it is the moment to ask whether that is still B.
    const src = read(PREVIEW);
    expect(src).not.toMatch(/HEALTH_AI_LABEL/);
    expect(src).not.toMatch(/AiOutputReport/);
  });

  it("it says in plain words that nothing has checked the image", () => {
    const src = readFileSync(join(ROOT, PREVIEW), "utf8");
    expect(src).toContain('data-testid="health-scan-not-read"');
    expect(src).toContain("not read it");
  });

  it("it names the format it could not open, rather than refusing blankly", () => {
    // "A diagnostic may never fall back to the thing it was built to explain"
    // (CLAUDE.md, 2026-09-07): `http 404` was a status restated. The transfer
    // syntax's NAME is what stops the same file being uploaded five times.
    const src = read(PREVIEW);
    expect(src).toContain("res.format");
    expect(src).toContain("health.scan.unreadable");
  });

  it("and the client actually carries `format` back from a refusal", () => {
    // The half that makes the line above mean anything: `refuse()` puts detail
    // and format at the TOP LEVEL of the body beside `reason`, so healthApi
    // dropping them would leave the diagnostic permanently dead with the
    // generic fallback as its only output.
    const src = read(API);
    expect(src).toContain("format: str(body.format)");
    expect(src).toContain("format: str(d.format)");
    expect(src).toContain('"documents.preview"');
  });
});

describe("a DICOM never enters the AI pipeline", () => {
  /**
   * The import-level half of "no text pipeline". `isTextReadableMime` is what
   * the SCREENS check; this is what the CODE cannot do. `ai/isolation.test.ts`
   * lists `dicom` and `dicomRender` as reachable siblings — because that list
   * mirrors the shared directory — so reachable they are, and this is the
   * assertion that says nothing actually reaches them.
   *
   * Why it matters more than it looks: the moment an `ai/` module imports
   * `parseDicom`, the natural next line is handing the rendered pixels to the
   * provider, and that is C — a different provider, a different flag and a
   * medical-device question for counsel. This test is where that decision
   * gets made deliberately instead of by an import.
   */
  const AI_DIR = join(ROOT, "supabase/functions/_shared/health/ai");

  it("no module under ai/ imports the DICOM reader or the renderer", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "__tests__") walk(p);
          continue;
        }
        if (!/\.ts$/.test(name) || /\.test\.ts$/.test(name)) continue;
        const src = stripComments(readFileSync(p, "utf8"));
        if (/from\s+["'][^"']*dicom/i.test(src)) offenders.push(name);
      }
    };
    walk(AI_DIR);
    expect(offenders).toEqual([]);
  });

  it("and the AI tasks the gateway knows do not include one that reads a scan", () => {
    // The closed task list is the other end of the same rule. A seventh task
    // called anything like "read_scan" is C arriving without the flag.
    expect([...AI_TASKS].filter((t) => /scan|image|dicom|xray|radiograph/i.test(t))).toEqual([]);
  });
});

describe("the server renders on demand and authorizes by ownership", () => {
  const src = read(FUNCTION);

  it("documents.preview is registered and is DICOM-only", () => {
    expect(src).toContain('"documents.preview": actDocumentsPreview');
    expect(src).toContain('row.mime !== "application/dicom"');
  });

  it("the ownership filter is on the row read, and absent reads as not found", () => {
    const i = src.indexOf("async function actDocumentsPreview");
    expect(i).toBeGreaterThan(-1);
    const body = src.slice(i, src.indexOf("\nasync function", i + 10));
    expect(body).toContain('.eq("user_id", ctx.userId)');
    // "Not yours" and "not there" must be indistinguishable, or the endpoint
    // is an id oracle.
    expect(body).toContain('reason: "not_found"');
  });

  it("nothing is stored: the render is returned, never written back", () => {
    const i = src.indexOf("async function actDocumentsPreview");
    const body = src.slice(i, src.indexOf("\nasync function", i + 10));
    expect(body).not.toMatch(/\.upload\(|\.uploadToSignedUrl\(/);
    expect(body).not.toMatch(/\.from\("health_records"\)/);
    // A second stored object would be a second thing to delete and a second
    // thing to purge; there is deliberately none.
    expect(body).toContain("imageToBase64");
  });

  it("a scan's title comes from its own header at confirm, and never refuses", () => {
    const i = src.indexOf("async function actDocumentsConfirm");
    expect(i).toBeGreaterThan(-1);
    const body = src.slice(i, src.indexOf("\nasync function", i + 10));
    expect(body).toContain("describeDicomHeader(parsed.header)");
    expect(body).toContain("MAX_TITLE_CHARS");
    // The parse failing must leave the row stored under its filename, not
    // throw the person's scan away.
    expect(body).toContain('patch: Record<string, unknown> = { status: "stored" }');
  });
});
