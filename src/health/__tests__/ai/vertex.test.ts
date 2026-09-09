/**
 * THE VERTEX PROVIDER, PROVEN WITHOUT A CREDENTIAL. Everything the provider
 * does around the one network call — what it sends, what it keeps, what it
 * drops, how it fails — runs here against a fake transport (`fakeVertex.ts`),
 * with Google's real error shapes as fixtures. The one thing this file cannot
 * prove is that the model id answers on the live project; that is the first
 * real POST, recorded in docs/health/07-phase3-report.md.
 */
import { describe, expect, it } from "vitest";
import {
  PROVIDER_ERROR_CODE,
  ProviderError,
  VERTEX_HOST,
  compliantResponse,
  errorCodeFor,
  isProviderError,
  methodFor,
  requestBody,
  responseSchema,
  systemInstruction,
  userTurn,
  vertexGenerateUrl,
} from "../../../../supabase/functions/_shared/health/ai/vertex";
import { providerFor } from "../../../../supabase/functions/_shared/health/ai/provider";
import { PRICE_PER_1M } from "../../../../supabase/functions/_shared/health/ai/cost";
import { validateAiResponse } from "../../../../supabase/functions/_shared/health/ai/contract";
import {
  runHealthAi,
  type AiConfig,
  type GatewayActor,
  type GatewayDeps,
} from "../../../../supabase/functions/_shared/health/ai/gateway";
import type { RecordRow } from "../../../../supabase/functions/_shared/health/ai/context";
import { CANDIDATE_TABLE } from "../../../../supabase/functions/_shared/health/ai/extract";
import { allHealthFlagsOff } from "../../flagNames";
import {
  MODEL_ALLOWLIST,
  PROVIDER_CLASS_ALLOWLIST,
  type ContextManifest,
  type ProviderInput,
} from "../../ai/types";
import { FakeStore, type FakeUser } from "./fakeStore";
import { FakeVertexProvider, vertexError, vertexReply, type Sent } from "./fakeVertex";
import { InlineTextSource } from "./inlineTextSource";

const MODEL = "gemini-3.1-flash-lite";
const NOW = "2026-09-09T12:00:00.000Z";
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALICE = u(1);

function input(patch: Partial<ProviderInput> = {}): ProviderInput {
  return {
    task: "answer_question",
    model: MODEL,
    context: {
      task: "answer_question",
      language: "en",
      records: [
        {
          ref: "r1",
          kind: "lab",
          display: "HbA1c",
          valueNum: 6.1,
          valueUnit: "%",
          valueText: null,
          effectiveDay: "2026-03-14",
          dateLabel: "14 Mar 2026",
          source: "user_entry",
        },
        {
          ref: "r2",
          kind: "vital",
          display: "Blood pressure",
          valueNum: 120,
          valueUnit: "mmHg",
          valueText: null,
          effectiveDay: "2026-04-02",
          dateLabel: "2 Apr 2026",
          source: "user_entry",
        },
      ],
      documents: [],
      question: "What was my last HbA1c?",
    },
    counts: { records: 2, documents: 0 },
    ...patch,
  };
}

const manifest = (inp: ProviderInput): ContextManifest => ({
  task: inp.task,
  language: inp.context.language,
  recordIds: inp.context.records.map((_, i) => u(50 + i)),
  documentIds: [],
  categories: ["labs", "vitals"],
  fields: [],
  charCount: 0,
  estimatedInputTokens: 0,
  redactions: 0,
  excluded: [],
  truncated: false,
  injectionSuspected: false,
});

const GOOD = {
  segments: [
    {
      class: "record_fact",
      text: "HbA1c on 14 Mar 2026 was recorded as 6.1 %.",
      sourceRefs: ["r1"],
    },
    {
      class: "general_info",
      text: "Readings like these are best discussed with a doctor who knows the history.",
      sourceRefs: [],
    },
  ],
  refusals: [],
};

