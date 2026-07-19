// market-ticker — live gold/silver spot (INR/gram) + cached RBI repo + bank home-loan rates.
// Commodities: gold-api.com (XAU/XAG in USD/oz) + open.er-api.com (USD→INR). ~20 min cache.
// Rates: Claude with web_search grounding. 24h cache (repo rate + bank rates change rarely).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TROY_OZ_G = 31.1034768;
const COMMODITY_TTL_MS = 20 * 60 * 1000; // 20 min
const RATES_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

type Commodity = { pricePerGram: number; currency: "INR" } | null;
type BankRate = { bank: string; rate: number; type: string };
type RatesPayload = {
  repoRate: { value: number; asOf: string } | null;
  bankRates: BankRate[];
  asOf: string;
};

let commodityCache: {
  at: number;
  gold: Commodity;
  silver: Commodity;
  usdInr: number | null;
  source: string;
} | null = null;
let ratesCache: { at: number; data: RatesPayload } | null = null;

async function fetchJson(url: string, timeoutMs = 6000): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ONIQ-Ticker/1.0)" },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Scrape IBJA (India Bullion and Jewellers Association) — India's benchmark
// gold/silver rates used by RBI/Ministry of Finance. Gold 999 published per
// 10g; Silver 999 per kg. Returns INR per gram or null on failure.
async function fetchIbja(): Promise<{ gold: number | null; silver: number | null }> {
  const html = await fetchText("https://ibjarates.com/");
  if (!html) return { gold: null, silver: null };
  // Find the first (latest) row with data-label attributes.
  const goldMatch = html.match(/data-label=["']Gold 999["'][^>]*>\s*([\d,]+)/);
  const silverMatch = html.match(/data-label=["']Silver 999["'][^>]*>\s*([\d,]+)/);
  const parseNum = (s: string | undefined) => {
    if (!s) return null;
    const n = Number(s.replace(/,/g, "").trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const gold10g = parseNum(goldMatch?.[1]);
  const silverKg = parseNum(silverMatch?.[1]);
  return {
    gold: gold10g != null ? gold10g / 10 : null,
    silver: silverKg != null ? silverKg / 1000 : null,
  };
}

// Retail adjustment applied to international spot when IBJA is unavailable:
// ~10% import duty (customs+AIDC) + 3% GST + ~5% dealer/making margin ≈ 18%.
// This is an approximation, clearly labeled in the response `source`.
const INDIA_RETAIL_ADJUST = 1.18;

async function fetchCommodities() {
  if (commodityCache && Date.now() - commodityCache.at < COMMODITY_TTL_MS) return commodityCache;

  // Primary: IBJA (real India benchmark rate).
  const ibja = await fetchIbja();

  // Fetch spot in parallel — used as fallback and to keep usdInr fresh.
  const [xau, xag, fx] = await Promise.all([
    fetchJson("https://api.gold-api.com/price/XAU"),
    fetchJson("https://api.gold-api.com/price/XAG"),
    fetchJson("https://open.er-api.com/v6/latest/USD"),
  ]);
  const usdInr: number | null = typeof fx?.rates?.INR === "number" ? fx.rates.INR : null;
  const spotInrPerGram = (usdPerOz: number | undefined) =>
    typeof usdPerOz === "number" && usdInr ? (usdPerOz * usdInr) / TROY_OZ_G : null;

  let goldPg: number | null = ibja.gold;
  let silverPg: number | null = ibja.silver;
  let source = "IBJA (India Bullion and Jewellers Association) — India benchmark rate";

  if (goldPg == null || silverPg == null) {
    // Fallback: international spot × 1.18 (import duty + GST + margin approximation).
    const goldSpot = spotInrPerGram(xau?.price);
    const silverSpot = spotInrPerGram(xag?.price);
    if (goldPg == null && goldSpot) goldPg = goldSpot * INDIA_RETAIL_ADJUST;
    if (silverPg == null && silverSpot) silverPg = silverSpot * INDIA_RETAIL_ADJUST;
    source =
      ibja.gold || ibja.silver
        ? "IBJA (partial) + spot×1.18 approximation for missing metal"
        : "International spot (gold-api.com) × 1.18 approximation (import duty + GST + retail margin) — IBJA unavailable";
  }

  const gold: Commodity = goldPg ? { pricePerGram: Math.round(goldPg), currency: "INR" } : null;
  const silver: Commodity = silverPg ? { pricePerGram: Math.round(silverPg * 100) / 100, currency: "INR" } : null;
  commodityCache = { at: Date.now(), gold, silver, usdInr, source };
  return commodityCache;
}


async function fetchRates(): Promise<RatesPayload> {
  if (ratesCache && Date.now() - ratesCache.at < RATES_TTL_MS) return ratesCache.data;
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  const empty: RatesPayload = { repoRate: null, bankRates: [], asOf: new Date().toISOString().slice(0, 10) };
  if (!key) return empty;

  const system =
    "You look up factual, current Indian interest rates from official/reputable sources. " +
    "Return ONLY strict JSON (no markdown, no prose) matching: " +
    `{"repoRate":{"value":number,"asOf":"YYYY-MM-DD"},"bankRates":[{"bank":string,"rate":number,"type":string}]}. ` +
    "rate = starting/lowest advertised annual %. type = 'home loan' or similar short label. " +
    "Pick 3 major Indian banks (e.g. SBI, HDFC, ICICI). Verify via web_search before answering.";

  const userPrompt =
    "Fetch the CURRENT RBI repo rate (last MPC decision) and the current starting home loan interest rates from 3 major Indian banks (SBI, HDFC, ICICI preferred). Return strict JSON only.";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        system,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      console.warn("market-ticker: rates http", res.status);
      return empty;
    }
    const data = await res.json();
    const blocks = Array.isArray(data?.content) ? data.content : [];
    const text = blocks.filter((b: any) => b?.type === "text").map((b: any) => b.text ?? "").join("\n").trim();
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s < 0 || e <= s) return empty;
    const parsed = JSON.parse(text.slice(s, e + 1));
    const today = new Date().toISOString().slice(0, 10);
    const payload: RatesPayload = {
      repoRate: parsed?.repoRate && typeof parsed.repoRate.value === "number"
        ? { value: parsed.repoRate.value, asOf: String(parsed.repoRate.asOf ?? today) }
        : null,
      bankRates: Array.isArray(parsed?.bankRates)
        ? parsed.bankRates
            .filter((b: any) => b && typeof b.rate === "number" && typeof b.bank === "string")
            .slice(0, 4)
            .map((b: any) => ({ bank: b.bank, rate: b.rate, type: String(b.type ?? "home loan") }))
        : [],
      asOf: today,
    };
    ratesCache = { at: Date.now(), data: payload };
    return payload;
  } catch (e) {
    console.warn("market-ticker: rates error", (e as Error).message);
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const [commodities, rates] = await Promise.all([fetchCommodities(), fetchRates()]);
    const body = {
      gold: commodities.gold,
      silver: commodities.silver,
      repoRate: rates.repoRate,
      bankRates: rates.bankRates,
      source: {
        commodities: "gold-api.com + open.er-api.com",
        rates: "Claude web_search (RBI + bank sites)",
      },
      lastUpdated: new Date().toISOString(),
    };
    return new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ gold: null, silver: null, repoRate: null, bankRates: [], error: String(e) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
