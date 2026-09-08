/**
 * ONIQ HEALTH AI — the minimum-data context builder. Pure.
 *
 * A task sees only the rows it needs and only the fields it needs; the
 * builder is the only place that decides which, and the manifest it returns
 * is the record of what it decided — ids and counts, never content.
 *
 * WHAT A PROVIDER SEES IS BUILT FROM A FIELD LIST, NOT COPIED. Each task
 * names its fields in `FIELDS_FOR_TASK`; `pickRecord` copies only those, and
 * the manifest carries the same list, so what was sent and what was audited
 * cannot disagree. Every string that came from a person or a document is
 * scrubbed; an enum (`kind`, `source`) is validated against its closed list
 * rather than trusted.
 *
 * ROWS ARE ALIASED. A provider sees r1, r2… and d1, never a row id; the
 * gateway maps aliases back by position (`manifest.recordIds[i]` is r{i+1}).
 *
 * INJECTION: DROPPED FOR MODELS, FLAGGED FOR RULES. A record whose text
 * trips the detector — display, note OR unit; the unit was the field the
 * red team found unchecked — leaves a model-bound context and is listed in
 * `manifest.excluded`; document text bound for the rules-only extractor
 * proceeds with `injectionSuspected` set and NO exclusion entry, because a
 * regex cannot be instructed and refusing would lose the person's report
 * over a phrase. THE MANIFEST DESCRIBES WHAT WAS SENT: an entry in
 * `excluded` means the field is absent from the provider input, always —
 * the first version listed classify/extract text as excluded while handing
 * it over, and the receipt would have lied.
 *
 * OVER A CAP IS A REFUSAL, NOT A TRIM, and the cap is measured on the
 * SCRUBBED text — scrubbing can grow a string ("a@b.cd" becomes
 * "[email]"), and the cap bounds what the provider sees, not what was
 * typed. A 600-character question is refused as `text_too_long`, not cut
 * to 500 — the person is told, and nothing is silently lost. The one
 * exception is the classification EXCERPT, which is a prefix by definition
 * and is recorded as `truncated`.
 *
 * PRIORS ARE THE SAME ANALYTE. explain_record lends a target the value and
 * date of earlier readings with the same kind AND the same (normalised)
 * display — the same kind alone made an HbA1c row "an earlier Cholesterol
 * reading". Excluded rows are BACKFILLED: the loop over loaded rows stops
 * when the context is full, not at the first MAX_RECORDS rows.
 */
import {
  CONTEXT_FIELDS,
  LIMITS,
  type AiContext,
  type AiLanguage,
  type AiRefusalReason,
  type AiTask,
  type ContextDocument,
  type ContextField,
  type ContextManifest,
  type ContextRecord,
  type ExcludedItem,
} from "./types.ts";
import { cleanField, normalizeForMatch } from "./scrub.ts";
import { estimateContextTokens } from "./cost.ts";
import { CATEGORY_FOR_KIND, PROVENANCE_SOURCES, RECORD_KINDS, type RecordKind } from "../domain.ts";

export type RecordRow = {
  id: string;
  kind: string;
  display: string;
  value_num: number | string | null;
  value_unit: string | null;
  value_text: string | null;
  effective_at: string;
  status?: string;
  provenance: { source?: string } | null;
};

export type DocRow = {
  id: string;
  kind: string;
  title: string;
  mime: string;
  size_bytes: number;
  captured_at: string | null;
  created_at: string;
  /** When present, the gateway refuses anything but a stored/processing/ready document. */
  status?: string;
};

export type ContextInput = {
  task: AiTask;
  language: AiLanguage;
  /** Active rows, newest first, already scoped to the person AND to consented categories. */
  records: readonly RecordRow[];
  targetRecordId?: string | null;
  document?: DocRow | null;
  documentText?: string | null;
  question?: string | null;
};

export type ContextResult =
  | { ok: true; context: AiContext; manifest: ContextManifest }
  | { ok: false; reason: AiRefusalReason; detail?: Record<string, string> };

const RECORD_BASE: readonly ContextField[] = [
  "kind",
  "display",
  "valueNum",
  "valueUnit",
  "effectiveDay",
  "dateLabel",
  "source",
];
const DOCUMENT_BASE: readonly ContextField[] = [
  "documentKind",
  "title",
  "mime",
  "sizeBytes",
  "capturedDay",
];

