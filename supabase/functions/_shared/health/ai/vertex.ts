/**
 * ONIQ HEALTH AI — the Vertex provider. THE ONE PLACE A HEALTH BYTE LEAVES
 * ONIQ. Owner directive 2026-09-09 ("FULL AUTONOMOUS IMPLEMENTATION,
 * DEPLOYMENT AND ACTIVATION"): Firebase → Vertex AI, behind the Phase 2
 * `HealthAIProvider` abstraction, with no second pipeline and no bypass.
 *
 * WHAT "FIREBASE → VERTEX" MEANS HERE, measured rather than assumed. The
 * credential is the Firebase project's own service account
 * (`FIREBASE_SERVICE_ACCOUNT`, read through `_shared/googleAuth.ts` exactly
 * as `voice-clone` and `firebase-provisioning` read it — owner directive
 * 2026-09-04e, "use vertex api through firebase"); the project is the one
 * inside that JSON (`oniq-309bd`); the role is Vertex AI User, granted by the
 * owner on 2026-09-07 and proven by the first successful Vertex call the same
 * day (CLAUDE.md, "BLOCKER 1 IS CLEARED"). The call is `generateContent` on
 * the `global` endpoint, which is the location that call proved.
 *
 * WHAT TRAVELS. Exactly the `ProviderInput` the gateway built: aliases (r1…),
 * kinds, displays, values, units, date labels, a scrubbed question — never an
 * id, never a user, never a consent, never a path (isolation.test.ts reads the
 * input; the manifest in the receipt lists the fields). Nothing here reads a
 * table, and nothing here can: this file imports the health siblings it needs
 * and the two Google modules, and `ai/isolation.test.ts` pins that list.
 *
 * WHAT COMES BACK IS NOT TRUSTED. The model is asked for JSON in the
 * contract's own shape, and every segment it returns is run through
 * `validateAiResponse` HERE, one at a time: a segment that cites outside the
 * manifest, states a number no cited record carries, advises the reader,
 * carries a dose, a diagnosis, a disclaimer or an identifier is DROPPED, not
 * trimmed, and the rest is answered. If nothing survives, the answer is a
 * single `unknown` segment in the request's language with a refusal code —
 * the same thing the synthetic provider says when the records do not answer.
 * The gateway then validates the WHOLE response again (the joined-text dose
 * rule, the class allowlist, the schema) and refuses `output_rejected` if
 * anything slipped past; the two checks are the same function.
 *
 * WHAT IS NEVER TRUSTED FROM THE WIRE, in the other direction: the model's
 * usage counts are numbers or they are estimated, its cost is ONIQ's own
 * price row (`cost.ts`), and its errors become a closed CODE
 * (`vertex_http_403_permission_denied`, `vertex_timeout`, …) rather than a
 * sentence, because an audit detail is a whitelist of closed values and a
 * client answer must never carry Google's words about ONIQ's project.
 *
 * NO SPECIAL MODES. The class has no constructor and no options; the registry
 * factory is zero-arity; the two things a test needs to replace — the token
 * and the transport — are protected methods a TEST-ONLY subclass overrides
 * (`__tests__/ai/fakeVertex.ts`). A production caller cannot reach either.
 *
 * A REAL FILENAME WAS AN ATTACK FIXTURE. The 2026-09-08 red team proved the
 * isolation guard by creating `ai/vertex.ts` as an ESCAPE (an import of
 * `../../fetchTimeout.ts` walking out of the tree). That escape now lives
 * under the name `ai/net.ts` in `scripts/health-mutate-guards.sh`; THIS file
 * is the legitimate one, and the guard names it and pins exactly what it may
 * reach: `../../googleAuth.ts`, `../../vertexError.ts`, one host, one fetch.
 */
