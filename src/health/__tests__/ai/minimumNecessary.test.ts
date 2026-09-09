/**
 * MINIMUM NECESSARY, PER OPERATION — Phase 4 (owner directive 2026-09-09,
 * §5): for each live operation, what leaves for the provider is exactly the
 * fields the task lists, over exactly the rows the task needs — and the
 * Vertex user turn carries LESS than the context (no `source`, no alias
 * beyond r1…, no id of any kind).
 *
 * Read by effect, from the real builder and the real request body, so a
 * field added to a context or a prompt shows up here as a failure.
 */
import { describe, expect, it } from "vitest";
import {
  FIELDS_FOR_TASK,
  buildMinimumContext,
  type DocRow,
  type RecordRow,
} from "../../../../supabase/functions/_shared/health/ai/context";
import {
  requestBody,
  transcriptionBody,
  userTurn,
} from "../../../../supabase/functions/_shared/health/ai/vertex";
import { LIMITS, type AiTask, type ProviderInput } from "../../ai/types";

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function record(n: number, patch: Partial<RecordRow> = {}): RecordRow {
  return {
    id: u(n),
    kind: "lab",
    display: "HbA1c",
    value_num: 6.1,
    value_unit: "%",
    value_text: `note ${n} about the reading`,
    effective_at: `2026-0${(n % 8) + 1}-14T09:00:00.000Z`,
    status: "active",
    provenance: { source: "user_entry" },
    ...patch,
  };
}

const DOC: DocRow = {
  id: u(100),
  kind: "lab_report",
  title: "CBC March",
  mime: "application/pdf",
  size_bytes: 1000,
  captured_at: "2026-03-14T00:00:00.000Z",
  created_at: "2026-03-15T00:00:00.000Z",
};

const RECORD_TASKS: AiTask[] = ["explain_record", "summarize_timeline", "answer_question"];
const DOCUMENT_TASKS: AiTask[] = ["classify_document", "extract_document"];

function build(task: AiTask, extra: Record<string, unknown> = {}) {
  const records = [
    record(10),
    record(11),
    record(12, { kind: "vital", display: "Blood pressure" }),
  ];
  const r = buildMinimumContext({
    task,
    language: "en",
    records,
    targetRecordId: u(10),
    document: DOC,
    documentText: "HbA1c 6.1 %\nHaemoglobin 13.2 g/dL",
    question: "What was my HbA1c?",
    ...extra,
  });
  expect(r.ok, task).toBe(true);
  if (!r.ok) throw new Error("unreachable");
  return r;
}

describe("what each operation reads", () => {
  it("record tasks read no document and document tasks read no record", () => {
    for (const task of RECORD_TASKS) {
      const { context } = build(task);
      expect(context.documents, task).toEqual([]);
      expect(context.records.length, task).toBeGreaterThan(0);
    }
    for (const task of DOCUMENT_TASKS) {
      const { context } = build(task);
      expect(context.records, task).toEqual([]);
      expect(context.documents, task).toHaveLength(1);
    }
  });

  it("the note (valueText) travels ONLY on the target of explain_record — never on a prior, a summary or an answer", () => {
    const explain = build("explain_record");
    expect(explain.context.records[0].valueText).toContain("note 10");
    for (const prior of explain.context.records.slice(1)) expect(prior.valueText).toBeNull();
    for (const task of ["summarize_timeline", "answer_question"] as const) {
      const { context } = build(task);
      for (const r of context.records) expect(r.valueText, task).toBeNull();
    }
  });

  it("the question travels only on answer_question", () => {
    for (const task of RECORD_TASKS) {
      const { context } = build(task);
      if (task === "answer_question") expect(context.question).toBe("What was my HbA1c?");
      else expect(context.question, task).toBeNull();
    }
  });

  it("classification sees an EXCERPT of the text; extraction sees the text; the manifest records both as `text`", () => {
    // Padded with words, not one letter: 200 unbroken [a-z0-9] characters
    // is the base64-exfiltration shape the detector (rightly) excludes.
    const long = "HbA1c 6.1 %\n".padEnd(LIMITS.MAX_EXCERPT_CHARS + 500, "lorem ipsum ");
    const classify = build("classify_document", { documentText: long });
    expect(classify.context.documents[0].text?.length).toBe(LIMITS.MAX_EXCERPT_CHARS);
    expect(classify.manifest.truncated).toBe(true);
    const extract = build("extract_document", { documentText: long });
    expect(extract.context.documents[0].text?.length).toBe(long.length);
  });

  it("the manifest's field list is the task's list, and every field on a context record is either listed or blank", () => {
    for (const task of RECORD_TASKS) {
      const { context, manifest } = build(task);
      expect(manifest.fields, task).toEqual([...FIELDS_FOR_TASK[task]]);
      for (const r of context.records) {
        if (!manifest.fields.includes("valueText")) expect(r.valueText, task).toBeNull();
        if (!manifest.fields.includes("valueUnit")) expect(r.valueUnit, task).toBeNull();
      }
    }
  });
});