/** Which fields each task may see. The manifest records the list, so it is auditable. */
export const FIELDS_FOR_TASK: Record<AiTask, readonly ContextField[]> = {
  explain_record: [...RECORD_BASE, "valueText"],
  summarize_timeline: [...RECORD_BASE],
  answer_question: [...RECORD_BASE, "question"],
  classify_document: [...DOCUMENT_BASE, "text"],
  extract_document: [...DOCUMENT_BASE, "text"],
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Mar 2026" from an ISO instant, in UTC. The one rendering a fact may quote. */
export function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function dayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function categoryOf(kind: string): string {
  return (CATEGORY_FOR_KIND as Record<string, string>)[kind as RecordKind] ?? "notes";
}

type Picked = { record: ContextRecord | null; excluded: ExcludedItem | null; redactions: number };

/**
 * One row → the fields this task may see, aliased, scrubbed, or excluded.
 * `fields` is the task's list; a field not in it is never read.
 */
export function pickRecord(
  row: RecordRow,
  ref: string,
  fields: readonly ContextField[],
  language: AiLanguage,
): Picked {
  let redactions = 0;
  const kind = (RECORD_KINDS as readonly string[]).includes(row.kind) ? row.kind : "note";
  const source =
    row.provenance?.source &&
    (PROVENANCE_SOURCES as readonly string[]).includes(row.provenance.source)
      ? row.provenance.source
      : "unknown";
  const display = cleanField(row.display, LIMITS.MAX_DISPLAY_CHARS, language);
  redactions += display.redactions;
  if (display.injection.suspected || display.tooLong) {
    return {
      record: null,
      excluded: {
        id: row.id,
        field: "display",
        reason: display.tooLong
          ? "over_limit"
          : display.injection.obfuscation
            ? "obfuscation_suspected"
            : "injection_suspected",
      },
      redactions,
    };
  }
  let valueText: string | null = null;
  if (fields.includes("valueText") && row.value_text) {
    const note = cleanField(row.value_text, LIMITS.MAX_NOTE_CHARS, language);
    redactions += note.redactions;
    if (note.injection.suspected || note.tooLong) {
      return {
        record: null,
        excluded: {
          id: row.id,
          field: "valueText",
          reason: note.tooLong
            ? "over_limit"
            : note.injection.obfuscation
              ? "obfuscation_suspected"
              : "injection_suspected",
        },
        redactions,
      };
    }
    valueText = note.text || null;
  }
  const num = row.value_num === null || row.value_num === undefined ? null : Number(row.value_num);
  let valueUnit: string | null = null;
  if (fields.includes("valueUnit") && row.value_unit) {
    const unit = cleanField(row.value_unit, LIMITS.MAX_UNIT_CHARS, language);
    redactions += unit.redactions;
    if (unit.injection.suspected || unit.tooLong) {
      return {
        record: null,
        excluded: {
          id: row.id,
          field: "valueUnit",
          reason: unit.tooLong
            ? "over_limit"
            : unit.injection.obfuscation
              ? "obfuscation_suspected"
              : "injection_suspected",
        },
        redactions,
      };
    }
    valueUnit = unit.text || null;
  }
  const record: ContextRecord = {
    ref,
    kind: fields.includes("kind") ? kind : "",
    display: display.text,
    valueNum: fields.includes("valueNum") && num !== null && Number.isFinite(num) ? num : null,
    valueUnit,
    valueText,
    effectiveDay: fields.includes("effectiveDay") ? dayOf(row.effective_at) : "",
    dateLabel: fields.includes("dateLabel") ? dateLabel(row.effective_at) : "",
    source: fields.includes("source") ? source : "",
  };
  return { record, excluded: null, redactions };
}

function manifestFor(
  task: AiTask,
  language: AiLanguage,
  context: AiContext,
  ids: { records: string[]; documents: string[] },
  redactions: number,
  excluded: ExcludedItem[],
  truncated: boolean,
  injectionSuspected: boolean,
): ContextManifest {
  const categories = new Set<string>();
  for (const r of context.records) categories.add(categoryOf(r.kind));
  if (context.documents.length > 0) categories.add("documents");
  const charCount =
    context.records.reduce((n, r) => n + r.display.length + (r.valueText?.length ?? 0), 0) +
    context.documents.reduce((n, d) => n + d.title.length + (d.text?.length ?? 0), 0) +
    (context.question?.length ?? 0);
  return {
    task,
    language,
    recordIds: ids.records,
    documentIds: ids.documents,
    categories: [...categories].sort(),
    fields: FIELDS_FOR_TASK[task].filter((f) => (CONTEXT_FIELDS as readonly string[]).includes(f)),
    charCount,
    estimatedInputTokens: estimateContextTokens(context),
    redactions,
    excluded,
    truncated,
    injectionSuspected,
  };
}

/** Drop the oldest records until the estimate fits the cap. */
function fit(context: AiContext, ids: string[]): boolean {
  let truncated = false;
  while (context.records.length > 1 && estimateContextTokens(context) > LIMITS.MAX_CONTEXT_TOKENS) {
    context.records.pop();
    ids.pop();
    truncated = true;
  }
  return truncated;
}

function activeOnly(rows: readonly RecordRow[]): RecordRow[] {
  return rows.filter((r) => r.status === undefined || r.status === "active");
}

export function buildMinimumContext(input: ContextInput): ContextResult {
  const { task, language } = input;
  const fields = FIELDS_FOR_TASK[task];
  const excluded: ExcludedItem[] = [];
  const ids = { records: [] as string[], documents: [] as string[] };
  let redactions = 0;
  let truncated = false;
  let injectionSuspected = false;
  const context: AiContext = { task, language, records: [], documents: [], question: null };
  const rows = activeOnly(input.records);

  // The note travels only on the TARGET of explain_record; a prior reading
  // of the same kind lends its value and date, never its free text.
  const add = (row: RecordRow, isTarget = false) => {
    if (context.records.length >= LIMITS.MAX_RECORDS) return;
    const ref = `r${context.records.length + 1}`;
    const p = pickRecord(
      row,
      ref,
      isTarget ? fields : fields.filter((f) => f !== "valueText"),
      language,
    );
    redactions += p.redactions;
    if (p.record) {
      context.records.push(p.record);
      ids.records.push(row.id);
    } else if (p.excluded) {
      excluded.push(p.excluded);
    }
  };

  switch (task) {
    case "explain_record": {
      const target = rows.find((r) => r.id === input.targetRecordId);
      if (!target) return { ok: false, reason: "not_found" };
      add(target, true);
      if (context.records.length === 0) {
        return {
          ok: false,
          reason: "question_rejected",
          detail: { field: excluded[0]?.field ?? "display" },
        };
      }
      const analyte = normalizeForMatch(target.display);
      const prior = rows.filter(
        (r) =>
          r.kind === target.kind && r.id !== target.id && normalizeForMatch(r.display) === analyte,
      );
      for (const row of prior) {
        if (context.records.length > LIMITS.MAX_PRIOR_SAME_KIND) break;
        add(row);
      }
      break;
    }
    case "summarize_timeline": {
      for (const row of rows) {
        if (context.records.length >= LIMITS.MAX_RECORDS) break;
        add(row);
      }
      break;
    }
    case "answer_question": {
      const raw = input.question ?? "";
      if (raw.length > LIMITS.MAX_QUESTION_CHARS) return { ok: false, reason: "text_too_long" };
      const q = cleanField(raw, LIMITS.MAX_QUESTION_CHARS, language);
      redactions += q.redactions;
      if (q.tooLong) return { ok: false, reason: "text_too_long" };
      if (!q.text.trim())
        return { ok: false, reason: "question_rejected", detail: { field: "question" } };
      if (q.injection.suspected) {
        return {
          ok: false,
          reason: "question_rejected",
          detail: { field: "question", matched: q.injection.matched.join(",") },
        };
      }
      context.question = q.text;
      const words = q.text
        .toLowerCase()
        .split(/[^\p{L}\p{M}\p{N}]+/u)
        .filter((w) => w.length > 2);
      const matches = rows.filter((r) => {
        const hay = `${r.kind} ${r.display}`.toLowerCase();
        return words.some((w) => hay.includes(w));
      });
      for (const row of matches) {
        if (context.records.length >= LIMITS.MAX_QUESTION_MATCHES) break;
        add(row);
      }
      break;
    }
    case "classify_document":
    case "extract_document": {
      const doc = input.document;
      if (!doc) return { ok: false, reason: "not_found" };
      const raw = input.documentText ?? "";
      if (task === "extract_document") {
        if (!raw.trim()) return { ok: false, reason: "no_text" };
        if (raw.length > LIMITS.MAX_DOCUMENT_CHARS) return { ok: false, reason: "text_too_long" };
      }
      const title = cleanField(doc.title, LIMITS.MAX_DISPLAY_CHARS, language);
      redactions += title.redactions;
      if (title.injection.suspected) {
        excluded.push({ id: doc.id, field: "title", reason: "injection_suspected" });
        injectionSuspected = true;
      }
      const excerpt = task === "classify_document" ? raw.slice(0, LIMITS.MAX_EXCERPT_CHARS) : raw;
      if (excerpt.length < raw.length) truncated = true;
      const text = cleanField(excerpt, LIMITS.MAX_DOCUMENT_CHARS, language);
      redactions += text.redactions;
      if (task === "extract_document" && text.tooLong)
        return { ok: false, reason: "text_too_long" };
      let docText: string | null = text.text || null;
      if (docText && text.injection.suspected) {
        injectionSuspected = true;
        if (task === "classify_document") {
          excluded.push({ id: doc.id, field: "text", reason: "injection_suspected" });
          docText = null;
        }
      }
      const entry: ContextDocument = {
        ref: "d1",
        kind: doc.kind,
        title: title.injection.suspected ? "" : title.text,
        mime: doc.mime,
        sizeBytes: doc.size_bytes,
        capturedDay: dayOf(doc.captured_at ?? doc.created_at) || dayOf(doc.created_at),
        text: docText,
      };
      context.documents.push(entry);
      ids.documents.push(doc.id);
      break;
    }
  }

  truncated = fit(context, ids.records) || truncated;
  return {
    ok: true,
    context,
    manifest: manifestFor(
      task,
      language,
      context,
      ids,
      redactions,
      excluded,
      truncated,
      injectionSuspected,
    ),
  };
}