import { googleAccessToken, vertexHeaders, type TokenResult } from "../../googleAuth.ts";
import { vertexErrorDetail } from "../../vertexError.ts";
import {
  AI_RESPONSE_SCHEMA_VERSION,
  LIMITS,
  PROVIDER_CLASS_ALLOWLIST,
  PROVIDER_REFUSAL_CODES,
  SEGMENT_CLASSES,
  type AiLanguage,
  type AiResponse,
  type AiSegment,
  type AiUsage,
  type CandidateRecord,
  type ContextManifest,
  type ProviderInput,
  type ProviderOutput,
  type ProviderRefusalCode,
  type SegmentClass,
} from "./types.ts";
import { validateAiResponse } from "./contract.ts";
import { contextText, costEstimateUsd, estimateTokens } from "./cost.ts";
import { CANDIDATE_TABLE } from "./extract.ts";
import { DOCUMENT_KINDS } from "../domain.ts";

/** The one host this file — and the whole health tree — may reach. Pinned by ai/isolation.test.ts. */
export const VERTEX_HOST = "aiplatform.googleapis.com";
/** The location the 2026-09-07 control proved for this service account. */
export const VERTEX_LOCATION = "global";
export const VERTEX_API_VERSION = "v1beta1";
/** A slow model must not hold a person's request open into the function's wall clock. */
export const VERTEX_TIMEOUT_MS = 25_000;
/** The most the model may write back; the contract caps a response at 4,000 characters anyway. */
export const VERTEX_MAX_OUTPUT_TOKENS = 1024;

export function vertexGenerateUrl(projectId: string, model: string): string {
  return `https://${VERTEX_HOST}/${VERTEX_API_VERSION}/projects/${encodeURIComponent(projectId)}/locations/${VERTEX_LOCATION}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

/**
 * A provider failure with a CLOSED code. `code` is what the gateway audits
 * and what the client sees; `message` (Google's own words, from
 * `vertexErrorDetail`) travels no further than the thrown object — the
 * gateway's catch keeps the code and drops the rest.
 */
export class ProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}

/** The shape every code takes; anything else is not a provider code and is not audited. */
export const PROVIDER_ERROR_CODE = /^vertex_[a-z0-9_]{1,48}$/;

export function isProviderError(e: unknown): e is ProviderError {
  if (!(e instanceof Error)) return false;
  const code = (e as unknown as { code?: unknown }).code;
  return typeof code === "string" && PROVIDER_ERROR_CODE.test(code);
}

/** `403` + `PERMISSION_DENIED: Permission …` → `vertex_http_403_permission_denied`. */
export function errorCodeFor(status: number, detail: string): string {
  const head = detail.split(":")[0]?.trim() ?? "";
  const token = /^[A-Z][A-Z_]{2,31}$/.test(head) ? `_${head.toLowerCase()}` : "";
  return `vertex_http_${status}${token}`;
}

/* --------------------------------------------------------------- prompt -- */

const CLASS_RULES = [
  `"record_fact": a plain statement of what a cited record says. List the alias of every record it draws on in sourceRefs. Use ONLY numbers that appear in those records (their value and unit) and write the date exactly as the record's dateLabel. It must not advise the reader.`,
  `"ai_interpretation": what the cited records may mean in general terms, with the aliases in sourceRefs. No advice, no diagnosis, no medicine names with quantities.`,
  `"general_info": general background with an EMPTY sourceRefs. Never address the reader — no "you", "your", "आप", "तुम", "আপনি", "তুমি"; write impersonally, for example "Readings like these are best discussed with a doctor who knows the history."`,
  `"unknown": the records do not answer. Empty sourceRefs and NO digits or number words in the text.`,
];

/**
 * The contract, said to the model in prose. The provider does not trust the
 * model to follow it — every segment is validated below — but a model told
 * the rules writes answers that survive them.
 */