describe("what the Vertex request carries, and what it leaves behind", () => {
  function input(task: AiTask): ProviderInput {
    const { context } = build(task);
    return {
      task,
      model: "gemini-3.1-flash-lite",
      context,
      counts: { records: context.records.length, documents: context.documents.length },
    };
  }

  it("a record's provenance source and its day stay behind: the user turn carries alias, kind, display, value, unit, note and the date label only", () => {
    const turn = JSON.parse(userTurn(input("explain_record")).split("\n\n")[1]);
    const keys = Object.keys(turn.records[0]).sort();
    expect(keys).toEqual(
      ["alias", "dateLabel", "display", "kind", "valueNum", "valueText", "valueUnit"].sort(),
    );
    expect(JSON.stringify(turn)).not.toMatch(
      /user_entry|effectiveDay|source|[0-9a-f]{8}-[0-9a-f]{4}-4/,
    );
  });

  it("no id, no user, no consent, no path, no request id in any request body, for any task", () => {
    for (const task of [...RECORD_TASKS, ...DOCUMENT_TASKS]) {
      const body = JSON.stringify(requestBody(input(task)));
      expect(body, task).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
      );
      expect(body, task).not.toMatch(/userId|user_id|consent|storage_path|requestId|receipt/i);
    }
  });

  it("the document tasks send the title, the type, the size, the day and the text — and for classification nothing else, not even the question", () => {
    for (const task of DOCUMENT_TASKS) {
      const body = requestBody(input(task));
      const turn = JSON.parse(
        (body.contents as Array<{ parts: Array<{ text: string }> }>)[0].parts[0].text,
      );
      expect(Object.keys(turn).sort(), task).toEqual(
        task === "classify_document"
          ? ["mime", "sizeBytes", "text", "title"]
          : ["capturedDay", "text", "title"],
      );
    }
  });

  it("a transcription sends the file and the instruction — no title, no kind, no question, no records", () => {
    const body = transcriptionBody("image/png", "AAAA");
    const s = JSON.stringify(body);
    expect(s).toContain('"inlineData"');
    expect(s).not.toMatch(/title|question|records|kind|alias/);
    expect((body.generationConfig as { responseMimeType: string }).responseMimeType).toBe(
      "text/plain",
    );
  });
});

describe("the four operations the brief names but ONIQ does not run (architecture inspection only)", () => {
  it("report comparison, doctor-visit preparation, term explanation and record search have no task, no cap and no prompt", () => {
    const tasks = Object.keys(FIELDS_FOR_TASK);
    for (const absent of ["compare", "visit", "prepare", "term", "search"]) {
      expect(
        tasks.some((t) => t.includes(absent)),
        absent,
      ).toBe(false);
    }
    expect(tasks.sort()).toEqual(
      [
        "answer_question",
        "classify_document",
        "explain_record",
        "extract_document",
        "summarize_timeline",
      ].sort(),
    );
  });
});
