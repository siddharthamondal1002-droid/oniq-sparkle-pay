// Ting edge function — Claude (Anthropic) with optional web search
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM =
  "You are Ting 🔮, ONIQ's built-in assistant. Be concise, warm, and helpful. " +
  "ONIQ is a super app (chat, payments, food, rides, clips, learn) built in Kolkata. " +
  "Answer in the user's language. When you used web search, mention your sources briefly.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authFail = await requireAuth(req);
    if (authFail) return authFail;

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ configured: false }, 200);


    const body = await req.json().catch(() => ({}));
    const messages = Array.isArray(body?.messages) ? body.messages : null;
    const search = body?.search !== false; // default on
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

    const payload: Record<string, unknown> = {
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM,
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
    if (res.status === 429) return json({ error: "Ting is a bit busy — try again in a moment 🐢" }, 429);
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("anthropic error", res.status, t);
      return json({ error: "Ting glitched — try again" }, 502);
    }

    const data = await res.json();
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
