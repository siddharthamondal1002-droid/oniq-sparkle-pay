// smart-scout — Claude price/deal scout with web_search tool
// Purchaser-centric: decisive best-value pick, verified retailer preference,
// visible source domains, and location-aware (street + PIN, not just city).
import { langInstruction, callClaude, type ClaudeMessage } from "../_shared/llm.ts";
import type { SearchBudget } from "../_shared/searchBudget.ts";
import {
  refusalMessage,
  requestIdFrom,
  serviceRoleRpc,
  withSearchSpendGuard,
} from "../_shared/searchGuard.ts";

// --- spend shape of ONE scout query -----------------------------------------
//
// The reservation has to describe the call we are ACTUALLY about to make, so
// these numbers and the `tools` block below must stay in step.
//
// HAIKU 4.5 ECONOMIC EXPERIMENT — owner directive, 2026-08-24.
//
// The control, and it is a real settled invoice rather than a model:
//
//     claude-opus-5   6 searches   reserved $0.445625   ACTUAL $0.530683
//     over the $0.50 request ceiling by $0.030683      ECONOMIC GATE: FAIL
//
// Two things were wrong and only one of them was the model. The reservation
// was ALSO optimistic: it assumed 48,000 input tokens and the call used
// 99,321. The old constant was calibrated on a 40,286-token measurement plus
// 20%, and that sample simply was not representative.
const SCOUT_MODEL = "claude-haiku-4-5";
// Six is the depth the control request actually consumed (of 11 permitted), so
// this preserves observed behaviour while removing the unused headroom that
// made the ladder unbounded. Enforced server-side via `max_uses`: the sixth
// search is the last, and the answer is synthesised from what was gathered.
const SCOUT_MAX_SEARCHES = 6;
const SCOUT_MAX_TOKENS = 3500;
// Cached system prompt: ~5.1k chars ≈ 1.3k tokens. Charged at 1.25x on the
// first call of each 5-minute cache window.
const SCOUT_SYSTEM_CACHE_TOKENS = 1300;
// An attached photo is extra input. Anthropic downscales images before billing,
// so this is a ceiling rather than a function of the upload's byte count.
const IMAGE_TOKEN_ALLOWANCE = 8000;

// THE RESERVE NOW SCALES WITH SEARCH DEPTH, because that is the mechanism.
// Every web-search hop feeds its results back into context, so input tokens
// grow with hop count; a flat reserve cannot track that and will always be
// wrong in the expensive direction. Measured on the control request: 6 hops
// produced 99,321 input tokens.
const SCOUT_BASE_INPUT_TOKENS = 20_000; // system + query + product context
const SCOUT_TOKENS_PER_SEARCH = 14_000; // results re-entering context per hop
// 20,000 + 6 x 14,000 = 104,000, above the 99,321 actually observed.
//
// Output is reserved ABOVE `max_tokens` deliberately: the control request
// billed 4,295 output tokens against a 3,500 `max_tokens`, so reserving at
// max_tokens is demonstrably optimistic. Reserving what was measured, plus
// room, is the point of the exercise.
const SCOUT_OUTPUT_TOKEN_RESERVE = 6_000;

