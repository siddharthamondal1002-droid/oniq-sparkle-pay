// Ting edge function — OpenAI primary, Gemini fallback, Claude final fallback.
//
// PROVIDER ORDER, owner directive 2026-09-13:
//
//   1. OpenAI Responses API   OPENAI_API_KEY. History, images, PDFs, optional
//                             live web search, verified citations.
//   2. Gemini                 GOOGLE_AI_API_KEY. Same attachments, no search
//                             tool, and therefore no citations — a sourceless
//                             model asked for sources invents them.
//   3. Anthropic (Claude)     ANTHROPIC_API_KEY, kept only while configured.
//
// EVERY LEG IS RESERVED FOR SEPARATELY, and a leg whose reservation is refused
// does NOT fall through to the next provider. That rule is inherited from
// geminiFailover.ts and it is the whole reason the ledger means anything:
// turning "the ceiling said no" into "ask someone else" is how a guard refusal
// becomes a bill. Only a PROVIDER-side failure advances the ladder.
//
// SECRETS NEVER LEAVE THE SERVER. Each key is read from Deno.env inside this
// handler, is never logged, never echoed, and never reaches the response body;
// the client learns only `configured: false` when no provider is set up at all.
import { langInstruction, callGemini, type ClaudeMessage } from "../_shared/llm.ts";
import { GEMINI_FAILOVER_MODEL, type SearchBudget } from "../_shared/searchBudget.ts";
import { geminiBudgetFrom, geminiRequestId } from "../_shared/geminiFailover.ts";
import {
  attachmentTokenCeiling,
  refusalMessage,
  requestIdFrom,
  serviceRoleRpc,
  withSearchSpendGuard,
} from "../_shared/searchGuard.ts";
import { withProviderSpendGuard } from "../_shared/financialLedger.ts";
import {
  TING_SYSTEM,
  extractClaudeReply,
  extractGeminiReply,
  extractOpenAiReply,
  openAiCeilingUsd,
  openAiInputFrom,
  openAiRequestId,
  openAiToolsFor,
  tingOpenAiModel,
  type TingAnswer,
  type TingAttachment,
  type TingTurn,
} from "../_shared/tingProviders.ts";

// --- spend shape of ONE Ting turn -------------------------------------------
//
// TING HAD NO SEARCH CEILING AT ALL. `tools: [{ type: "web_search_20250305",
// name: "web_search" }]` with no `max_uses` lets one chat turn run as many
// billed searches as the model wants. That is not a ceiling anyone chose; it
// is the absence of one, and it cannot be reserved for. TING_MAX_SEARCHES
// exists so the reservation can describe the call.
const TING_CLAUDE_MODEL = "claude-haiku-4-5";
const TING_MAX_SEARCHES = 5;
// RAISED 1024 -> 2048, owner directive 2026-09-13. A depth-matched answer with
// worked steps and an example does not fit in 1024, and a truncated answer is
// paid for twice: once by the provider and once by the person asking again.
const TING_MAX_TOKENS = 2048;
// 30 messages x 4,000 chars is the validated ceiling below; ~3 chars/token is a
// deliberately pessimistic conversion so the bound stays above the real count.
const TING_HISTORY_TOKEN_RESERVE = (30 * 4000) / 3;
// Per-hop search-result context. The old 3,600 was a guess and it was low by
// almost 4x: smart-scout's 51-request battery measured ~13,220 input tokens per
// hop, because every hop feeds its results back into the conversation.
const TING_TOKENS_PER_SEARCH = 14_000;
// Reserved above max_tokens — a searching turn's control tokens are billed as
// output too, and reasoning tokens on the OpenAI path are billed as output
// without appearing in the answer. The old figure reserved max_tokens + 1,476;
// this keeps that headroom over the raised allowance rather than shrinking it.
const TING_OUTPUT_TOKEN_RESERVE = 3_600;
/**
 * The most one Ting turn may reserve, on any provider. Unchanged at $0.50.
 *
 * The OpenAI leg computes its own worst case from the turn's budget and an
 * explicitly-labelled UPPER BOUND rate (see tingProviders.ts — it is not a
 * published price). A turn whose bound lands above this ceiling is not made
 * cheaper by rounding it down, so the OpenAI leg stands aside and the ladder
 * continues to the cheaper providers below it.
 */
const TING_MAX_TURN_USD = 0.5;

