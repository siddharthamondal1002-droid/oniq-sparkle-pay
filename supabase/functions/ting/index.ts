// Ting edge function — Gemini primary, Anthropic (Claude) fallback + web search
import { langInstruction, callGemini, type ClaudeMessage } from "../_shared/llm.ts";
import type { SearchBudget } from "../_shared/searchBudget.ts";
import {
  attachmentTokenCeiling,
  refusalMessage,
  requestIdFrom,
  serviceRoleRpc,
  withSearchSpendGuard,
} from "../_shared/searchGuard.ts";

// --- spend shape of ONE Ting turn -------------------------------------------
//
// TING HAD NO SEARCH CEILING AT ALL. `tools: [{ type: "web_search_20250305",
// name: "web_search" }]` with no `max_uses` lets one chat turn run as many
// billed searches as the model wants, on claude-opus-5. That is not a ceiling
// anyone chose; it is the absence of one, and it cannot be reserved for.
// TING_MAX_SEARCHES exists so the reservation can describe the call.
// HAIKU 4.5 — owner directive, 2026-08-25 ("change all to haiku").
// On opus-5 at 5 hops this projected to ~$0.506 against the $0.50 ceiling:
// marginal, and marginal in the direction that breaches.
const TING_MODEL = "claude-haiku-4-5";
const TING_MAX_SEARCHES = 5;
const TING_MAX_TOKENS = 1024;
// 30 messages x 4,000 chars is the validated ceiling above; ~3 chars/token is a
// deliberately pessimistic conversion so the bound stays above the real count.
const TING_HISTORY_TOKEN_RESERVE = (30 * 4000) / 3;
// Per-hop search-result context. The old 3,600 was a guess and it was low by
// almost 4x: smart-scout's 51-request battery measured ~13,220 input tokens per
// hop, because every hop feeds its results back into the conversation. 14,000
// is that measurement rounded up.
const TING_TOKENS_PER_SEARCH = 14_000;
// Reserved above max_tokens — a searching turn's control tokens are billed as
// output too, and smart-scout's control proved reserving at max_tokens
// under-counts.
const TING_OUTPUT_TOKEN_RESERVE = 2_500;

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
    maxEstimatedUsd: 0.5,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM =
  "You are Ting 🔮, ONIQ's built-in assistant. Be concise, warm, and helpful. " +
  "ONIQ is a super app (chat, payments, food, rides, clips, learn) built in Kolkata. " +
  "Answer in the user's language. When you used web search, mention your sources briefly.";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authFail = await requireAuth(req);
    if (authFail) return authFail;
    if (!_rateLimit(_subFromAuth(req), 10)) return json({ error: "slow down bestie 😅" }, 429);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ configured: false }, 200);

    const body = await req.json().catch(() => ({}));
    const messages = Array.isArray(body?.messages) ? body.messages : null;
    const search = body?.search !== false; // default on
    const lang = typeof body?.lang === "string" ? body.lang : "";
    const attachment = body?.attachment as
      { kind: "image" | "pdf" | "text"; mime?: string; data?: string; text?: string } | undefined;

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

    // Attach file to the last user message if present.
    const outMessages: Array<{ role: string; content: unknown }> = messages.map((m: any) => ({
      role: m.role,
      content: m.content,
    }));
    if (attachment && outMessages.length > 0) {
      const last = outMessages[outMessages.length - 1];
      if (last.role === "user") {
        if (attachment.kind === "text" && typeof attachment.text === "string") {
          const txt = attachment.text.slice(0, 20000);
          last.content = `Attached text file:\n\n${txt}\n\n---\n\n${last.content || ""}`.trim();
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

    const systemPrompt = SYSTEM + langInstruction(lang);

    // --- Claude Opus 5 is Ting's primary engine. Gemini remains a
    // text-only fallback when the Anthropic call fails (attachments need
    // Anthropic's vision/document schema, and Gemini has no web_search
    // wired up here — fallback answers just lose live sources). ---
    const hasAttachment = outMessages.some((m) => typeof m.content !== "string");
    let data: any = null;
    let servedBy: "gemini" | "anthropic" = "anthropic";

    {
      const payload: Record<string, unknown> = {
        model: TING_MODEL,
        max_tokens: TING_MAX_TOKENS,
        system: systemPrompt,
        messages: outMessages,
      };
      if (search) {
        payload.tools = [
          { type: "web_search_20250305", name: "web_search", max_uses: TING_MAX_SEARCHES },
        ];
      }

      const attachmentTokens = attachment
        ? attachmentTokenCeiling(
            attachment.kind,
            attachment.kind === "text" ? attachment.text : attachment.data,
          )
        : 0;
      const uid = _subFromAuth(req);
      const rpc = serviceRoleRpc();

      // ---- SPEND GUARD ----------------------------------------------------
      const guarded = await withSearchSpendGuard(
        rpc,
        {
          requestId: requestIdFrom(body?.requestId),
          provider: "anthropic",
          model: TING_MODEL,
          searchType: search ? "ting-search" : "ting-chat",
          userId: UUID_RE.test(uid) ? uid : undefined,
          budget: tingBudget(search, attachmentTokens),
        },
        async () => {
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": key,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(payload),
          });
          const text = await r.text().catch(() => "");
          let parsedBody: any = null;
          try {
            parsedBody = text ? JSON.parse(text) : null;
          } catch {
            /* keep null */
          }
          return {
            value: { status: r.status, ok: r.ok, body: parsedBody, text },
            usage: r.ok ? parsedBody?.usage : null,
            stopReason: r.ok ? parsedBody?.stop_reason : null,
            terminationReason: r.ok ? undefined : ("PROVIDER_ERROR" as const),
          };
        },
      );

      if (!guarded.admitted) {
        console.warn(`Ting: spend guard refused (${guarded.reason})`);
        return json({ error: refusalMessage(guarded.reason), blocked: guarded.reason }, 200);
      }
      const res = guarded.value;

      if (res.status === 401) return json({ configured: false }, 200);
      if (res.ok) {
        data = res.body;
        console.info("Ting answered via Claude Opus 5 (primary)");
      } else {
        console.error("anthropic error", res.status, res.text.slice(0, 200));
        if (!hasAttachment) {
          const geminiMsgs: ClaudeMessage[] = outMessages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: typeof m.content === "string" ? m.content : "",
          }));
          // The fallback is a SECOND billable call, on a different key, and it
          // needs its own reservation. gemini-3.6-flash has no verified rate in
          // MODEL_RATES, so this refuses with "unpriced-model" and Ting returns
          // the primary failure instead. That is deliberate: an unpriced
          // provider resolving to free is the bug the ledger exists to stop.
          // Adding a verified Google rate to MODEL_RATES re-enables it.
          const fb = await withSearchSpendGuard(
            rpc,
            {
              requestId: requestIdFrom(null),
              provider: "google",
              model: "gemini-3.6-flash",
              searchType: "ting-fallback",
              userId: UUID_RE.test(uid) ? uid : undefined,
              budget: tingBudget(false, attachmentTokens),
            },
            async () => {
              const g = await callGemini({
                system: systemPrompt,
                messages: geminiMsgs,
                maxTokens: TING_MAX_TOKENS,
              });
              return {
                value: g,
                neverCalled: !g.ok && g.reason === "gemini not configured",
                usage: g.ok ? g.data?.usage : null,
                terminationReason: g.ok ? undefined : ("PROVIDER_ERROR" as const),
              };
            },
          );
          if (!fb.admitted) {
            console.warn(`Ting: Gemini fallback not admitted (${fb.reason})`);
          } else if (fb.value.ok) {
            console.info("Ting answered via Gemini (fallback)");
            data = fb.value.data;
            servedBy = "gemini";
          } else {
            console.warn(`Ting: Gemini fallback also failed (${fb.value.reason})`);
          }
        }
        if (!data) {
          if (res.status === 429)
            return json({ error: "Ting is a bit busy — try again in a moment 🐢" }, 429);
          return json({ error: "Ting glitched — try again" }, 502);
        }
      }
      void servedBy;
    }

    const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
    let reply = "";
    const sources: string[] = [];
    const seen = new Set<string>();
    const collectUrl = (u: unknown) => {
      if (typeof u === "string" && /^https?:\/\//i.test(u) && !seen.has(u)) {
        seen.add(u);
        sources.push(u);
      }
    };
    for (const b of blocks) {
      if (b?.type === "text" && typeof b.text === "string") {
        reply += (reply ? "\n\n" : "") + b.text;
        const cites = Array.isArray(b?.citations) ? b.citations : [];
        for (const c of cites) collectUrl(c?.url);
      } else if (b?.type === "web_search_tool_result") {
        const results = Array.isArray(b?.content) ? b.content : [];
        for (const r of results) collectUrl(r?.url);
      }
    }

    return json({ reply: reply.trim(), sources });
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