function scoutBudget(hasImage: boolean): SearchBudget {
  return {
    maxSearches: SCOUT_MAX_SEARCHES,
    maxProviderCalls: 1,
    maxLlmCalls: 1,
    maxInputTokens:
      SCOUT_BASE_INPUT_TOKENS +
      SCOUT_MAX_SEARCHES * SCOUT_TOKENS_PER_SEARCH +
      (hasImage ? IMAGE_TOKEN_ALLOWANCE : 0),
    maxOutputTokens: SCOUT_OUTPUT_TOKEN_RESERVE,
    maxWallClockMs: 180_000,
    maxEstimatedUsd: 0.5,
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- rate limit (per-isolate; resets on cold start) ---
// Kept as a cheap first line against one client hammering a single isolate. It
// is NOT the spend control — it never was. It bounds one isolate's burst and
// resets on every cold start, which is why the durable ledger above exists.
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

// User-visible errors go back as HTTP 200 with { error } so
// supabase.functions.invoke doesn't swallow them into a generic non-2xx wrapper.
function friendly(error: string, extra: Record<string, unknown> = {}) {
  return json({ error, ...extra }, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authFail = await requireAuth(req);
    if (authFail) return authFail;
    if (!_rateLimit(_subFromAuth(req), 10))
      return friendly("slow down bestie 😅 — try again in a moment");

    const body = await req.json().catch(() => ({}));
    const query = typeof body?.query === "string" ? body.query.trim().slice(0, 300) : "";
    const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : "";
    const imageMime = typeof body?.imageMime === "string" ? body.imageMime : "image/jpeg";
    const language = typeof body?.language === "string" ? body.language.slice(0, 20) : "auto";
    const lang = typeof body?.lang === "string" ? body.lang : "";
    const loc = body?.location && typeof body.location === "object" ? body.location : null;
    const locLabel = typeof loc?.label === "string" ? loc.label.slice(0, 200) : "";
    const locPin = typeof loc?.pin === "string" ? loc.pin.slice(0, 10) : "";
    const locLat = Number.isFinite(loc?.lat) ? Number(loc.lat) : null;
    const locLon = Number.isFinite(loc?.lon) ? Number(loc.lon) : null;

    // Also try to lift a 6-digit PIN out of the typed query.
    const pinInQuery = (query.match(/\b(\d{6})\b/) || [])[1] || "";

    if (!query && !imageBase64) return friendly("give me a product name, a place, or a photo 📸");

    if (!Deno.env.get("ANTHROPIC_API_KEY"))
      return friendly("scout isn't configured yet — try again later");

    // Optional enrichment: Google Address Descriptors (GA in India, free tier of
    // Geocoding Essentials). Adds ranked nearby landmarks + spatial relationships
    // ("across the road from X", "within Y area") — how Indians actually describe
    // locations. Additive only: on missing key, HTTP error, timeout, or empty
    // response we silently fall back to Mappls/GPS label + PIN behavior unchanged.
    let landmarkContext = "";
    const googleKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (googleKey && locLat != null && locLon != null) {
      try {
        const ac = new AbortController();
        const gt = setTimeout(() => ac.abort(), 2500);
        const gRes = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${locLat},${locLon}` +
            `&extra_computations=ADDRESS_DESCRIPTORS&key=${encodeURIComponent(googleKey)}`,
          { signal: ac.signal },
        );
        clearTimeout(gt);
        if (gRes.ok) {
          const gJson = await gRes.json();
          const desc = gJson?.address_descriptor ?? gJson?.results?.[0]?.address_descriptor;
          const landmarks: any[] = Array.isArray(desc?.landmarks) ? desc.landmarks : [];
          const areas: any[] = Array.isArray(desc?.areas) ? desc.areas : [];
          const lmBits = landmarks
            .slice(0, 3)
            .map((l) => {
              const name = l?.display_name?.text ?? l?.name ?? "";
              const rel = l?.spatial_relationship ?? "";
              return name ? (rel ? `${rel.toLowerCase().replace(/_/g, " ")} ${name}` : name) : "";
            })
            .filter(Boolean);
          const areaBits = areas
            .slice(0, 2)
            .map((a) => {
              const name = a?.display_name?.text ?? a?.name ?? "";
              const cont = a?.containment ?? "";
              return name ? (cont === "WITHIN" ? `within ${name}` : name) : "";
            })
            .filter(Boolean);
          const parts = [...lmBits, ...areaBits];
          if (parts.length) landmarkContext = parts.join("; ");
          else console.log("smart-scout: address_descriptors returned no landmarks/areas");
        } else {
          console.log("smart-scout: google geocode http", gRes.status);
        }
      } catch (e) {
        console.log("smart-scout: address_descriptors skipped:", (e as Error)?.message ?? e);
      }
    } else if (!googleKey) {
      console.log(
        "smart-scout: GOOGLE_MAPS_API_KEY not set — skipping Address Descriptors enrichment",
      );
    }

    const locBits: string[] = [];
    if (locLabel) locBits.push(locLabel);
    if (locPin) locBits.push(`PIN ${locPin}`);
    else if (pinInQuery) locBits.push(`PIN ${pinInQuery}`);
    if (landmarkContext) locBits.push(`nearby: ${landmarkContext}`);
    if (locLat != null && locLon != null)
      locBits.push(`(${locLat.toFixed(4)}, ${locLon.toFixed(4)})`);
    const locationLine = locBits.length
      ? `USER'S CURRENT LOCATION CONTEXT: ${locBits.join(" · ")}. When the query is location-sensitive (restaurants, salons, clinics, local services, groceries with delivery), scope results to THIS neighbourhood / PIN code, not just the city.`
      : "USER'S LOCATION: not shared — infer from the query text if it mentions a place, otherwise treat as pan-India.";

    const system =
      "You are ONIQ's price & deal scout for India — a purchaser-centric buying assistant, not a neutral list-dumper. Search the live web and help the user actually decide. " +
      "SCOPE — the query can be either (A) a PRODUCT to buy across shopping apps (Amazon.in, Flipkart, Meesho, JioMart, Myntra, Croma, Reliance Digital, Blinkit, Zepto, Tata Neu, Ajio, Nykaa, brand's own site), or (B) a LOCAL SERVICE / place (restaurants, salons, gyms, clinics, tuition, repair, groceries with delivery, etc.). Detect which kind of query it is and adapt: for products, hunt live prices across the shopping apps above; for local services, use Zomato, Swiggy, Google Maps, JustDial, MagicBricks, Urban Company, Practo etc. and surface price-range / rating / distance instead of a single INR number. Never refuse a query for being services-not-products or vice-versa — do the right search for the query. " +
      locationLine +
      " " +
      "LANGUAGE UNDERSTANDING — Indian users mix languages freely. Parse Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia, Assamese, Urdu, plus Hinglish / Benglish / other Roman-script transliterations, plus pure English. Understand colloquial item names: atta = wheat flour, chawal = rice, dal = lentils, tel = oil, chini = sugar, doodh = milk, sabun = soap; brand shorthand like MI → Xiaomi, 'Bajaj ka mixer', 'Aashirvaad atta', 'Amul butter'. Understand vernacular price phrasing: 'kitne ka', 'koto', 'sasta', 'mehnga', 'under 500', '10k ke andar'. NORMALISE to standard English for the actual web search, but preserve the user's original phrasing in the 'product' field alongside the normalised name. " +
      "PER-STORE / PER-VENDOR SEARCHES — for products, run TARGETED searches by name per major shopping app before concluding it's unavailable, e.g. '<product> price Amazon.in', '<product> Flipkart', '<product> JioMart', etc. Prefer product-listing pages over blogs and unverifiable resellers. " +
      "VERIFIED SOURCE PREFERENCE — strongly prefer results from recognisable, verified retailer/business domains (major e-commerce platforms, official brand sites, well-known local business listing sites). For each result, populate 'source_domain' with the actual retailer domain the price/info came from (e.g. 'amazon.in', 'flipkart.com', 'zomato.com') so the user can judge trust. Set 'verified' to true only when the source domain is a well-known Indian retailer/aggregator; otherwise false. Never hide where a price came from. " +
      "DECISIVE, HELPFUL TONE — beyond listing, you MUST call out ONE top pick and WHY (not just cheapest — cheapest-for-what-you-get, considering rating, delivery speed, seller reputation, PIN-code coverage). Flag any outlier price that looks like a data error (way below or above the pack) in that row's 'note'. Keep the voice warm, decisive, buyer-first — never a neutral catalog dump. " +
      "OUTPUT — respond ONLY with valid JSON matching: " +
      `{ "product": string, "results": [{ "store": string, "price_inr": number|null, "price_range_inr": string|null, "rating": string|null, "source_domain": string|null, "verified": boolean, "note": string|null }], "top_pick": { "store": string, "why": string, "cross_checked": string[] } | null, "disclaimer": string }. ` +
      "The JSON KEYS (product, results, store, price_inr, price_range_inr, rating, source_domain, verified, note, top_pick, why, cross_checked, disclaimer) MUST stay in English exactly as specified. 'store' MUST be the retailer/venue name in English (e.g. 'Amazon.in', 'Zomato — Peter Cat'). 'price_inr' MUST be a raw number or null; use 'price_range_inr' (a short string like '₹300–500 for two') for services or when only a range is known. Only prose fields ('disclaimer', 'note', 'why') may be localised. " +
      "CROSS-CHECK REQUIREMENT — before finalising the top_pick specifically (NOT every row, that's wasteful), run at least 2 INDEPENDENT source searches to verify its price / rating / availability. Populate 'cross_checked' with the actual source names you verified against (e.g. ['Zomato','Google Maps'] or ['Amazon.in','Flipkart']) — only list sources you genuinely consulted for THIS pick, never fabricate. If independent sources meaningfully disagree on price or rating for the top pick, DO NOT hide it — call out the disagreement explicitly in 'why' (e.g. 'Zomato lists ₹450 for two but Google Maps reviews suggest ₹600+; going with Zomato as it's more current'). The 'why' field MUST be 2–3 substantive sentences covering what was compared and why this option won on value — not a one-line blurb. Leave 'cross_checked' as [] only if fewer than 2 independent sources were reachable. " +
      "For a services query, DON'T pad results with empty shopping-app rows — return only the actual vendors/venues you found. For a product query, INCLUDE a row per major store you tried (with price_inr null + note if unverified) so the user sees you didn't skip any. Sort results lowest price first; null-price rows go last. " +
      "When the user's query is in a non-English language or vernacular, set 'product' to BOTH the local-language / colloquial name AND the standard English name, e.g. 'आटा 5kg (wheat flour 5kg)'. " +
      `User's preferred language hint: ${language}. No markdown, no code fences — raw JSON only.` +
      langInstruction(lang);

    const userContent: any[] = [];
    if (imageBase64) {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: imageMime, data: imageBase64 },
      });
      userContent.push({
        type: "text",
        text: query
          ? `Identify this product, then find the best place to buy it in India. Extra context: ${query}`
          : "Identify this product, then find the best place to buy it in India.",
      });
    } else {
      userContent.push({ type: "text", text: `Scout in India for: ${query}` });
    }

    // Supabase edge functions have a 400s wall-clock ceiling on hosted plans.
    // Exploratory local-service queries legitimately need multiple sequential
    // web_search hops; 180s gives room for ~7 tool hops plus synthesis while
    // staying well below the platform ceiling.
    // Migrated onto the shared callClaude helper so smart-scout inherits the
    // Gemini billing-exhaustion fallback and system-prompt caching (system
    // is ~1.5k tokens and reused identically across every search).
    const messages = [
      { role: "user", content: userContent as unknown as string },
    ] as ClaudeMessage[];

    // ---- SPEND GUARD -------------------------------------------------------
    // Nothing below this line reaches Anthropic without a reservation in the
    // ledger. `rpc` being null means the service role is not configured, and
    // the guard refuses on it — an unreachable ledger is not permission to
    // spend.
    const rpc = serviceRoleRpc();
    const budget = scoutBudget(Boolean(imageBase64));
    const uid = _subFromAuth(req);

    const guarded = await withSearchSpendGuard(
      rpc,
      {
        requestId: requestIdFrom(body?.requestId),
        provider: "anthropic",
        model: SCOUT_MODEL,
        searchType: "smart-scout",
        userId: UUID_RE.test(uid) ? uid : undefined,
        budget,
        cacheWriteTokens: SCOUT_SYSTEM_CACHE_TOKENS,
      },
      async () => {
        const res = await callClaude({
          system,
          messages,
          tools: [
            { type: "web_search_20250305", name: "web_search", max_uses: SCOUT_MAX_SEARCHES },
          ],
          maxTokens: SCOUT_MAX_TOKENS,
          timeoutMs: budget.maxWallClockMs,
          cacheSystem: true,
          model: SCOUT_MODEL,
          // A tool-less Gemini answer to a "find live prices" prompt is a
          // fabricated price list with fabricated `verified` domains. Fail
          // instead. See allowFallback in _shared/llm.ts.
          allowFallback: false,
        });
        // "not configured" is the ONLY reason we know no request left the box —
        // callClaude checks the key before it fetches. A timeout or a 5xx may
        // well have been served and billed, so those settle, they do not
        // release.
        const neverCalled = !res.ok && res.reason === "not configured";
        return {
          value: res,
          neverCalled,
          usage: res.ok ? res.data?.usage : null,
          stopReason: res.ok ? res.data?.stop_reason : null,
          terminationReason: res.ok ? undefined : ("PROVIDER_ERROR" as const),
        };
      },
    );

    if (!guarded.admitted) {
      console.warn(`smart-scout: spend guard refused (${guarded.reason})`);
      return friendly(refusalMessage(guarded.reason), { blocked: guarded.reason });
    }
    const claudeRes = guarded.value;

    if (!claudeRes.ok) {
      const reason = claudeRes.reason ?? "";
      console.error("smart-scout callClaude failed:", reason);
      if (/timeout/i.test(reason))
        return friendly("scout took too long — try a more specific query 🐢");
      if (/http 429/.test(reason)) return friendly("rate limit hit — try again in a moment 🐢");
      if (/http 402/.test(reason))
        return friendly("AI credits exhausted — top up to keep scouting");
      if (/http 400/.test(reason))
        return friendly("AI credits exhausted — top up to keep scouting");
      return friendly(`scout glitched — try again`);
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
        console.error("smart-scout parse error", e, cleaned.slice(0, 400));
      }
    }
    if (!parsed || !Array.isArray(parsed.results)) {
      return friendly("scout couldn't structure the results — try a more specific query", {
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
    console.error("smart-scout error", e);
    return friendly("something went sideways — try again");
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