describe("the request", () => {
  it("targets the one host, the global location and the allowlisted model", () => {
    const url = vertexGenerateUrl("oniq-309bd", MODEL);
    expect(url).toBe(
      `https://${VERTEX_HOST}/v1beta1/projects/oniq-309bd/locations/global/publishers/google/models/${MODEL}:generateContent`,
    );
    expect(VERTEX_HOST).toBe("aiplatform.googleapis.com");
    expect(MODEL_ALLOWLIST.vertex).toEqual([MODEL]);
    expect(PRICE_PER_1M[MODEL]).toMatchObject({ input: 0.25, output: 1.5 });
    expect(PRICE_PER_1M[MODEL].source).toMatch(/\[PAGE\].*20\d\d-\d\d-\d\d/);
  });

  it("is JSON mode with the contract's own schema, no tools, no grounding, low temperature", () => {
    const body = requestBody(input());
    const gen = body.generationConfig as Record<string, unknown>;
    expect(gen.responseMimeType).toBe("application/json");
    expect(gen.responseSchema).toEqual(responseSchema());
    expect(gen.temperature).toBeLessThanOrEqual(0.3);
    expect(gen.maxOutputTokens).toBeLessThanOrEqual(2048);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("toolConfig");
    expect(body).not.toHaveProperty("cachedContent");
    const schema = responseSchema() as {
      properties: { segments: { items: { properties: { class: { enum: string[] } } } } };
    };
    expect(schema.properties.segments.items.properties.class.enum).toEqual([
      "record_fact",
      "general_info",
      "ai_interpretation",
      "unknown",
    ]);
  });

  it("carries aliases, values, units, date labels and the question — never an id, a user, a path or a consent", () => {
    const text = userTurn(input());
    expect(text).toContain('"alias":"r1"');
    expect(text).toContain("HbA1c");
    expect(text).toContain("14 Mar 2026");
    expect(text).toContain("What was my last HbA1c?");
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
    expect(text).not.toMatch(/userId|user_id|consent|storage_path|requestId|effectiveDay/);
    // The system instruction states the contract's rules and the disclaimer ban.
    const sys = systemInstruction();
    for (const w of [
      "record_fact",
      "general_info",
      "ai_interpretation",
      "unknown",
      "dose",
      "diagnose",
      "disclaimer",
    ]) {
      expect(sys).toContain(w);
    }
  });
});