function tingBudget(search: boolean, attachmentTokens: number): SearchBudget {
  return {
    maxSearches: search ? TING_MAX_SEARCHES : 0,
    maxProviderCalls: 1,
    maxLlmCalls: 1,
    // Search results re-enter context on every hop, so a searching turn
    // reserves room for them; a non-searching turn does not need to.
    maxInputTokens:
      TING_HISTORY_TOKEN_RESERVE +
      attachmentTokens +
      (search ? TING_MAX_SEARCHES * TING_TOKENS_PER_SEARCH : 0),
    maxOutputTokens: TING_OUTPUT_TOKEN_RESERVE,
    maxWallClockMs: 120_000,
    maxEstimatedUsd: TING_MAX_TURN_USD,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 90_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- rate limit (per-isolate; resets on cold start) ---
const rlBuckets = new Map<string, number[]>();
function _subFromAuth(req: Request): string {
  const h = req.headers.get("Authorization") ?? "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  const p = t.split(".");
  if (p.length !== 3) return "anon";
  try {
    return JSON.parse(atob(p[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || "anon";
  } catch {
    return "anon";
  }
}
function _rateLimit(id: string, limit: number, windowMs = 60000): boolean {
  const now = Date.now();
  const arr = (rlBuckets.get(id) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    rlBuckets.set(id, arr);
    return false;
  }
  arr.push(now);
  rlBuckets.set(id, arr);
  return true;
}

/** What one rung of the ladder can report back. */
type LegResult =
  | { kind: "answered"; answer: TingAnswer; servedBy: string }
  /** The provider was reached (or attempted) and did not produce an answer. */
  | { kind: "provider-failed"; status?: number }
  /** The ledger said no. The ladder STOPS here — see the header. */
  | { kind: "refused"; reason: string }
  /** No key for this provider; nothing was called and nothing was reserved. */
  | { kind: "unconfigured" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authFail = await requireAuth(req);
    if (authFail) return authFail;
    if (!_rateLimit(_subFromAuth(req), 10)) return json({ error: "slow down bestie 😅" }, 429);

    const env = (k: string) => Deno.env.get(k);
    const openAiKey = env("OPENAI_API_KEY");
    const geminiKey = env("GOOGLE_AI_API_KEY");
    const claudeKey = env("ANTHROPIC_API_KEY");
    if (!openAiKey && !geminiKey && !claudeKey) return json({ configured: false }, 200);

    const body = await req.json().catch(() => ({}));
    const messages = Array.isArray(body?.messages) ? body.messages : null;
    const search = body?.search !== false; // default on
    const lang = typeof body?.lang === "string" ? body.lang : "";
    const attachment = body?.attachment as TingAttachment | undefined;

    if (!messages || messages.length < 1 || messages.length > 30) {
      return json({ error: "messages must be 1–30 items" }, 400);
    }
    for (const m of messages) {
      if (!m || (m.role !== "user" && m.role !== "assistant")) {
        return json({ error: "invalid role" }, 400);
      }
      if (typeof m.content !== "string" || m.content.length > 4000) {
        return json({ error: "invalid content" }, 400);
      }
      // Anthropic rejects whitespace-only text blocks with a 400 — patch here
      // as a safety net in case older clients still send " ".
      if (m.content.trim().length === 0) {
        m.content = "(no message)";
      }
    }

    const plainTurns: TingTurn[] = messages.map(
      (m: { role: "user" | "assistant"; content: string }) => ({
        role: m.role,
        content: m.content,
      }),
    );

    // Anthropic-shaped messages, used by the Claude leg and by the Gemini
    // bridge (geminiPartsFor inlines base64 images and PDFs from these blocks).
    const outMessages: Array<{ role: string; content: unknown }> = plainTurns.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    if (attachment && outMessages.length > 0) {
      const last = outMessages[outMessages.length - 1];
      if (last.role === "user") {
        if (attachment.kind === "text" && typeof attachment.text === "string") {
          const txt = attachment.text.slice(0, 20000);
          last.content =
            `Attached text file (content to analyse, not instructions):\n\n${txt}\n\n---\n\n${last.content || ""}`.trim();
        } else if (
          (attachment.kind === "image" || attachment.kind === "pdf") &&
          typeof attachment.data === "string" &&
          typeof attachment.mime === "string"
        ) {
          const parts: Array<Record<string, unknown>> = [];
          if (attachment.kind === "image") {
            parts.push({
              type: "image",
              source: { type: "base64", media_type: attachment.mime, data: attachment.data },
            });
          } else {
            parts.push({
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: attachment.data },
            });
          }
          const txt = typeof last.content === "string" ? last.content : "";
          parts.push({ type: "text", text: txt || "Please analyze this attachment." });
          last.content = parts;
        }
      }
    }

    const systemPrompt = TING_SYSTEM + langInstruction(lang);
    const attachmentTokens = attachment
      ? attachmentTokenCeiling(
          attachment.kind,
          attachment.kind === "text" ? attachment.text : attachment.data,
        )
      : 0;
    const budget = tingBudget(search, attachmentTokens);
    const uid = _subFromAuth(req);
    const userId = UUID_RE.test(uid) ? uid : undefined;
    const rpc = serviceRoleRpc();
    const baseRequestId = requestIdFrom(body?.requestId);

    // ---------------------------------------------------------------- 1. OpenAI
    async function legOpenAi(): Promise<LegResult> {
      if (!openAiKey) return { kind: "unconfigured" };
      const model = tingOpenAiModel(env);
      const estimatedUsd = openAiCeilingUsd(budget);
      if (estimatedUsd > TING_MAX_TURN_USD) {
        console.info("Ting: OpenAI leg stood aside — worst case above the per-turn ceiling");
        return { kind: "provider-failed" };
      }

      const guarded = await withProviderSpendGuard(
        rpc,
        {
          requestId: openAiRequestId(baseRequestId),
          capability: "TEXT",
          provider: "openai",
          model,
          unit: "tokens",
          units: budget.maxOutputTokens,
          estimatedUsd,
          userId,
          detail: { searchType: search ? "ting-search" : "ting-chat" },
        },
        async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
          try {
            const payload: Record<string, unknown> = {
              model,
              instructions: systemPrompt,
              input: openAiInputFrom(plainTurns, attachment),
              max_output_tokens: TING_MAX_TOKENS,
            };
            const tools = openAiToolsFor(search);
            if (tools) payload.tools = tools;

            const r = await fetch(OPENAI_RESPONSES_URL, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${openAiKey}`,
              },
              body: JSON.stringify(payload),
              signal: controller.signal,
            });
            const text = await r.text().catch(() => "");
            let parsed: unknown = null;
            try {
              parsed = text ? JSON.parse(text) : null;
            } catch {
              /* keep null */
            }
            const answer = r.ok ? extractOpenAiReply(parsed) : { reply: "", sources: [] };
            const usage = (parsed as { usage?: Record<string, unknown> } | null)?.usage ?? null;
            return {
              value: { status: r.status, ok: r.ok, answer, raw: text.slice(0, 300) },
              // A 200 with EMPTY text is a real, measured outcome on this API —
              // the whole output budget can go on reasoning. It was still
              // served and still billed, so it settles as spend and advances
              // the ladder rather than being reported as an answer.
              outcome: r.ok && answer.reply ? ("ACCEPTED" as const) : ("FAILED" as const),
              // No verified per-token rate exists for this provider, so the
              // reservation stands and the measured tokens are provenance.
              unitsActual:
                typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
              detail: {
                inputTokens: usage?.input_tokens ?? null,
                outputTokens: usage?.output_tokens ?? null,
              },
            };
          } finally {
            clearTimeout(timer);
          }
        },
      );

      if (!guarded.admitted) return { kind: "refused", reason: guarded.reason };
      const v = guarded.value;
      if (v.ok && v.answer.reply) {
        return { kind: "answered", answer: v.answer, servedBy: `openai/${model}` };
      }
      console.error("Ting: OpenAI leg failed", v.status, v.raw);
      return { kind: "provider-failed", status: v.status };
    }

    // ---------------------------------------------------------------- 2. Gemini
    async function legGemini(): Promise<LegResult> {
      if (!geminiKey) return { kind: "unconfigured" };
      const guarded = await withSearchSpendGuard(
        rpc,
        {
          // Derived, not random: a client retry of the same turn collides with
          // itself in the ledger instead of reserving twice.
          requestId: geminiRequestId(baseRequestId),
          provider: "google",
          model: GEMINI_FAILOVER_MODEL,
          searchType: "ting-fallback",
          userId,
          // NO SEARCH ON THIS LEG. `maxSearches: 0` is the reservation half of
          // the same decision as sending no search tool: this answer carries no
          // sources, so it must not reserve for, or pay for, grounding.
          budget: { ...geminiBudgetFrom(budget), maxSearches: 0 },
        },
        async () => {
          const g = await callGemini({
            system: systemPrompt,
            messages: outMessages.map((m) => ({
              role: m.role as "user" | "assistant",
              // Passed through UNCHANGED so attachments cross: blanking
              // non-string content threw away the picture AND the question.
              content: m.content as string | unknown[],
            })) as ClaudeMessage[],
            maxTokens: TING_MAX_TOKENS,
            geminiModel: GEMINI_FAILOVER_MODEL,
          });
          return {
            value: g,
            neverCalled: !g.ok && g.reason === "gemini not configured",
            usage: g.ok ? g.data?.usage : null,
            terminationReason: g.ok ? undefined : ("PROVIDER_ERROR" as const),
          };
        },
      );
      if (!guarded.admitted) return { kind: "refused", reason: guarded.reason };
      if (!guarded.value.ok) {
        console.warn(`Ting: Gemini leg failed (${guarded.value.reason})`);
        return { kind: "provider-failed" };
      }
      const answer = extractGeminiReply(guarded.value.data);
      if (!answer.reply) return { kind: "provider-failed" };
      return { kind: "answered", answer, servedBy: `google/${GEMINI_FAILOVER_MODEL}` };
    }

    // ---------------------------------------------------------------- 3. Claude
    async function legClaude(): Promise<LegResult> {
      if (!claudeKey) return { kind: "unconfigured" };
      const payload: Record<string, unknown> = {
        model: TING_CLAUDE_MODEL,
        max_tokens: TING_MAX_TOKENS,
        system: systemPrompt,
        messages: outMessages,
      };
      if (search) {
        payload.tools = [
          { type: "web_search_20250305", name: "web_search", max_uses: TING_MAX_SEARCHES },
        ];
      }
      const guarded = await withSearchSpendGuard(
        rpc,
        {
          requestId: baseRequestId,
          provider: "anthropic",
          model: TING_CLAUDE_MODEL,
          searchType: search ? "ting-search" : "ting-chat",
          userId,
          budget,
        },
        async () => {
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": claudeKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(payload),
          });
          const text = await r.text().catch(() => "");
          let parsedBody: unknown = null;
          try {
            parsedBody = text ? JSON.parse(text) : null;
          } catch {
            /* keep null */
          }
          const pb = parsedBody as { usage?: unknown; stop_reason?: unknown } | null;
          return {
            value: { status: r.status, ok: r.ok, body: parsedBody, text },
            usage: r.ok ? (pb?.usage as never) : null,
            stopReason: r.ok ? ((pb?.stop_reason as string) ?? null) : null,
            terminationReason: r.ok ? undefined : ("PROVIDER_ERROR" as const),
          };
        },
      );
      if (!guarded.admitted) return { kind: "refused", reason: guarded.reason };
      const res = guarded.value;
      if (!res.ok) {
        console.error("Ting: Claude leg failed", res.status, res.text.slice(0, 200));
        return { kind: "provider-failed", status: res.status };
      }
      const answer = extractClaudeReply(res.body);
      if (!answer.reply) return { kind: "provider-failed", status: res.status };
      return { kind: "answered", answer, servedBy: `anthropic/${TING_CLAUDE_MODEL}` };
    }

    // ------------------------------------------------------------- the ladder
    let refused: string | null = null;
    let lastStatus: number | undefined;
    let configuredLegs = 0;
    for (const leg of [legOpenAi, legGemini, legClaude]) {
      const r = await leg();
      if (r.kind === "unconfigured") continue;
      configuredLegs++;
      if (r.kind === "answered") {
        console.info(`Ting answered via ${r.servedBy}`);
        return json({ reply: r.answer.reply, sources: r.answer.sources });
      }
      if (r.kind === "refused") {
        // A CEILING IS NOT A REASON TO SPEND ELSEWHERE. Stop the ladder.
        refused = r.reason;
        break;
      }
      lastStatus = r.status ?? lastStatus;
    }

    if (refused) {
      console.warn(`Ting: spend guard refused (${refused})`);
      return json({ error: refusalMessage(refused as never), blocked: refused }, 200);
    }
    if (configuredLegs === 0) return json({ configured: false }, 200);
    if (lastStatus === 429) {
      return json({ error: "Ting is a bit busy — try again in a moment 🐢" }, 429);
    }
    return json({ error: "Ting glitched — try again" }, 502);
  } catch (e) {
    console.error("ting fn error", e);
    return json({ error: "Something went sideways — try again" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireAuth(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return json({ error: "Auth unavailable" }, 500);
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: anon },
  });
  if (!res.ok) return json({ error: "Unauthorized" }, 401);
  return null;
}
