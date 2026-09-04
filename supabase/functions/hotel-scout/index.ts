// hotel-scout — Claude web_search stay-price comparator.
// Same principle as smart-scout (products) and ride-genie (rides): parse a
// casual Indian-English/Hinglish request, search the live web across verified
// booking sites, and return a decisive best-value pick with visible sources.
import { langInstruction, callText, type ClaudeMessage } from "../_shared/llm.ts";
import type { SearchBudget } from "../_shared/searchBudget.ts";
import {
  refusalMessage,
  requestIdFrom,
  serviceRoleRpc,
  withSearchSpendGuard,
} from "../_shared/searchGuard.ts";

// --- spend shape of ONE stay-scout query ------------------------------------
//
// HAIKU 4.5 — owner directive, 2026-08-25 ("change all to haiku").
//
// This function carried the worst instance of the flat-reserve defect in the
// fleet. On opus-5 at 11 hops, with the per-hop context growth measured across
// 51 real requests (~13,220 input tokens per hop), a real query projected to
// **~$1.03** — more than twice the $0.50 ceiling — against a reserve of
// $0.445625 that would not have covered even half of it. It was never
// deployed in that state.
const STAY_MODEL = "claude-haiku-4-5";
// Depth stays at 11. It did not need cutting: on Haiku the full 11-hop search
// reserves $0.315625, comfortably inside the ceiling. Reducing depth would
// have traded away answer quality to fix a problem the model change already
// solves, which is the wrong lever to reach for first.
const STAY_MAX_SEARCHES = 11;
const STAY_MAX_TOKENS = 3500;
const STAY_SYSTEM_CACHE_TOKENS = 1300;

// The reserve scales with depth, because that is the mechanism: every hop
// feeds its results back into context. Measured on smart-scout's battery, and
// 14,000 is that measurement rounded up.
const STAY_BASE_INPUT_TOKENS = 20_000;
const STAY_TOKENS_PER_SEARCH = 14_000;
// Output is reserved ABOVE max_tokens: smart-scout's control billed 4,295
// output tokens against a 3,500 max_tokens, so reserving at max_tokens is
// demonstrably optimistic.
const STAY_OUTPUT_TOKEN_RESERVE = 6_000;