describe("what comes back is judged by the contract, one segment at a time", () => {
  const usage = { inputTokens: 120, outputTokens: 40 };

  it("keeps compliant segments, prices them from the row, and passes the gateway's own validation", () => {
    const inp = input();
    const { response, dropped } = compliantResponse(inp, GOOD, usage);
    expect(dropped).toBe(0);
    expect(response.segments).toHaveLength(2);
    expect(response.provider).toBe("vertex");
    expect(response.model).toBe(MODEL);
    expect(response.language).toBe("en");
    expect(response.costUsd).toBeCloseTo((120 / 1e6) * 0.25 + (40 / 1e6) * 1.5, 9);
    const verdict = validateAiResponse(
      response,
      manifest(inp),
      {
        task: inp.task,
        provider: "vertex",
        model: MODEL,
        language: "en",
        classAllowlist: PROVIDER_CLASS_ALLOWLIST.vertex,
      },
      inp.context.records,
    );
    expect(verdict).toEqual({ ok: true });
  });

  it.each([
    [
      "an ungrounded number",
      { class: "record_fact", text: "HbA1c on 14 Mar 2026 was 7.4 %.", sourceRefs: ["r1"] },
    ],
    [
      "a citation outside the manifest",
      { class: "record_fact", text: "HbA1c on 14 Mar 2026 was 6.1 %.", sourceRefs: ["r9"] },
    ],
    ["a fact with no source", { class: "record_fact", text: "HbA1c was 6.1 %.", sourceRefs: [] }],
    [
      "a dose",
      { class: "general_info", text: "Metformin 500 mg twice daily helps.", sourceRefs: [] },
    ],
    [
      "advice to the reader",
      {
        class: "record_fact",
        text: "You should take your HbA1c on 14 Mar 2026 seriously; it was 6.1 %.",
        sourceRefs: ["r1"],
      },
    ],
    [
      "general information in the second person",
      { class: "general_info", text: "Your readings look fine.", sourceRefs: [] },
    ],
    ["a diagnosis", { class: "ai_interpretation", text: "You have diabetes.", sourceRefs: ["r1"] }],
    [
      "a disclaimer",
      { class: "general_info", text: "This is not medical advice.", sourceRefs: [] },
    ],
    [
      "an unknown with a digit",
      { class: "unknown", text: "Nothing after 2026 answers that.", sourceRefs: [] },
    ],
    [
      "an off-app pointer",
      { class: "general_info", text: "Message me on WhatsApp for more.", sourceRefs: [] },
    ],
    [
      "a class the vertex allowlist has but a bad shape",
      { class: "diagnosis", text: "x", sourceRefs: [] },
    ],
  ])("drops %s and keeps the rest", (_name, bad) => {
    const inp = input();
    const { response, dropped } = compliantResponse(
      inp,
      { segments: [bad, ...GOOD.segments], refusals: [] },
      usage,
    );
    expect(dropped).toBe(1);
    expect(response.segments.map((s) => s.text)).toEqual(GOOD.segments.map((s) => s.text));
  });

  it("answers the language's 'no answer' with a refusal code when nothing survives", () => {
    const inp = input();
    const { response, dropped } = compliantResponse(
      inp,
      {
        segments: [{ class: "record_fact", text: "It was 9.9 %.", sourceRefs: ["r1"] }],
        refusals: [],
      },
      usage,
    );
    expect(dropped).toBe(1);
    expect(response.segments).toEqual([
      { class: "unknown", text: "The records do not carry an answer to that question." },
    ]);
    expect(response.refusals).toEqual(["insufficient_context"]);
    const hi = compliantResponse(
      input({ context: { ...inp.context, language: "hi" } }),
      { segments: [], refusals: ["no_matching_records"] },
      usage,
    );
    expect(hi.response.language).toBe("hi");
    expect(hi.response.refusals).toEqual(["no_matching_records"]);
    expect(hi.response.segments[0].text).toMatch(/[ऀ-ॿ]/);
  });

  it("survives a reply that is not the shape asked for", () => {
    const inp = input();
    for (const raw of [
      null,
      42,
      "text",
      [],
      { segments: "no" },
      { segments: [null, 1, { class: 3 }] },
      { refusals: ["made_up"] },
    ]) {
      const { response } = compliantResponse(inp, raw, usage);
      expect(response.segments[0].class).toBe("unknown");
      expect(response.refusals).toEqual(["insufficient_context"]);
    }
  });

  it("never keeps more than the contract's ceilings", () => {
    const inp = input();
    const many = Array.from({ length: 40 }, () => GOOD.segments[1]);
    const { response } = compliantResponse(inp, { segments: many, refusals: [] }, usage);
    expect(response.segments.length).toBeLessThanOrEqual(20);
    expect(response.segments.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(4000);
  });
});

describe("the provider, through its transport", () => {
  it("sends the bearer token and the project header to the model's URL, and answers a response", async () => {
    const p = new FakeVertexProvider(() => vertexReply(GOOD));
    const out = await p.run(input());
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0].url).toBe(vertexGenerateUrl("oniq-309bd", MODEL));
    expect(p.sent[0].headers.authorization).toBe("Bearer ya29.test-token");
    expect(p.sent[0].headers["x-goog-user-project"]).toBe("oniq-309bd");
    expect(out.kind).toBe("response");
    if (out.kind !== "response") return;
    expect(out.response.usage).toEqual({ inputTokens: 120, outputTokens: 40 });
    expect(out.response.segments).toHaveLength(2);
  });

  it("counts thoughts as output and estimates when Vertex sends no usage", async () => {
    const withThoughts = new FakeVertexProvider(() =>
      vertexReply(GOOD, {
        promptTokenCount: 100,
        candidatesTokenCount: 30,
        thoughtsTokenCount: 15,
      }),
    );
    const a = await withThoughts.run(input());
    if (a.kind === "response")
      expect(a.response.usage).toEqual({ inputTokens: 100, outputTokens: 45 });
    const none = new FakeVertexProvider(() => vertexReply(GOOD, null));
    const b = await none.run(input());
    if (b.kind === "response") {
      expect(b.response.usage.inputTokens).toBeGreaterThan(0);
      expect(b.response.usage.outputTokens).toBeGreaterThan(0);
    }
  });

  it.each([
    [
      "Google's 403 array",
      vertexError(403, "PERMISSION_DENIED", "Permission 'aiplatform.endpoints.predict' denied"),
      "vertex_http_403_permission_denied",
    ],
    [
      "a 404 for an unknown model",
      vertexError(404, "NOT_FOUND", "Publisher Model not found"),
      "vertex_http_404_not_found",
    ],
    [
      "a 429",
      vertexError(429, "RESOURCE_EXHAUSTED", "Quota exceeded"),
      "vertex_http_429_resource_exhausted",
    ],
    ["a 500 with an empty body", { status: 500, text: "" }, "vertex_http_500"],
    [
      "an HTML 404",
      { status: 404, text: "<!DOCTYPE html><title>Error 404</title>" },
      "vertex_http_404",
    ],
    [
      "a candidate that is not JSON",
      {
        status: 200,
        text: JSON.stringify({ candidates: [{ content: { parts: [{ text: "Sure! Here is" }] } }] }),
      },
      "vertex_bad_json",
    ],
    [
      "no candidate",
      { status: 200, text: JSON.stringify({ candidates: [] }) },
      "vertex_no_candidate",
    ],
    [
      "a blocked prompt",
      { status: 200, text: JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }) },
      "vertex_prompt_blocked",
    ],
    [
      "an empty candidate stopped for safety",
      {
        status: 200,
        text: JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] }),
      },
      "vertex_finish_safety",
    ],
  ])("%s becomes a closed code, not a sentence", async (_name, reply, code) => {
    const p = new FakeVertexProvider(() => reply);
    let caught: unknown;
    try {
      await p.run(input());
    } catch (e) {
      caught = e;
    }
    expect(isProviderError(caught)).toBe(true);
    expect((caught as ProviderError).code).toBe(code);
    expect(PROVIDER_ERROR_CODE.test(code)).toBe(true);
  });

  it("a missing credential is a code too, and no request is sent", async () => {
    const p = new FakeVertexProvider(() => vertexReply(GOOD), {
      ok: false,
      reason: "missing: GOOGLE_CLOUD_PROJECT",
    });
    await expect(p.run(input())).rejects.toMatchObject({ code: "vertex_no_token" });
    expect(p.sent).toHaveLength(0);
  });

  it("errorCodeFor keeps only Google's STATUS token, never its message", () => {
    expect(
      errorCodeFor(
        403,
        "PERMISSION_DENIED: Permission 'aiplatform.endpoints.predict' denied on resource projects/oniq-309bd",
      ),
    ).toBe("vertex_http_403_permission_denied");
    expect(errorCodeFor(404, "http 404 with an empty body")).toBe("vertex_http_404");
    expect(errorCodeFor(400, "<!DOCTYPE html>")).toBe("vertex_http_400");
    expect(errorCodeFor(400, "INVALID_ARGUMENT: bad")).toMatch(PROVIDER_ERROR_CODE);
    expect(isProviderError(new Error("plain"))).toBe(false);
    expect(isProviderError(new ProviderError("not_vertex", "x"))).toBe(false);
  });

  it("classifies and extracts through the same transport, rebuilding candidates from the closed table", async () => {
    const doc = {
      ref: "d1",
      kind: "lab_report",
      title: "CBC March",
      mime: "application/pdf",
      sizeBytes: 1000,
      capturedDay: "2026-03-14",
      text: "HbA1c 6.1 % on 2026-03-14",
    };
    const classify = new FakeVertexProvider(() =>
      vertexReply({ kind: "lab_report", confidence: 0.92 }),
    );
    const c = await classify.run(
      input({
        task: "classify_document",
        context: {
          task: "classify_document",
          language: "en",
          records: [],
          documents: [doc],
          question: null,
        },
        counts: { records: 0, documents: 1 },
      }),
    );
    expect(c).toMatchObject({
      kind: "classification",
      classification: { kind: "lab_report", confidence: 0.92, method: methodFor(MODEL) },
    });
    expect(methodFor(MODEL)).toBe("vertex:gemini-3.1-flash-lite");

    const extract = new FakeVertexProvider(() =>
      vertexReply({
        candidates: [
          {
            code: "hba1c",
            valueNum: 6.1,
            valueUnit: "%",
            effectiveDay: "2026-03-14",
            confidence: 0.9,
          },
          { code: "not_in_table", valueNum: 1, confidence: 0.9 },
          { code: "hba1c", valueNum: "six", confidence: 0.9 },
        ],
      }),
    );
    const e = await extract.run(
      input({
        task: "extract_document",
        context: {
          task: "extract_document",
          language: "en",
          records: [],
          documents: [doc],
          question: null,
        },
        counts: { records: 0, documents: 1 },
      }),
    );
    expect(e.kind).toBe("extraction");
    if (e.kind !== "extraction") return;
    expect(e.extraction.candidates).toHaveLength(1);
    expect(e.extraction.candidates[0]).toMatchObject({
      kind: CANDIDATE_TABLE.hba1c.kind,
      display: CANDIDATE_TABLE.hba1c.display,
      valueNum: 6.1,
      valueUnit: "%",
      effectiveAt: "2026-03-14T00:00:00.000Z",
      code: { system: "ONIQ", code: "hba1c", display: CANDIDATE_TABLE.hba1c.codeDisplay },
    });
    expect(e.extraction.method).toBe(methodFor(MODEL));
    expect(e.extraction.textChars).toBe(doc.text.length);
  });
});

