// smart-scout — Claude price scout with web_search tool
import { langInstruction } from "../_shared/llm.ts";
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

    const body = await req.json().catch(() => ({}));
    const query = typeof body?.query === "string" ? body.query.trim().slice(0, 300) : "";
    const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : "";
    const imageMime = typeof body?.imageMime === "string" ? body.imageMime : "image/jpeg";
    const language = typeof body?.language === "string" ? body.language.slice(0, 20) : "auto";

    if (!query && !imageBase64) return json({ error: "Give me a product name or a photo 📸" }, 400);

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return json({ error: "Scout not configured" }, 500);

    const system =
      "You are ONIQ's price scout for India. Search the live web for the product's current prices across these Indian shopping apps: Amazon.in, Flipkart, Meesho, JioMart, Myntra, Croma, Reliance Digital, Blinkit, Zepto. " +
      "IMPORTANT — do NOT rely on a single generic search. Run TARGETED per-store searches BY NAME for each major store before concluding it's unavailable, e.g.: '<product> price Amazon.in', '<product> price Flipkart', '<product> price Meesho', '<product> price JioMart', '<product> price Myntra', '<product> price Croma', '<product> price Reliance Digital', '<product> price Blinkit', '<product> price Zepto'. Prefer product-listing pages over blogs. " +
      "For every store you tried, INCLUDE a row in results: if you found a live price, set price_inr to the number in INR; if you couldn't verify a live price for that store, INCLUDE the row anyway with price_inr: null and note: \"couldn't verify live — check in app\". Never silently drop a store. " +
      `Respond ONLY with valid JSON matching: { "product": string, "results": [{ "store": string, "price_inr": number|null, "rating": string|null, "note": string|null }], "disclaimer": string }. ` +
      "Sort results lowest price first; null-price rows go last. If the user's query is in another language, understand it and set product to include both the local-language name and the English name. " +
      `User's preferred language hint: ${language}. No markdown, no code fences — raw JSON only.`;

    const userContent: any[] = [];
    if (imageBase64) {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: imageMime, data: imageBase64 },
      });
      userContent.push({
        type: "text",
        text: query
          ? `Identify this product, then search for its prices in India. Extra context: ${query}`
          : "Identify this product, then search for its current prices in India.",
      });
    } else {
      userContent.push({ type: "text", text: `Find current prices in India for: ${query}` });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55000);

    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 3000,
          system,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 9 }],
          messages: [{ role: "user", content: userContent }],
        }),
      });
    } catch (e) {
      clearTimeout(timer);
      if ((e as any)?.name === "AbortError") return json({ error: "Scout timed out — try again" }, 504);
      throw e;
    }
    clearTimeout(timer);

    if (res.status === 429) return json({ error: "Rate limit — try again in a moment 🐢" }, 429);
    if (res.status === 402) return json({ error: "AI credits exhausted — top up" }, 402);
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("anthropic error", res.status, t);
      return json({ error: "Scout glitched — try again" }, 502);
    }

    const data = await res.json();
    const blocks = Array.isArray(data?.content) ? data.content : [];
    const textOut = blocks
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text ?? "")
      .join("\n")
      .trim();

    const sources: Array<{ url: string; title?: string }> = [];
    for (const b of blocks) {
      if (b?.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) {
          if (r?.url) sources.push({ url: r.url, title: r.title });
        }
      }
    }

    const cleaned = textOut
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    // find first { ... last }
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    let parsed: any = null;
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1));
      } catch (e) {
        console.error("parse error", e);
      }
    }
    if (!parsed || !Array.isArray(parsed.results)) {
      return json({ error: "Scout couldn't structure the results — try again", raw: textOut.slice(0, 400) }, 502);
    }

    parsed.results.sort((a: any, b: any) => {
      const pa = typeof a?.price_inr === "number" ? a.price_inr : Number.POSITIVE_INFINITY;
      const pb = typeof b?.price_inr === "number" ? b.price_inr : Number.POSITIVE_INFINITY;
      return pa - pb;
    });

    return json({ ...parsed, sources });
  } catch (e) {
    console.error("smart-scout error", e);
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