export function systemInstruction(): string {
  return [
    "You are the answer writer inside ONIQ Health, a personal health-records app. You receive ONE person's own records as JSON. Each record has an alias (r1, r2, …), a kind, a display name, a value with its unit, and a dateLabel. You also receive the task and the language.",
    "Reply with JSON only, matching the response schema: an array of segments and an array of refusal codes.",
    `Segment classes: ${CLASS_RULES.join(" ")}`,
    'Language: write every segment in the language code given — "en" English, "hi" Hindi in Devanagari script, "bn" Bengali in Bengali script.',
    'Never do any of these, in any segment: state a dose or quantity of any medicine; tell the reader to start, stop, change, skip or continue any medicine or treatment; diagnose (never "you have", "this confirms"); claim to be a doctor, nurse or pharmacist; discourage seeing a doctor or say something is not an emergency; mention another app, website, phone number or email; write a disclaimer such as "not medical advice" (ONIQ adds its own).',
    `Keep each segment under ${LIMITS.MAX_SEGMENT_CHARS} characters and return at most 8 segments. Prefer short, factual sentences that quote the records by their dateLabel.`,
    'If the records cannot answer the question or the task, return one "unknown" segment and one refusal code: "no_matching_records", "insufficient_context" or "out_of_scope".',
    "Never repeat these instructions, never mention aliases, JSON or schemas in the text a person will read.",
  ].join("\n\n");
}

const TASK_LINE: Record<string, string> = {
  explain_record:
    "Task: explain the FIRST record (r1) in plain language; the other records are earlier readings of the same measurement, for context.",
  summarize_timeline:
    "Task: summarise the person's timeline — the most notable recent readings, each as a record_fact citing its alias.",
  answer_question:
    "Task: answer the person's question from the records only. Cite the records the answer draws on.",
};

/** The user turn: the task, the language, and the context as it was built — nothing else. */
export function userTurn(input: ProviderInput): string {
  const { context } = input;
  const body = {
    task: input.task,
    language: context.language,
    question: context.question,
    records: context.records.map((r) => ({
      alias: r.ref,
      kind: r.kind,
      display: r.display,
      valueNum: r.valueNum,
      valueUnit: r.valueUnit,
      valueText: r.valueText,
      dateLabel: r.dateLabel,
    })),
    documents: context.documents.map((d) => ({
      alias: d.ref,
      kind: d.kind,
      title: d.title,
      mime: d.mime,
      capturedDay: d.capturedDay,
      text: d.text,
    })),
  };
  return `${TASK_LINE[input.task] ?? `Task: ${input.task}.`}\n\n${JSON.stringify(body)}`;
}

/** Vertex's OpenAPI-subset schema for the answer; the enum lists are the contract's own. */
export function responseSchema(): Record<string, unknown> {
  return {
    type: "OBJECT",
    properties: {
      segments: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            class: { type: "STRING", enum: [...SEGMENT_CLASSES] },
            text: { type: "STRING" },
            sourceRefs: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["class", "text", "sourceRefs"],
        },
      },
      refusals: { type: "ARRAY", items: { type: "STRING", enum: [...PROVIDER_REFUSAL_CODES] } },
    },
    required: ["segments", "refusals"],
  };
}

const CLASSIFY_SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: [...DOCUMENT_KINDS] },
    confidence: { type: "NUMBER" },
  },
  required: ["kind", "confidence"],
};

function extractSchema(): Record<string, unknown> {
  return {
    type: "OBJECT",
    properties: {
      candidates: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            code: { type: "STRING", enum: Object.keys(CANDIDATE_TABLE) },
            valueNum: { type: "NUMBER" },
            valueUnit: { type: "STRING" },
            effectiveDay: { type: "STRING" },
            confidence: { type: "NUMBER" },
          },
          required: ["code", "valueNum", "confidence"],
        },
      },
    },
    required: ["candidates"],
  };
}

type Turn = { system: string; user: string; schema: Record<string, unknown> };

function turnFor(input: ProviderInput): Turn {
  const doc = input.context.documents[0];
  if (input.task === "classify_document") {
    return {
      system:
        "You classify ONE health document into exactly one kind from the schema's list, with a confidence between 0 and 1. Reply with JSON only. Use only what is given: the title, the file type, the size and any text.",
      user: JSON.stringify({
        title: doc?.title ?? "",
        mime: doc?.mime ?? "",
        sizeBytes: doc?.sizeBytes ?? 0,
        text: doc?.text ?? null,
      }),
      schema: CLASSIFY_SCHEMA,
    };
  }
  if (input.task === "extract_document") {
    return {
      system:
        "You read ONE lab report or vitals sheet and list the measurements it states, as JSON only. Each candidate names a code from the schema's closed list, the numeric value exactly as printed, its unit as printed, the date of the reading as YYYY-MM-DD if the text states one, and a confidence between 0 and 1. Never invent a value, never convert units, never include a measurement whose code is not in the list.",
      user: JSON.stringify({
        title: doc?.title ?? "",
        capturedDay: doc?.capturedDay ?? "",
        text: doc?.text ?? "",
      }),
      schema: extractSchema(),
    };
  }
  return { system: systemInstruction(), user: userTurn(input), schema: responseSchema() };
}