/* -------------------------------------------- through the whole gateway -- */

function record(n: number, patch: Partial<RecordRow> = {}): RecordRow {
  return {
    id: u(n),
    kind: "lab",
    display: "HbA1c",
    value_num: 6.1,
    value_unit: "%",
    value_text: null,
    effective_at: "2026-03-14T09:00:00.000Z",
    status: "active",
    provenance: { source: "user_entry" },
    ...patch,
  };
}

function consent(
  id: string,
  purpose: string,
  recipient: string,
  termsVersion: string,
  status = "active",
) {
  return {
    id,
    purpose,
    dataCategories: ["vitals", "labs", "documents"],
    recipient,
    status,
    startTime: "2026-09-01T00:00:00.000Z",
    expiryTime: null as string | null,
    termsVersion,
  };
}

function alice(
  aiConsent = consent("a1", "ai_interpretation", "google_vertex", "health-ai-terms-v2"),
): Map<string, FakeUser> {
  return new Map([
    [
      ALICE,
      {
        id: ALICE,
        consents: [consent("s1", "store_records", "oniq", "health-terms-v1"), aiConsent],
        records: [
          record(10),
          record(11, { effective_at: "2026-01-10T09:00:00.000Z", value_num: 6.4 }),
        ],
        documents: [],
      },
    ],
  ]);
}

