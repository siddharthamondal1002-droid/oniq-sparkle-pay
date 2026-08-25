// health-scan — Claude vision/document for medical reports (auth + rate-limited)
import type { SearchBudget } from "../_shared/searchBudget.ts";
import {
  attachmentTokenCeiling,
  refusalMessage,
  requestIdFrom,
  serviceRoleRpc,
  withSearchSpendGuard,
} from "../_shared/searchGuard.ts";

// --- spend shape of ONE report scan -----------------------------------------
//
// HAIKU 4.5 — owner directive, 2026-08-25 ("change all to haiku").
// This one was not breaching: on sonnet-4-6 at 4 hops it projected to ~$0.28,
// inside the ceiling. It moves for consistency, not rescue.
const SCAN_MODEL = "claude-haiku-4-5";
const SCAN_MAX_SEARCHES = 4;
const SCAN_MAX_TOKENS = 1400;
// System prompt + the wrapper text, generously.
const SCAN_PROMPT_TOKEN_RESERVE = 2_000;
// Per-hop search-result context. This function had NO per-hop allowance at all
// — it reserved for the prompt and the attachment and nothing for the four
// searches it is permitted to run, so a scan that actually searched was
// guaranteed to under-reserve. 14,000/hop is smart-scout's measured ~13,220
// rounded up.
const SCAN_TOKENS_PER_SEARCH = 14_000;
// Reserved above max_tokens, for the reason smart-scout's control demonstrated.
const SCAN_OUTPUT_TOKEN_RESERVE = 2_500;

function scanBudget(kind: "image" | "pdf", data: string): SearchBudget {
  return {
    maxSearches: SCAN_MAX_SEARCHES,
    maxProviderCalls: 1,
    maxLlmCalls: 1,
    // The attachment IS the input here — reserving a flat number would be
    // reserving for a request nobody is making.
    maxInputTokens:
      SCAN_PROMPT_TOKEN_RESERVE +
      attachmentTokenCeiling(kind, data) +
      SCAN_MAX_SEARCHES * SCAN_TOKENS_PER_SEARCH,
    maxOutputTokens: SCAN_OUTPUT_TOKEN_RESERVE,
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
      parts.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
      });
    }
    parts.push({
      type: "text",
      text:
        (note ? `Context from user: ${note}\n\n` : "") +
        "Please read this medical report and provide a plain-language summary as instructed.",
    });

    const payload = {
      model: SCAN_MODEL,
      max_tokens: SCAN_MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: "user", content: parts }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: SCAN_MAX_SEARCHES }],
    };

    // ---- SPEND GUARD -------------------------------------------------------
    const uid = _subFromAuth(req);
    const guarded = await withSearchSpendGuard(
      serviceRoleRpc(),
      {
        requestId: requestIdFrom(body?.requestId),
        provider: "anthropic",
        model: SCAN_MODEL,
        searchType: "health-scan",
        userId: UUID_RE.test(uid) ? uid : undefined,
        budget: scanBudget(kind, data),
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
        let parsedBody: { usage?: unknown; stop_reason?: unknown; content?: unknown } | null = null;
        try {
          parsedBody = text ? JSON.parse(text) : null;
        } catch {
          /* keep null — a body we cannot read is still a call we made */
        }
        return {
          value: { status: r.status, ok: r.ok, body: parsedBody, text },
          usage: r.ok ? (parsedBody?.usage as never) : null,
          stopReason: r.ok ? (parsedBody?.stop_reason as string) : null,
          terminationReason: r.ok ? undefined : ("PROVIDER_ERROR" as const),
        };
      },
    );

    if (!guarded.admitted) {
      console.warn(`health-scan: spend guard refused (${guarded.reason})`);
      const msg =
        guarded.reason === "over-request-cap"
          ? "that report is too large to scan — try a smaller or clearer file"
          : refusalMessage(guarded.reason);
      return json({ error: msg, blocked: guarded.reason }, 200);
    }

    const res = guarded.value;
    if (res.status === 401) return json({ configured: false }, 200);
    if (res.status === 429) return json({ error: "AI is busy — try again in a moment 🐢" }, 429);
    if (!res.ok) {
      console.error("anthropic error", res.status, res.text.slice(0, 200));
      return json({ error: "scan glitched — try again" }, 502);
    }
    const out = res.body as Record<string, unknown> | null;
    const blocks: Array<{ type?: string; text?: string; content?: unknown }> = Array.isArray(
      out?.content,
    )
      ? out.content
      : [];
    let reply = "";
    const sources: string[] = [];
    const seen = new Set<string>();
    const push = (u: unknown) => {
      if (typeof u === "string" && /^https?:\/\//i.test(u) && !seen.has(u)) {
        seen.add(u);
        sources.push(u);
      }
    };
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
