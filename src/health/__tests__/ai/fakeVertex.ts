/**
 * A TEST-ONLY subclass of the Vertex provider. The production class has no
 * constructor and no options (ai/isolation.test.ts reads that from source);
 * the two things a test must replace — the credential and the transport —
 * are protected methods, and this is the only file that overrides them. It
 * records every request so a test can read what would have crossed the
 * wire, and it answers whatever the test hands it: a compliant reply, a
 * hostile one, Google's own 403 array, an empty candidate, a timeout.
 */
import {
  VertexHealthAIProvider,
  type VertexHttpResult,
} from "../../../../supabase/functions/_shared/health/ai/vertex";
import type { TokenResult } from "../../../../supabase/functions/_shared/googleAuth";

export type Sent = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** The timeout the provider asked for (Phase 3b: a transcription asks for the longer one). */
  timeoutMs?: number;
};

export const FAKE_TOKEN: TokenResult = {
  ok: true,
  token: "ya29.test-token",
  mode: "service-account",
  projectId: "oniq-309bd",
};

export class FakeVertexProvider extends VertexHealthAIProvider {
  readonly sent: Sent[] = [];

  constructor(
    private readonly reply: (sent: Sent) => VertexHttpResult | Promise<VertexHttpResult>,
    private readonly tokenResult: TokenResult = FAKE_TOKEN,
  ) {
    super();
  }

  protected override token(): Promise<TokenResult> {
    return Promise.resolve(this.tokenResult);
  }

  protected override async send(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<VertexHttpResult> {
    const s = { url, headers, body, timeoutMs };
    this.sent.push(s);
    return await this.reply(s);
  }
}

/** A 200 for a TRANSCRIPTION: plain text in the first candidate, the way text/plain mode answers. */
export function vertexText(
  text: string,
  usage: Record<string, unknown> | null = { promptTokenCount: 300, candidatesTokenCount: 20 },
  finishReason = "STOP",
): VertexHttpResult {
  return {
    status: 200,
    text: JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason }],
      ...(usage ? { usageMetadata: usage } : {}),
      modelVersion: "gemini-3.1-flash-lite",
    }),
  };
}

/** Is this request the transcription (plain text asked for) rather than a JSON-mode answer? */
export function isTranscription(sent: Sent): boolean {
  const cfg = sent.body.generationConfig as { responseMimeType?: unknown } | undefined;
  return cfg?.responseMimeType === "text/plain";
}

/** A 200 the way Vertex sends one: the JSON answer inside the first candidate's text part. */
export function vertexReply(
  json: unknown,
  usage: Record<string, unknown> | null = { promptTokenCount: 120, candidatesTokenCount: 40 },
  extra: Record<string, unknown> = {},
): VertexHttpResult {
  return {
    status: 200,
    text: JSON.stringify({
      candidates: [
        {
          content: { role: "model", parts: [{ text: JSON.stringify(json) }] },
          finishReason: "STOP",
        },
      ],
      ...(usage ? { usageMetadata: usage } : {}),
      modelVersion: "gemini-3.1-flash-lite",
      ...extra,
    }),
  };
}

/** Google's error shape for aiplatform — the ARRAY wrapper measured on 2026-09-07. */
export function vertexError(code: number, status: string, message: string): VertexHttpResult {
  return { status: code, text: JSON.stringify([{ error: { code, status, message } }]) };
}