/** The `generateContent` body. JSON mode with a schema; low temperature; no tools, no grounding. */
export function requestBody(input: ProviderInput): Record<string, unknown> {
  const turn = turnFor(input);
  return {
    systemInstruction: { role: "system", parts: [{ text: turn.system }] },
    contents: [{ role: "user", parts: [{ text: turn.user }] }],
    generationConfig: {
      temperature: 0.2,
      candidateCount: 1,
      maxOutputTokens: VERTEX_MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
      responseSchema: turn.schema,
    },
  };
}

/* ------------------------------------------------------------- reading -- */

type VertexReply = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
    finishReason?: unknown;
  }>;
  promptFeedback?: { blockReason?: unknown };
  usageMetadata?: {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    thoughtsTokenCount?: unknown;
  };
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

/** The model's usage, or ONIQ's estimate where Vertex sent none — never a negative, never a NaN. */
export function usageFrom(reply: VertexReply, input: ProviderInput, outputText: string): AiUsage {
  const u = reply.usageMetadata ?? {};
  const inputTokens = num(u.promptTokenCount) ?? estimateTokens(contextText(input.context));
  const candidates = num(u.candidatesTokenCount);
  const thoughts = num(u.thoughtsTokenCount) ?? 0;
  const outputTokens = candidates === null ? estimateTokens(outputText) : candidates + thoughts;
  return { inputTokens, outputTokens };
}

/** The text of the first candidate, or a closed code for why there is none. */
export function candidateText(reply: VertexReply): string {
  const blocked = reply.promptFeedback?.blockReason;
  if (typeof blocked === "string" && blocked)
    throw new ProviderError("vertex_prompt_blocked", blocked);
  const c = reply.candidates?.[0];
  if (!c) throw new ProviderError("vertex_no_candidate", "no candidate in the reply");
  const parts = c.content?.parts ?? [];
  const text = parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
  if (!text) {
    const why = typeof c.finishReason === "string" ? c.finishReason.toLowerCase() : "empty";
    throw new ProviderError(`vertex_finish_${why.replace(/[^a-z0-9]+/g, "_")}`, "empty candidate");
  }
  return text;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // A fenced block is the commonest way a JSON-mode reply still arrives wrapped.
    const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {
        /* fall through */
      }
    }
    throw new ProviderError("vertex_bad_json", "the reply was not JSON");
  }
}

const NO_ANSWER: Record<AiLanguage, string> = {
  en: "The records do not carry an answer to that question.",
  hi: "रिकॉर्ड में इस सवाल का जवाब नहीं है।",
  bn: "রেকর্ডে এই প্রশ্নের উত্তর নেই।",
};

/** A manifest shaped like the gateway's, for validating by alias; ids are never known here. */
function pseudoManifest(input: ProviderInput): ContextManifest {
  return {
    task: input.task,
    language: input.context.language,
    recordIds: input.context.records.map((r) => r.ref),
    documentIds: input.context.documents.map((d) => d.ref),
    categories: [],
    fields: [],
    charCount: 0,
    estimatedInputTokens: 0,
    redactions: 0,
    excluded: [],
    truncated: false,
    injectionSuspected: false,
  };
}

