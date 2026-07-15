// Shared Anthropic (Claude) client for ONIQ edge functions.
// Reuses the same secret + model that the ting function already relies on.
// Never throws; always returns a discriminated union.

export const SUPPORTED_LANGS: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  te: "Telugu",
  mr: "Marathi",
  ta: "Tamil",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  or: "Odia",
  as: "Assamese",
  ur: "Urdu",
};

export function langInstruction(lang?: string | null): string {
  if (!lang || typeof lang !== "string") return "";
  const code = lang.toLowerCase().trim();
  if (!code || code === "en") return "";
  const name = SUPPORTED_LANGS[code];
  if (!name) return "";
  return `\n\nRespond in ${name}. Use the ${name} script. Keep these UNCHANGED and untranslated: brand names, retailer names, place names, app names, currency symbols, and all numbers/prices. If the user writes in English, still reply in ${name}.`;
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mask(k: string | undefined): string {
  if (!k) return "<empty>";
  return `****${k.slice(-4)}`;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 529]);

export type ClaudeMessage = { role: "user" | "assistant"; content: string };

export type CallClaudeOpts = {
  system: string;
  messages: ClaudeMessage[];
  tools?: unknown[];
  toolChoice?: unknown;
  maxTokens?: number;
  timeoutMs?: number;
};

export type CallClaudeResult =
  | { ok: true; data: any }
  | { ok: false; reason: string };

export async function callClaude(opts: CallClaudeOpts): Promise<CallClaudeResult> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) {
    console.warn(`callClaude: missing ANTHROPIC_API_KEY (${mask(key)})`);
    return { ok: false, reason: "not configured" };
  }

  const payload: Record<string, unknown> = {
    model: "claude-sonnet-4-6",
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    messages: opts.messages,
  };
  if (opts.tools) payload.tools = opts.tools;
  if (opts.toolChoice) payload.tool_choice = opts.toolChoice;

  const timeoutMs = opts.timeoutMs ?? 12000;

  const attempt = async (): Promise<{ status: number; body: any; text?: string } | { error: string }> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const text = await res.text().catch(() => "");
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { /* keep null */ }
      return { status: res.status, body, text };
    } catch (e) {
      return { error: (e as Error)?.name === "AbortError" ? "timeout" : String(e).slice(0, 120) };
    } finally {
      clearTimeout(t);
    }
  };

  let r = await attempt();
  if ("error" in r) {
    console.warn(`callClaude: fetch failed (${r.error}) key=${mask(key)}`);
    // retry once on network/timeout too
    await new Promise((res) => setTimeout(res, 600));
    r = await attempt();
    if ("error" in r) return { ok: false, reason: r.error };
  }
  if ("status" in r && RETRY_STATUSES.has(r.status)) {
    console.warn(`callClaude: http ${r.status} retrying key=${mask(key)}`);
    await new Promise((res) => setTimeout(res, 600));
    r = await attempt();
    if ("error" in r) return { ok: false, reason: r.error };
  }

  if ("status" in r) {
    if (r.status >= 200 && r.status < 300 && r.body) {
      return { ok: true, data: r.body };
    }
    const snippet = (r.text ?? "").slice(0, 200);
    console.warn(`callClaude: http ${r.status} key=${mask(key)} body=${snippet}`);
    return { ok: false, reason: `http ${r.status}` };
  }
  return { ok: false, reason: "unknown" };
}
