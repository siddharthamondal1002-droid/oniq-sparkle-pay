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