const STAY_BUDGET: SearchBudget = {
  maxSearches: STAY_MAX_SEARCHES,
  maxProviderCalls: 1,
  maxLlmCalls: 1,
  maxInputTokens: STAY_BASE_INPUT_TOKENS + STAY_MAX_SEARCHES * STAY_TOKENS_PER_SEARCH,
  maxOutputTokens: STAY_OUTPUT_TOKEN_RESERVE,
  maxWallClockMs: 180_000,
  maxEstimatedUsd: 0.5,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// User-visible errors ride back as HTTP 200 { error } so functions.invoke
// doesn't swallow them into a generic non-2xx wrapper.
function friendly(error: string, extra: Record<string, unknown> = {}) {
  return json({ error, ...extra }, 200);
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authFail = await requireAuth(req);
    if (authFail) return authFail;
    if (!_rateLimit(_subFromAuth(req), 8))
      return friendly("slow down bestie 😅 — try again in a moment");

    const body = await req.json().catch(() => ({}));
    const query = typeof body?.query === "string" ? body.query.trim().slice(0, 300) : "";
    const checkin =
      typeof body?.checkin === "string" && ISO_DATE.test(body.checkin) ? body.checkin : "";
    const checkout =
      typeof body?.checkout === "string" && ISO_DATE.test(body.checkout) ? body.checkout : "";
    const lang = typeof body?.lang === "string" ? body.lang.slice(0, 20) : "";
    let guests = Number.isFinite(body?.guests) ? Math.floor(Number(body.guests)) : 2;
    if (guests < 1 || guests > 12) guests = 2;
    let budget = Number.isFinite(body?.budget) ? Math.floor(Number(body.budget)) : 0;
    if (budget < 0 || budget > 1000000) budget = 0;

    if (!query) return friendly("where you staying? drop a city or area 🏨");
    if (!Deno.env.get("ANTHROPIC_API_KEY"))
      return friendly("stay scout isn't configured yet — try again later");

    const dateLine = checkin
      ? `Stay dates: check-in ${checkin}${checkout ? `, check-out ${checkout}` : ""}. Quote nightly rates for THESE dates where the sites show them.`
      : "Stay dates: not given — quote typical current nightly rates and say they're indicative.";
    const budgetLine = budget
      ? `Budget: about ₹${budget} per night — prioritise options at or below this, and flag the best slightly-over option only if it's clearly worth it.`
      : "Budget: not given — cover budget, mid and premium tiers.";

    const system =
      "You are ONIQ's stay & hotel price scout for India — a purchaser-centric booking assistant, not a neutral list-dumper. Search the live web and help the user actually decide where to book. " +
      "SCOPE — the user names a destination (city, area, landmark, or a specific hotel) and you compare the SAME stay across booking platforms: Booking.com, MakeMyTrip, Goibibo, Agoda, Cleartrip, Yatra, Trivago, Expedia, Hotels.com, Airbnb, OYO, Treebo, FabHotels, and the hotel's own official website (direct booking is often cheapest — always check it). " +
      `${dateLine} Guests: ${guests}. ${budgetLine} ` +
      "LANGUAGE UNDERSTANDING — Indian users mix languages freely (Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia, Assamese, Urdu, plus Hinglish/Benglish transliterations). Understand casual phrasing like 'sasta hotel', 'digha e thakar jayga', 'homestay near Manali under 2k'. Normalise to English for the actual searches but keep the user's own phrasing in 'stay'. " +
      "PER-SITE SEARCHES — run TARGETED searches per major platform, e.g. '<hotel/area> Booking.com price', '<hotel/area> MakeMyTrip', '<hotel> official site rate', before concluding a platform has nothing. Prefer property/listing pages over blogs and unverifiable resellers. " +
      "VERIFIED SOURCE PREFERENCE — populate 'source_domain' with the real domain the rate came from (e.g. 'booking.com', 'makemytrip.com'). Set 'verified' true only for recognised booking platforms or the hotel's official site. Put a direct, working listing/search URL in 'url' when you have one. " +
      "TOTAL COST HONESTY — nightly rates hide taxes and fees. When a site's rate excludes GST/service fees, say so in that row's 'note'. Flag free-cancellation and breakfast-included as value factors, and flag outlier prices that look like data errors. " +
      "DECISIVE TONE — you MUST name ONE top pick and WHY: not just cheapest, but cheapest-for-what-you-get (location, rating, cancellation policy, taxes, distance to the thing they came for). Warm, decisive, traveller-first. " +
      "OUTPUT — respond ONLY with valid JSON matching: " +
      `{ "stay": string, "results": [{ "site": string, "hotel": string, "price_inr": number|null, "price_range_inr": string|null, "rating": string|null, "source_domain": string|null, "url": string|null, "verified": boolean, "note": string|null }], "top_pick": { "site": string, "hotel": string, "why": string, "cross_checked": string[] } | null, "disclaimer": string }. ` +
      "The JSON KEYS MUST stay in English exactly as specified. 'site' is the booking platform name in English ('Booking.com', 'MakeMyTrip', 'Direct — Taj Bengal'). 'hotel' is the property name. 'price_inr' MUST be a raw number (nightly rate for the given guests) or null; use 'price_range_inr' (e.g. '₹2,400–3,100/night') when only a range is known. Only prose fields ('disclaimer', 'note', 'why') may be localised. " +
      "CROSS-CHECK REQUIREMENT — before finalising the top_pick, verify it against at least 2 INDEPENDENT sources and list them in 'cross_checked' (never fabricate). If sources disagree on the rate, call the disagreement out explicitly in 'why'. 'why' must be 2–3 substantive sentences. " +
      "Return only stays you actually found; sort results lowest price first with null-price rows last. No markdown, no code fences — raw JSON only." +
      langInstruction(lang);

    const messages = [
      { role: "user", content: `Scout stays in India for: ${query}` },
    ] as ClaudeMessage[];

    // ---- SPEND GUARD — see smart-scout for the full reasoning. -------------
    const rpc = serviceRoleRpc();
    const uid = _subFromAuth(req);

    const guarded = await withSearchSpendGuard(
      rpc,
      {
        requestId: requestIdFrom(body?.requestId),
        provider: "anthropic",
        model: STAY_MODEL,
        searchType: "hotel-scout",
        userId: UUID_RE.test(uid) ? uid : undefined,
        budget: STAY_BUDGET,
        cacheWriteTokens: STAY_SYSTEM_CACHE_TOKENS,
      },
      async () => {
        const res = await callText({
          system,
          messages,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: STAY_MAX_SEARCHES }],
          maxTokens: STAY_MAX_TOKENS,
          timeoutMs: STAY_BUDGET.maxWallClockMs,
          cacheSystem: true,
          model: STAY_MODEL,
          // FAILOVER ON, BUT ONLY WITH SOURCES. This was `allowFallback: false`
          // because a tool-less Gemini answer to a stay-price prompt is a
          // fabricated price list with fabricated `verified` domains. That
          // objection is now handled rather than avoided: geminiSearch.ts
          // translates web_search_20250305 into Google's google_search, and
          // requireSearch makes callGemini REFUSE an answer it could not
          // ground. A refusal is what this function already did when Anthropic
          // was out; an invented source list would be new and worse.
          requireSearch: true,
        });
        return {
          value: res,
          neverCalled: !res.ok && res.reason === "not configured",
          usage: res.ok ? res.data?.usage : null,
          stopReason: res.ok ? res.data?.stop_reason : null,
          terminationReason: res.ok ? undefined : ("PROVIDER_ERROR" as const),
        };
      },
    );

    if (!guarded.admitted) {
      console.warn(`hotel-scout: spend guard refused (${guarded.reason})`);
      return friendly(refusalMessage(guarded.reason), { blocked: guarded.reason });
    }
    const claudeRes = guarded.value;

    if (!claudeRes.ok) {
      const reason = claudeRes.reason ?? "";
      console.error("hotel-scout callText failed:", reason);
      if (/timeout/i.test(reason))
        return friendly("stay scout took too long — try a tighter search 🐢");
      if (/http 429/.test(reason)) return friendly("rate limit hit — try again in a moment 🐢");
      if (/http 40[02]/.test(reason))
        return friendly("AI credits exhausted — top up to keep scouting");
      return friendly("stay scout glitched — try again");
    }

    const data = claudeRes.data;
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
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    let parsed: any = null;
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1));
      } catch (e) {
        console.error("hotel-scout parse error", e, cleaned.slice(0, 400));
      }
    }
    if (!parsed || !Array.isArray(parsed.results)) {
      return friendly("couldn't structure those stays — try naming the city or hotel", {
        raw: textOut.slice(0, 400),
      });
    }

    parsed.results.sort((a: any, b: any) => {
      const pa = typeof a?.price_inr === "number" ? a.price_inr : Number.POSITIVE_INFINITY;
      const pb = typeof b?.price_inr === "number" ? b.price_inr : Number.POSITIVE_INFINITY;
      return pa - pb;
    });

    return json({ ...parsed, sources });
  } catch (e) {
    console.error("hotel-scout error", e);
    return friendly("something went sideways — try again");
  }
});
