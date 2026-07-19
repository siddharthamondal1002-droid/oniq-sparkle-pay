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

let commodityCache: { at: number; gold: Commodity; silver: Commodity; usdInr: number | null } | null = null;
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

async function fetchCommodities() {
  if (commodityCache && Date.now() - commodityCache.at < COMMODITY_TTL_MS) return commodityCache;
  const [xau, xag, fx] = await Promise.all([
    fetchJson("https://api.gold-api.com/price/XAU"),
    fetchJson("https://api.gold-api.com/price/XAG"),
    fetchJson("https://open.er-api.com/v6/latest/USD"),
  ]);
  const usdInr: number | null = typeof fx?.rates?.INR === "number" ? fx.rates.INR : null;
  const toInrPerGram = (usdPerOz: number | undefined) =>
    typeof usdPerOz === "number" && usdInr ? (usdPerOz * usdInr) / TROY_OZ_G : null;
  const goldPg = toInrPerGram(xau?.price);
  const silverPg = toInrPerGram(xag?.price);
  const gold: Commodity = goldPg ? { pricePerGram: Math.round(goldPg), currency: "INR" } : null;
  const silver: Commodity = silverPg ? { pricePerGram: Math.round(silverPg * 100) / 100, currency: "INR" } : null;
  commodityCache = { at: Date.now(), gold, silver, usdInr };
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
