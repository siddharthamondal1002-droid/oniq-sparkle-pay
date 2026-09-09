/**
 * THE PICKER IS ON THE SCREEN THE TILE LANDS ON.
 *
 * Owner report, 2026-09-09: _"nowhere to upload"_ — from the Health TIMELINE,
 * which is where the 🩺 Home tile goes. The file picker existed, was ungated,
 * and was served correctly; it was one tab across, behind "Documents". That is
 * the third time in this repo a working control shipped where nobody would
 * look — `upiDoors` ("active" and unreachable, reported as "no tabs, no
 * icons") and `/app/creations` (delete built on a screen with one inbound
 * link) are the other two, and both are written down in CLAUDE.md by the
 * agents who then repeated them.
 *
 * So this asserts the DOOR, not the component: that the landing screen itself
 * renders the picker, and that the two screens share ONE implementation rather
 * than each growing their own. Comments are stripped first — the files
 * discuss `HealthAddReport` and `type="file"` in prose, and a guard that reads
 * its own explanation as code passes on the very file it exists to catch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => stripComments(readFileSync(join(ROOT, p), "utf8"));

const TIMELINE = "src/routes/_authenticated/app.health.index.tsx";
const DOCUMENTS = "src/routes/_authenticated/app.health.records.tsx";
const COMPONENT = "src/health/AddReport.tsx";

describe("adding a report is reachable from where the Health tile lands", () => {
  it("the timeline renders the picker itself", () => {
    // The screen /app/health resolves to. If this ever stops being true the
    // person is back to hunting for it, which is the whole report.
    expect(read(TIMELINE)).toMatch(/<HealthAddReport\b/);
  });

  it("the documents screen renders the same component", () => {
    expect(read(DOCUMENTS)).toMatch(/<HealthAddReport\b/);
  });

  it("the picker exists once, in the component, and not in either screen", () => {
    // Two copies of an upload path drift silently: both still compile and both
    // still upload. OniqDeleteCreation is the precedent (2026-09-07).
    expect(read(COMPONENT)).toMatch(/type="file"/);
    expect(read(COMPONENT)).toMatch(/data-testid="health-doc-input"/);
    expect(read(TIMELINE)).not.toMatch(/type="file"/);
    expect(read(DOCUMENTS)).not.toMatch(/type="file"/);
  });

  it("the component carries the AI label and the report control", () => {
    // It is the declared health_ai_output surface now: the label went with
    // the output (playCompliance.ts), so this is where the guard's identifier
    // has to live.
    const src = read(COMPONENT);
    expect(src).toMatch(/HEALTH_AI_LABEL/);
    expect(src).toMatch(/<AiOutputReport\b/);
  });

  it("the file is never read whole to sniff its type", () => {
    // megaLoopGuardrails' shape: a bounded head through a stream reader.
    const src = read(COMPONENT);
    expect(src).not.toMatch(/\.arrayBuffer\(\)/);
    expect(src).toMatch(/stream\(\)\.getReader\(\)/);
  });
});

describe("analysing a report that is already stored", () => {
  /**
   * Owner report, 2026-09-09: _"analyse report is gone"_. The simplification
   * removed the per-document "Explain" button along with the eleven steps, and
   * with it the ONLY way to read a document that was already uploaded —
   * extraction ran at upload time and nowhere else. Removing a capability is
   * not the same as removing steps, and this is the assertion that says so.
   */
  it("every stored document offers Analyse, through the shared reader", () => {
    const src = read(DOCUMENTS);
    expect(src).toMatch(/data-testid="health-doc-analyse"/);
    expect(src).toContain("readStoredDocument(d.id, t)");
  });

  it("what the AI read back carries the label and the report control", () => {
    const src = read(DOCUMENTS);
    const i = src.indexOf('data-testid="health-doc-analyse-note"');
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, src.indexOf("</div>", src.indexOf("<AiOutputReport", i)));
    expect(block).toContain("HEALTH_AI_LABEL");
    expect(block).toContain('surface="health_ai_output"');
  });

  it("the SERVER refuses to store a reading it already stored for that document", () => {
    // A document can now be read twice — a retry, or a second tap. Nothing
    // else stops the duplicate: the insert has no unique constraint. The
    // client must never be the authority on it, so the filter is asserted in
    // the edge function, with the caller's id on the chain.
    const fn = stripComments(
      readFileSync(join(ROOT, "supabase/functions/health-ai/index.ts"), "utf8"),
    );
    expect(fn).toContain("dedupeKey");
    expect(fn).toContain("rows.filter((r) => !seen.has(dedupeKey(r)))");
    expect(fn).toContain(".insert(fresh)");

    // THE OWNERSHIP FILTER IS ASSERTED INSIDE THIS READ'S OWN CHAIN, not
    // anywhere in the file. Mutation-checked: `.eq("user_id", userId)` occurs
    // seven times in health-ai, so a whole-file match passed with the filter
    // deleted from exactly the query that needs it. The window is the chain,
    // bounded by the statement that consumes it.
    const chain = fn.slice(fn.indexOf("const { data: already }"), fn.indexOf("const seen ="));
    expect(chain).toContain('.eq("user_id", userId)');
    expect(chain).toContain('.eq("document_id", documentId)');
  });

  it("the zero case never claims nothing was found", () => {
    // Zero can mean "found, and already yours". The old sentence asserted the
    // other thing and would have been simply false on a re-read.
    const src = read(COMPONENT);
    expect(src).not.toContain("No lab values or vitals were found");
    // And it names what ONIQ can read, so an X-ray's zero is explained rather
    // than reported as a bare "nothing new" (owner report, "no result came up
    // on an xray report").
    expect(src).toContain("health.records.no_values");
    expect(src).toMatch(/blood and urine reports/);
  });
});