function config(patch: Partial<AiConfig> = {}): AiConfig {
  const flags = allHealthFlagsOff();
  flags["health.enabled"] = true;
  flags["health.ai.enabled"] = true;
  flags["health.provider_sharing.enabled"] = true;
  return {
    flags,
    environment: "production",
    provider: "vertex",
    model: MODEL,
    capPerUser: 10,
    capHouse: 500,
    adminVerificationEnabled: false,
    ...patch,
  };
}

const actor: GatewayActor = { isAdmin: false, isAdult: true, regionBlocked: false };

function deps(
  store: FakeStore,
  fake: FakeVertexProvider,
  extra: Partial<GatewayDeps> = {},
): GatewayDeps {
  return {
    store,
    now: NOW,
    requestId: u(999),
    textSource: null,
    providerFor: (id) => (id === "vertex" ? fake : providerFor(id)),
    ...extra,
  };
}

describe("the gateway with the vertex provider behind it", () => {
  it("answers an ordinary adult in PRODUCTION with a google_vertex consent under terms v2, receipts the cost, audits the request", async () => {
    const store = new FakeStore(alice(), ALICE);
    const fake = new FakeVertexProvider(() => vertexReply(GOOD));
    const r = await runHealthAi(deps(store, fake), config(), actor, {
      task: "answer_question",
      question: "What was my last HbA1c?",
    });
    expect(r.ok).toBe(true);
    if (!r.ok || r.result.kind !== "response") return;
    expect(r.result.response.provider).toBe("vertex");
    expect(r.result.response.model).toBe(MODEL);
    expect(r.result.response.segments[0].sourceRecordIds).toEqual([u(10)]);
    expect(r.result.response.costUsd).toBeGreaterThan(0);
    const receipt = store.receipts[0];
    expect(receipt.row.provider).toBe("vertex");
    expect(receipt.row.model).toBe(MODEL);
    expect(receipt.patches.at(-1)).toMatchObject({
      status: "ok",
      input_tokens: 120,
      output_tokens: 40,
    });
    expect(receipt.patches.at(-1)?.cost_usd).toBeGreaterThan(0);
    expect(store.audits.at(-1)).toMatchObject({ action: "ai.request", outcome: "ok" });
    // The wire: aliases and values, never an id, a user or a consent.
    const wire = JSON.stringify(fake.sent[0].body);
    expect(wire).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
    expect(wire).not.toMatch(/userId|user_id|consent|storage_path|requestId/);
    expect(wire).toContain("HbA1c");
    expect(fake.sent[0].url).toContain(VERTEX_HOST);
  });

  it("refuses provider_not_allowed while provider sharing is off, naming the recipient — and sends nothing", async () => {
    const store = new FakeStore(alice(), ALICE);
    const fake = new FakeVertexProvider(() => vertexReply(GOOD));
    const flags = config().flags;
    flags["health.provider_sharing.enabled"] = false;
    const r = await runHealthAi(deps(store, fake), config({ flags }), actor, {
      task: "summarize_timeline",
    });
    expect(r).toMatchObject({
      ok: false,
      reason: "provider_not_allowed",
      detail: { recipient: "google_vertex" },
    });
    expect(fake.sent).toHaveLength(0);
    expect(store.receipts).toHaveLength(0);
  });

  it.each([
    [
      "an ONIQ-only consent (terms v1)",
      consent("a1", "ai_interpretation", "oniq", "health-ai-terms-v1"),
    ],
    [
      "a google_vertex row granted under terms v1, which never disclosed Google",
      consent("a1", "ai_interpretation", "google_vertex", "health-ai-terms-v1"),
    ],
    [
      "a revoked google_vertex consent",
      consent("a1", "ai_interpretation", "google_vertex", "health-ai-terms-v2", "revoked"),
    ],
    [
      "an expired google_vertex consent",
      {
        ...consent("a1", "ai_interpretation", "google_vertex", "health-ai-terms-v2"),
        expiryTime: "2026-09-01T00:00:00.000Z",
      },
    ],
  ])("refuses ai_consent_required with %s, before any byte leaves", async (_name, aiConsent) => {
    const store = new FakeStore(alice(aiConsent), ALICE);
    const fake = new FakeVertexProvider(() => vertexReply(GOOD));
    const r = await runHealthAi(deps(store, fake), config(), actor, { task: "summarize_timeline" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("ai_consent_required");
    expect(r.detail).toMatchObject({ recipient: "google_vertex" });
    expect(fake.sent).toHaveLength(0);
    expect(store.receipts).toHaveLength(0);
  });

  it("a provider failure completes the receipt as an error and audits the closed code — never Google's sentence", async () => {
    const store = new FakeStore(alice(), ALICE);
    const fake = new FakeVertexProvider(() =>
      vertexError(
        403,
        "PERMISSION_DENIED",
        "Permission 'aiplatform.endpoints.predict' denied on resource projects/oniq-309bd/…",
      ),
    );
    const r = await runHealthAi(deps(store, fake), config(), actor, { task: "summarize_timeline" });
    expect(r).toMatchObject({
      ok: false,
      reason: "provider_error",
      detail: { code: "vertex_http_403_permission_denied" },
    });
    expect(store.receipts[0].patches.at(-1)).toMatchObject({
      status: "error",
      refusal_reason: "provider_error",
    });
    const refused = store.audits.find((a) => a.action === "ai.refused");
    expect(refused?.detail).toMatchObject({
      reason: "provider_error",
      code: "vertex_http_403_permission_denied",
    });
    expect(JSON.stringify([r, store.audits, store.receipts])).not.toMatch(
      /endpoints\.predict|oniq-309bd/,
    );
  });

  it("a non-compliant reply is answered as 'no answer', receipted ok, and costs what it cost", async () => {
    const store = new FakeStore(alice(), ALICE);
    const fake = new FakeVertexProvider(() =>
      vertexReply({
        segments: [
          {
            class: "record_fact",
            text: "Take 500 mg metformin daily; HbA1c 14 Mar 2026 was 6.1 %.",
            sourceRefs: ["r1"],
          },
        ],
        refusals: [],
      }),
    );
    const r = await runHealthAi(deps(store, fake), config(), actor, {
      task: "answer_question",
      question: "what should I take",
    });
    expect(r.ok).toBe(true);
    if (!r.ok || r.result.kind !== "response") return;
    expect(r.result.response.segments).toEqual([
      {
        class: "unknown",
        text: "The records do not carry an answer to that question.",
        sourceRecordIds: [],
      },
    ]);
    expect(r.result.response.refusals).toEqual(["insufficient_context"]);
    expect(store.receipts[0].patches.at(-1)).toMatchObject({ status: "ok", input_tokens: 120 });
  });

  it("the synthetic provider is still refused to an ordinary user in production, and vertex is not gated by admin verification", async () => {
    const store = new FakeStore(
      alice(consent("a1", "ai_interpretation", "oniq", "health-ai-terms-v1")),
      ALICE,
    );
    const fake = new FakeVertexProvider(() => vertexReply(GOOD));
    const synthetic = await runHealthAi(
      deps(store, fake),
      config({ provider: "synthetic", model: "synthetic-v1" }),
      actor,
      { task: "summarize_timeline" },
    );
    expect(synthetic).toMatchObject({ ok: false, reason: "synthetic_in_production" });
    expect(fake.sent).toHaveLength(0);
  });

  it("extraction still answers no_text in production: no text source is registered, so no document byte reaches Vertex", async () => {
    const users = alice();
    users.get(ALICE)!.documents = [
      {
        id: u(100),
        kind: "lab_report",
        title: "CBC",
        mime: "application/pdf",
        size_bytes: 10,
        captured_at: NOW,
        created_at: NOW,
      },
    ];
    const store = new FakeStore(users, ALICE);
    const fake = new FakeVertexProvider(() => vertexReply({ candidates: [] }));
    const r = await runHealthAi(deps(store, fake), config(), actor, {
      task: "extract_document",
      documentId: u(100),
    });
    expect(r).toMatchObject({ ok: false, reason: "no_text" });
    expect(fake.sent).toHaveLength(0);
    // With a text source injected (tests only), the document text does reach the provider — under consent.
    const withText = await runHealthAi(
      deps(new FakeStore(users, ALICE), fake, {
        textSource: new InlineTextSource({ [u(100)]: "HbA1c 6.1 % 2026-03-14" }),
      }),
      config(),
      actor,
      { task: "extract_document", documentId: u(100) },
    );
    expect(withText.ok).toBe(true);
    expect(fake.sent).toHaveLength(1);
    const sent: Sent = fake.sent[0];
    expect(JSON.stringify(sent.body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
  });
});
