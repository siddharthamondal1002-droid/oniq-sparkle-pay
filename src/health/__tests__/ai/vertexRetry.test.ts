/**
 * RETRIES ARE CLASSIFIED — Phase 4 (owner directive 2026-09-09, §4: "bounded
 * retries classified as safe/unsafe"; "never blindly retry an operation that
 * could create duplicate billable work").
 *
 * SAFE: Vertex answered 429 or 503 — it did not serve the request, nothing
 * was generated, nothing was billed. Retried ONCE after one pause.
 * UNSAFE: a timeout, a network failure, any other status. The first attempt
 * may have been served and billed; it is reported as its closed code and
 * never repeated. Every attempt goes through the same transport, so the
 * fake sees each one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ProviderError,
  VERTEX_MAX_ATTEMPTS,
  VERTEX_MAX_RESPONSE_BYTES,
  VERTEX_RETRYABLE_STATUSES,
  VERTEX_RETRY_PAUSE_MS,
  VERTEX_TIMEOUT_MS,
  VERTEX_TRANSCRIPTION_TIMEOUT_MS,
  type VertexHttpResult,
} from "../../../../supabase/functions/_shared/health/ai/vertex";
import { TOKEN_TIMEOUT_MS } from "../../../../supabase/functions/_shared/googleAuth";
import { stripComments } from "@/test/sourceText";
import type { ProviderInput } from "../../ai/types";
import { FakeVertexProvider, vertexError, vertexReply, vertexText, type Sent } from "./fakeVertex";

const ROOT = join(__dirname, "..", "..", "..", "..");
const MODEL = "gemini-3.1-flash-lite";

function input(): ProviderInput {
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
      ],
      documents: [],
      question: "What was my last HbA1c?",
    },
    counts: { records: 1, documents: 0 },
  };
}

const GOOD = {
  segments: [
    {
      class: "record_fact",
      text: "HbA1c on 14 Mar 2026 was recorded as 6.1 %.",
      sourceRefs: ["r1"],
    },
  ],
  refusals: [],
};

/** Answers from a script, one reply per attempt; a function entry throws as the transport would. */
function scripted(replies: Array<VertexHttpResult | (() => never)>) {
  let i = 0;
  return new FakeVertexProvider(() => {
    const next = replies[Math.min(i++, replies.length - 1)];
    return typeof next === "function" ? next() : next;
  });
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe("the classes", () => {
  it("names exactly 429 and 503 as safe, and at most two attempts", () => {
    expect([...VERTEX_RETRYABLE_STATUSES]).toEqual([429, 503]);
    expect(VERTEX_MAX_ATTEMPTS).toBe(2);
    expect(VERTEX_RETRY_PAUSE_MS).toBeGreaterThan(0);
    expect(VERTEX_RETRY_PAUSE_MS).toBeLessThan(VERTEX_TIMEOUT_MS);
  });
});

describe("safe: a request Vertex did not serve is retried once", () => {
  it("429 then 200: two sends, one pause, one answer, and the usage of the served attempt only", async () => {
    const fake = scripted([
      vertexError(429, "RESOURCE_EXHAUSTED", "Quota exceeded"),
      vertexReply(GOOD, { promptTokenCount: 100, candidatesTokenCount: 20 }),
    ]);
    const out = await fake.run(input());
    expect(fake.sent).toHaveLength(2);
    expect(fake.pauses).toEqual([VERTEX_RETRY_PAUSE_MS]);
    expect(out.kind).toBe("response");
    if (out.kind === "response") {
      expect(out.response.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
      expect(out.response.segments[0].text).toContain("6.1");
    }
    // The retry is the SAME request: same URL, same body, same headers.
    expect(fake.sent[1]).toEqual(fake.sent[0]);
  });

  it("503 then 503: exactly two sends, then the closed code — never a third", async () => {
    const fake = scripted([
      vertexError(503, "UNAVAILABLE", "The service is currently unavailable"),
    ]);
    await expect(fake.run(input())).rejects.toMatchObject({ code: "vertex_http_503_unavailable" });
    expect(fake.sent).toHaveLength(2);
    expect(fake.pauses).toHaveLength(1);
  });

  it("the transcription path follows the same rule with its own timeout", async () => {
    const fake = scripted([
      vertexError(503, "UNAVAILABLE", "try again"),
      vertexText("Haemoglobin 13.2 g/dL"),
    ]);
    const out = await fake.transcribe({
      model: MODEL,
      mime: "image/png",
      bytes: PNG,
      language: "en",
      maxChars: 1000,
    });
    expect(out.text).toContain("13.2");
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent.every((s: Sent) => s.timeoutMs === VERTEX_TRANSCRIPTION_TIMEOUT_MS)).toBe(
      true,
    );
  });
});

describe("unsafe: anything that may have been served is never repeated", () => {
  it("a timeout: one send, vertex_timeout, no pause", async () => {
    const fake = scripted([
      () => {
        throw new ProviderError("vertex_timeout", "unreachable");
      },
    ]);
    await expect(fake.run(input())).rejects.toMatchObject({ code: "vertex_timeout" });
    expect(fake.sent).toHaveLength(1);
    expect(fake.pauses).toEqual([]);
  });

  it("a network failure: one send, vertex_network", async () => {
    const fake = scripted([
      () => {
        throw new ProviderError("vertex_network", "unreachable");
      },
    ]);
    await expect(fake.run(input())).rejects.toMatchObject({ code: "vertex_network" });
    expect(fake.sent).toHaveLength(1);
  });

  it("500, 502, 400, 401, 403 and 404: one send each, their own closed code", async () => {
    for (const [status, word] of [
      [500, "INTERNAL"],
      [502, "BAD_GATEWAY"],
      [400, "INVALID_ARGUMENT"],
      [401, "UNAUTHENTICATED"],
      [403, "PERMISSION_DENIED"],
      [404, "NOT_FOUND"],
    ] as const) {
      const fake = scripted([vertexError(status, word, "no")]);
      await expect(fake.run(input()), String(status)).rejects.toMatchObject({
        code: `vertex_http_${status}_${word.toLowerCase()}`,
      });
      expect(fake.sent, String(status)).toHaveLength(1);
      expect(fake.pauses, String(status)).toEqual([]);
    }
  });

  it("a served 200 whose body is not the shape asked for is a code, not a retry", async () => {
    const fake = scripted([{ status: 200, text: "<html>not json</html>" }]);
    await expect(fake.run(input())).rejects.toMatchObject({ code: "vertex_no_candidate" });
    expect(fake.sent).toHaveLength(1);
  });
});

describe("size: a reply past the ceiling is refused unread", () => {
  it("VERTEX_MAX_RESPONSE_BYTES + 1 characters of 200 body: vertex_response_too_large, and nothing is parsed", async () => {
    const huge = { status: 200, text: "x".repeat(VERTEX_MAX_RESPONSE_BYTES + 1) };
    const fake = scripted([huge]);
    await expect(fake.run(input())).rejects.toMatchObject({ code: "vertex_response_too_large" });
    expect(fake.sent).toHaveLength(1);
  });

  it("the real transport checks the declared length before reading, and lets a ProviderError through untouched", () => {
    const src = stripComments(
      readFileSync(join(ROOT, "supabase/functions/_shared/health/ai/vertex.ts"), "utf8"),
    );
    const send = src.slice(src.indexOf("protected async send("));
    expect(send).toContain('res.headers.get("content-length")');
    expect(send).toContain("declared > VERTEX_MAX_RESPONSE_BYTES");
    expect(send).toContain("if (isProviderError(e)) throw e;");
  });
});

describe("the token endpoint has a timeout of its own", () => {
  it("googleAuth.ts aborts the exchange after TOKEN_TIMEOUT_MS and reports it as a reason, not a throw", () => {
    const src = stripComments(
      readFileSync(join(ROOT, "supabase/functions/_shared/googleAuth.ts"), "utf8"),
    );
    expect(TOKEN_TIMEOUT_MS).toBeGreaterThan(0);
    expect(TOKEN_TIMEOUT_MS).toBeLessThan(VERTEX_TIMEOUT_MS);
    const exchange = src.slice(src.indexOf("res = await fetch(TOKEN_URL"));
    expect(src.slice(0, src.indexOf("res = await fetch(TOKEN_URL"))).toContain(
      "setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS)",
    );
    expect(exchange).toContain("signal: controller.signal");
    expect(exchange).toContain("did not answer in time");
    expect(exchange).toContain("clearTimeout(timer)");
  });
});
