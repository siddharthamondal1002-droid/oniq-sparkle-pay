// Translate edge function — uses Lovable AI Gateway
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LANG_NAMES: Record<string, string> = {
  en: "English",
  bn: "Bengali",
  hi: "Hindi",
  auto: "auto-detect",
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

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "AI not configured" }, 500);

    const sourceLabel = from === "auto" ? "the source language (auto-detect)" : LANG_NAMES[from];
    const system =
      `You are a professional translator. Translate the user's text from ${sourceLabel} to ${LANG_NAMES[to]}. ` +
      "Preserve tone and meaning. Return ONLY the translation as plain text — no quotes, no commentary, no explanations, no romanization.";

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
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

    return json({ translation });
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
