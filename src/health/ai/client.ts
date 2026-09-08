/**
 * ONIQ HEALTH AI — the one client that talks to `health-ai`.
 *
 * The body it sends is exactly the CLOSED shape the function accepts —
 * task, and at most a record id, a document id, a question and a language.
 * There is no text field and there never will be one from here: a document's
 * text reaches the gateway only through a server-side text source, of which
 * Phase 2 registers none. `aiIsolation.test.ts` reads this file and pins
 * that the only function it can invoke is "health-ai".
 *
 * It refuses locally while the client flag is off, so no request leaves a
 * build whose AI sections are dark.
 */
import { supabase } from "@/integrations/supabase/client";
import { HEALTH_AI_ENABLED } from "../flags";
import { safeMessage } from "../redact";
import type { HealthErr, HealthOk } from "../api";
import {
  AI_LANGUAGES,
  type AiLanguage,
  type AiTask,
  type ClassificationResult,
  type ClientAiResponse,
} from "./types";

export type AiRequestPayload = {
  recordId?: string;
  documentId?: string;
  question?: string;
  language?: AiLanguage;
};

export type AiResult =
  | { kind: "response"; response: ClientAiResponse }
  | { kind: "classification"; classification: ClassificationResult }
  | { kind: "extraction"; candidates: number; method: string; textChars: number };

export type AiOk = HealthOk<AiResult> & { receiptId: string | null };
export type AiErr = HealthErr & { code?: string; recipient?: string };

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

async function bodyOf(error: unknown): Promise<Record<string, unknown>> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      const body = await (ctx as Response).json();
      if (body && typeof body === "object") return body as Record<string, unknown>;
    } catch {
      /* unparseable body: the generic reason below */
    }
  }
  return {};
}

function err(body: Record<string, unknown>): AiErr {
  const reason = str(body.reason) ?? "failed";
  return {
    ok: false,
    reason,
    message: safeMessage(reason),
    purpose: str(body.purpose),
    category: str(body.category),
    recipient: str(body.recipient),
    code: str(body.code),
    requestId: str(body.requestId) ?? null,
  };
}

export function languageFor(lang: string): AiLanguage {
  return (AI_LANGUAGES as readonly string[]).includes(lang) ? (lang as AiLanguage) : "en";
}

export async function healthAi(
  task: AiTask,
  payload: AiRequestPayload = {},
): Promise<AiOk | AiErr> {
  if (!HEALTH_AI_ENABLED) {
    return {
      ok: false,
      reason: "ai_disabled",
      message: safeMessage("ai_disabled"),
      requestId: null,
    };
  }
  const body: Record<string, unknown> = { task };
  if (payload.recordId) body.recordId = payload.recordId;
  if (payload.documentId) body.documentId = payload.documentId;
  if (payload.question) body.question = payload.question;
  if (payload.language) body.language = payload.language;
  const { data, error } = await supabase.functions.invoke("health-ai", { body });
  if (error) return err(await bodyOf(error));
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.ok !== true) return err(d);
  return {
    ok: true,
    data: d.data as AiResult,
    receiptId: str(d.receiptId) ?? null,
    requestId: str(d.requestId) ?? null,
  };
}