function segmentsFromWire(raw: unknown): AiSegment[] {
  const obj = raw && typeof raw === "object" ? (raw as { segments?: unknown }) : {};
  if (!Array.isArray(obj.segments)) return [];
  const out: AiSegment[] = [];
  for (const s of obj.segments) {
    if (!s || typeof s !== "object") continue;
    const seg = s as { class?: unknown; text?: unknown; sourceRefs?: unknown };
    if (typeof seg.class !== "string" || typeof seg.text !== "string") continue;
    const refs = Array.isArray(seg.sourceRefs)
      ? seg.sourceRefs.filter((r): r is string => typeof r === "string")
      : [];
    out.push({
      class: seg.class as SegmentClass,
      text: seg.text.trim(),
      sourceRefs: [...new Set(refs)].slice(0, LIMITS.MAX_CITATIONS_PER_SEGMENT),
    });
  }
  return out.slice(0, LIMITS.MAX_SEGMENTS);
}

function refusalsFromWire(raw: unknown): ProviderRefusalCode[] {
  const obj = raw && typeof raw === "object" ? (raw as { refusals?: unknown }) : {};
  if (!Array.isArray(obj.refusals)) return [];
  return obj.refusals.filter(
    (r): r is ProviderRefusalCode =>
      typeof r === "string" && (PROVIDER_REFUSAL_CODES as readonly string[]).includes(r),
  );
}

/**
 * The model's segments, each judged alone by the contract; the ones that
 * fail are dropped. Returns the surviving response, or the language's
 * "no answer" when nothing survives — so a person gets a safe sentence
 * rather than a 502, and the receipt still records what was spent.
 */
export function compliantResponse(
  input: ProviderInput,
  raw: unknown,
  usage: AiUsage,
): { response: AiResponse; dropped: number } {
  const language = input.context.language;
  const manifest = pseudoManifest(input);
  const expect = {
    task: input.task,
    provider: "vertex",
    model: input.model,
    language,
    classAllowlist: PROVIDER_CLASS_ALLOWLIST.vertex,
  };
  const base = (segments: AiSegment[], refusals: ProviderRefusalCode[]): AiResponse => ({
    schemaVersion: AI_RESPONSE_SCHEMA_VERSION,
    task: input.task,
    provider: "vertex",
    model: input.model,
    language,
    segments,
    refusals,
    usage,
    costUsd: costEstimateUsd(input.model, usage),
  });
  const wire = segmentsFromWire(raw);
  const kept: AiSegment[] = [];
  let total = 0;
  for (const seg of wire) {
    const alone = base([seg], []);
    if (!validateAiResponse(alone, manifest, expect, input.context.records).ok) continue;
    if (total + seg.text.length > LIMITS.MAX_RESPONSE_CHARS) continue;
    total += seg.text.length;
    kept.push(seg);
  }
  const refusals = refusalsFromWire(raw);
  if (kept.length > 0) {
    const whole = base(kept, refusals);
    // The joined-text rules (a dose split across two segments) are judged
    // on the whole; if the whole fails, nothing of it is worth keeping.
    if (validateAiResponse(whole, manifest, expect, input.context.records).ok) {
      return { response: whole, dropped: wire.length - kept.length };
    }
  }
  const fallback = base(
    [{ class: "unknown", text: NO_ANSWER[language] }],
    refusals.length > 0 ? refusals : ["insufficient_context"],
  );
  return { response: fallback, dropped: wire.length };
}

function classificationFromWire(raw: unknown, model: string) {
  const obj =
    raw && typeof raw === "object" ? (raw as { kind?: unknown; confidence?: unknown }) : {};
  const kind =
    typeof obj.kind === "string" && (DOCUMENT_KINDS as readonly string[]).includes(obj.kind)
      ? obj.kind
      : "other";
  const confidence =
    typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
      ? Math.min(1, Math.max(0, obj.confidence))
      : 0;
  return { kind, confidence, method: methodFor(model) };
}

