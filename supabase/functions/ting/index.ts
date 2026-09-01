// Ting edge function — Gemini primary, Anthropic (Claude) fallback + web search
import { langInstruction, callGemini, type ClaudeMessage } from "../_shared/llm.ts";

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
  try { return JSON.parse(atob(p[1].replace(/-/g,"+").replace(/_/g,"/"))).sub || "anon"; } catch { return "anon"; }
}
function _rateLimit(id: string, limit: number, windowMs = 60000): boolean {
  const now = Date.now();
  const arr = (rlBuckets.get(id) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { rlBuckets.set(id, arr); return false; }
  arr.push(now); rlBuckets.set(id, arr); return true;
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
      | { kind: "image" | "pdf" | "text"; mime?: string; data?: string; text?: string }
      | undefined;

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
    const outMessages: Array<{ role: string; content: unknown }> = messages.map(
      (m: any) => ({ role: m.role, content: m.content }),
    );
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

    // --- Claude Opus 5 is Ting's primary engine. Gemini is the fallback when
    // the Anthropic call fails, and it is NO LONGER TEXT-ONLY: geminiPartsFor
    // in _shared/llm.ts inlines base64 images and PDFs as Gemini inlineData,
    // so an attachment survives the crossing. Fallback answers still lose live
    // web_search sources, which is a real degradation and a different one. ---
    const hasAttachment = outMessages.some((m) => typeof m.content !== "string");
    let data: any = null;
    let servedBy: "gemini" | "anthropic" = "anthropic";

    {
      const payload: Record<string, unknown> = {
        model: "claude-opus-5",
        max_tokens: 1024,
        system: systemPrompt,
        messages: outMessages,
      };
      if (search) {
        payload.tools = [{ type: "web_search_20250305", name: "web_search" }];
      }

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) return json({ configured: false }, 200);
      if (res.ok) {
        data = await res.json();
        console.info("Ting answered via Claude Opus 5 (primary)");
      } else {
        const t = await res.text().catch(() => "");
        console.error("anthropic error", res.status, t);
        // ATTACHMENTS FAIL OVER TOO NOW. This used to read
        // `if (!hasAttachment)`, so a Ting message carrying a photo or a PDF
        // had no second engine at all and simply died whenever Anthropic was
        // out. It was gated that way because the old bridge flattened content
        // to text and would have sent Gemini the caption with no picture —
        // answering a question about an image it had never seen. That is fixed
        // at the bridge rather than avoided here.
        {
          const geminiMsgs: ClaudeMessage[] = outMessages.map((m) => ({
            role: m.role as "user" | "assistant",
            // Passed through UNCHANGED. Blanking non-string content to "" was
            // the second place the attachment was lost, and it silently threw
            // away the user's question along with the picture.
            content: m.content as string | unknown[],
          }));
          if (hasAttachment) {
            console.info("Ting: failing over to Gemini WITH an attachment inlined");
          }
          const g = await callGemini({ system: systemPrompt, messages: geminiMsgs, maxTokens: 1024 });
          if (g.ok) {
            console.info("Ting answered via Gemini (fallback)");
            data = g.data;
            servedBy = "gemini";
          } else {
            console.warn(`Ting: Gemini fallback also failed (${g.reason})`);
          }
        }
        if (!data) {
          if (res.status === 429) return json({ error: "Ting is a bit busy — try again in a moment 🐢" }, 429);
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
