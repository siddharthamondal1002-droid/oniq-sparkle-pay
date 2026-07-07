// Translate edge function — Claude primary, Lovable AI Gateway fallback
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LANG_NAMES: Record<string, string> = {
  auto: "auto-detect",
  // Indian
  bn: "Bengali",
  hi: "Hindi",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  or: "Odia",
  ur: "Urdu",
  as: "Assamese",
  // International
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ar: "Arabic",
  zh: "Chinese (Simplified)",
  ja: "Japanese",
  ko: "Korean",
  ru: "Russian",
  it: "Italian",
  tr: "Turkish",
  id: "Indonesian",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const from = String(body?.from ?? "auto");
    const to = String(body?.to ?? "en");

    if (!text) return json({ error: "Enter some text to translate" }, 400);
    if (text.length > 1000) return json({ error: "Text too long (max 1000 chars)" }, 400);
    if (!LANG_NAMES[from] || !LANG_NAMES[to] || to === "auto") {
      return json({ error: "Unsupported language" }, 400);
    }

    const sourceLabel = from === "auto" ? "the source language (auto-detect)" : LANG_NAMES[from];
    const system =
      `You are a professional translator. Translate the user's text from ${sourceLabel} to ${LANG_NAMES[to]}. ` +
      "Preserve tone, register, and formatting. Return ONLY the translation as plain text — no quotes, no commentary, no explanations. " +
      "Do not include romanization unless the target language uses the Latin script.";

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    // Primary: Claude
    if (anthropicKey) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          system,
          messages: [{ role: "user", content: text }],
        }),
      });
      if (res.status === 429) return json({ error: "Rate limit — try again in a moment 🐢" }, 429);
      if (res.status === 402) return json({ error: "AI credits exhausted — top up" }, 402);
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("anthropic error", res.status, t);
        // fall through to gateway if available
        if (!lovableKey) return json({ error: "Translator glitched — try again" }, 502);
      } else {
        const data = await res.json();
        const blocks = Array.isArray(data?.content) ? data.content : [];
        const translation = blocks
          .filter((b: any) => b?.type === "text")
          .map((b: any) => b.text ?? "")
          .join("")
          .trim();
        if (!translation) return json({ error: "Empty response from translator" }, 502);
        return json({ translation, engine: "claude" });
      }
    }

    // Fallback: Lovable AI Gateway
    if (!lovableKey) return json({ error: "Translator not configured" }, 500);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
      }),
    });

    if (res.status === 429) return json({ error: "Rate limit — try again in a moment 🐢" }, 429);
    if (res.status === 402) return json({ error: "AI credits exhausted — top up in Lovable" }, 402);
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("gateway error", res.status, t);
      return json({ error: "Translator glitched — try again" }, 502);
    }

    const data = await res.json();
    const translation: string = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!translation) return json({ error: "Empty response from translator" }, 502);

    return json({ translation, engine: "gateway" });
  } catch (e) {
    console.error("translate fn error", e);
    return json({ error: "Something went sideways — try again" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