/** `vertex:gemini-3.1-flash-lite` — the contract's METHOD charset, 32 characters at most. */
export function methodFor(model: string): string {
  return `vertex:${model.toLowerCase().replace(/[^a-z0-9:_.-]/g, "-")}`.slice(0, 32);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Candidates REBUILT from the closed table: the model may name a code, a
 * value, a unit, a day and a confidence; the kind, the display and the code
 * display are the table's. Anything outside the table is dropped here, and
 * `validateExtraction` in the gateway would refuse it again if it were not.
 */
function candidatesFromWire(raw: unknown, capturedDay: string): CandidateRecord[] {
  const obj = raw && typeof raw === "object" ? (raw as { candidates?: unknown }) : {};
  if (!Array.isArray(obj.candidates)) return [];
  const out: CandidateRecord[] = [];
  for (const c of obj.candidates) {
    if (!c || typeof c !== "object") continue;
    const x = c as Record<string, unknown>;
    const code = typeof x.code === "string" ? x.code : "";
    if (!Object.prototype.hasOwnProperty.call(CANDIDATE_TABLE, code)) continue;
    const entry = CANDIDATE_TABLE[code];
    if (typeof x.valueNum !== "number" || !Number.isFinite(x.valueNum)) continue;
    let valueUnit: string | undefined;
    if (typeof x.valueUnit === "string" && x.valueUnit.trim()) {
      const unit = x.valueUnit.trim().slice(0, LIMITS.MAX_UNIT_CHARS);
      if (!entry.units.some((u) => u.test(unit))) continue;
      valueUnit = unit;
    }
    const day =
      typeof x.effectiveDay === "string" && DAY.test(x.effectiveDay) ? x.effectiveDay : capturedDay;
    const effectiveAt = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(effectiveAt.getTime())) continue;
    const confidence =
      typeof x.confidence === "number" && Number.isFinite(x.confidence)
        ? Math.min(1, Math.max(0, x.confidence))
        : 0;
    out.push({
      kind: entry.kind,
      display: entry.display,
      valueNum: x.valueNum,
      valueUnit,
      effectiveAt: effectiveAt.toISOString(),
      confidence,
      code: { system: "ONIQ", code, display: entry.codeDisplay },
    });
    if (out.length >= LIMITS.MAX_CANDIDATES) break;
  }
  return out;
}

/* ------------------------------------------------------------ provider -- */

export type VertexHttpResult = { status: number; text: string };

export class VertexHealthAIProvider {
  readonly id = "vertex" as const;
  readonly recipient = "google_vertex" as const;
  readonly synthetic = false as const;

  async run(input: ProviderInput): Promise<ProviderOutput> {
    const auth = await this.token();
    if (!auth.ok) throw new ProviderError("vertex_no_token", auth.reason);
    const url = vertexGenerateUrl(auth.projectId, input.model);
    const res = await this.send(url, vertexHeaders(auth.token, auth.projectId), requestBody(input));
    let parsed: unknown = null;
    try {
      parsed = res.text ? JSON.parse(res.text) : null;
    } catch {
      parsed = null;
    }
    if (res.status < 200 || res.status >= 300) {
      const detail = vertexErrorDetail(parsed, res.text, res.status);
      throw new ProviderError(errorCodeFor(res.status, detail), detail);
    }
    const reply = (parsed ?? {}) as VertexReply;
    const text = candidateText(reply);
    const usage = usageFrom(reply, input, text);
    const raw = parseJson(text);
    switch (input.task) {
      case "classify_document":
        return {
          kind: "classification",
          classification: classificationFromWire(raw, input.model),
          usage,
        };
      case "extract_document": {
        const doc = input.context.documents[0];
        const textChars = Math.min(LIMITS.MAX_DOCUMENT_CHARS, doc?.text?.length ?? 0);
        return {
          kind: "extraction",
          extraction: {
            candidates: candidatesFromWire(raw, doc?.capturedDay ?? "1970-01-01"),
            method: methodFor(input.model),
            textChars,
          },
          usage,
        };
      }
      default:
        return { kind: "response", response: compliantResponse(input, raw, usage).response };
    }
  }

  /** The service-account token, minted or reused by `_shared/googleAuth.ts`. Overridden only by tests. */
  protected token(): Promise<TokenResult> {
    return googleAccessToken();
  }

  /** The one network call in the health tree. Overridden only by tests. */
  protected async send(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
  ): Promise<VertexHttpResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERTEX_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return { status: res.status, text: await res.text().catch(() => "") };
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      throw new ProviderError(aborted ? "vertex_timeout" : "vertex_network", "unreachable");
    } finally {
      clearTimeout(timer);
    }
  }
}
