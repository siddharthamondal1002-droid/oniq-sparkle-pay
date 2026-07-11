// health-scan — Claude vision/document for medical reports (auth + rate-limited)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM =
  "You are a careful health-information assistant for India. Read the report, " +
  "explain findings in simple language, flag values outside reference ranges, " +
  "suggest WHICH TYPE of specialist to consult (e.g. cardiologist, endocrinologist) " +
  "and sensible next questions for the doctor. NEVER diagnose definitively, " +
  "NEVER prescribe medication or dosages. Always end with: " +
  "this is informational only — consult a licensed doctor.";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authFail = await requireAuth(req);
    if (authFail) return authFail;
    if (!_rateLimit(_subFromAuth(req), 5)) {
      return json({ error: "easy tiger — 5 scans per minute 🐢" }, 429);
    }
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ configured: false }, 200);

    const body = await req.json().catch(() => ({}));
    const kind = body?.kind as "image" | "pdf" | undefined;
    const mime = String(body?.mime ?? "");
    const data = String(body?.data ?? "");
    const note = typeof body?.note === "string" ? body.note.slice(0, 400) : "";
    if (!kind || !data || !mime) return json({ error: "attach a report photo or PDF" }, 400);
    if (data.length > 8_500_000) return json({ error: "file too big — keep under ~6MB" }, 400);

    const parts: Array<Record<string, unknown>> = [];
    if (kind === "image") {
      parts.push({ type: "image", source: { type: "base64", media_type: mime, data } });
    } else {
      parts.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    }
    parts.push({
      type: "text",
      text: (note ? `Context from user: ${note}\n\n` : "") +
        "Please read this medical report and provide a plain-language summary as instructed.",
    });

    const payload = {
      model: "claude-sonnet-4-6",
      max_tokens: 1400,
      system: SYSTEM,
      messages: [{ role: "user", content: parts }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
    };

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
    if (res.status === 429) return json({ error: "AI is busy — try again in a moment 🐢" }, 429);
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("anthropic error", res.status, t);
      return json({ error: "scan glitched — try again" }, 502);
    }
    const out = await res.json();
    const blocks: Array<{ type?: string; text?: string; content?: unknown }> = Array.isArray(out?.content) ? out.content : [];
    let reply = "";
    const sources: string[] = [];
    const seen = new Set<string>();
    const push = (u: unknown) => { if (typeof u === "string" && /^https?:\/\//i.test(u) && !seen.has(u)) { seen.add(u); sources.push(u); } };
    for (const b of blocks) {
      if (b?.type === "text" && typeof b.text === "string") reply += (reply ? "\n\n" : "") + b.text;
      if (b?.type === "web_search_tool_result") {
        const arr = Array.isArray(b?.content) ? (b.content as Array<{ url?: string }>) : [];
        for (const r of arr) push(r?.url);
      }
    }
    const disclaimer = "this is informational only — not a diagnosis. see a real doctor 🩺";
    return json({ reply: reply.trim(), sources, disclaimer });
  } catch (e) {
    console.error("health-scan error", e);
    return json({ error: "something went sideways — try again" }, 500);
  }
});
