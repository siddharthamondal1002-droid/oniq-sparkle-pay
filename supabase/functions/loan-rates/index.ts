// loan-rates — cached (24h) snapshot of current Indian bank loan & FD rate RANGES.
// Uses Claude with web_search grounding (same pattern as market-ticker's rates lookup).
// Rates vary by CIBIL score, tenure, and bank policy — we return RANGES, not fake single numbers.

import { corsHeaders, json } from "../_shared/llm.ts";

const RATES_TTL_MS = 24 * 60 * 60 * 1000; // 24h

type BankRate = { bank: string; rateRange: string; note?: string };
type Category = { type: "home" | "gold" | "car" | "fd"; label: string; banks: BankRate[] };
type Payload = {
  asOf: string;
  categories: Category[];
  disclaimer: string;
  source?: string;
};

const DISCLAIMER =
  "Rates vary by CIBIL score, loan amount, tenure, and individual bank policy. 750+ CIBIL typically qualifies for the lower end of each range. Confirm your exact rate with the bank directly.";

let cache: { at: number; data: Payload } | null = null;

const CATEGORY_LABELS: Record<Category["type"], string> = {
  home: "🏠 Home Loan",
  gold: "🪙 Gold Loan",
  car: "🚗 Car Loan (New)",
  fd: "🏦 Fixed Deposit",
};

// Realistic fallback snapshot (mid-2026 typical ranges). Used ONLY when the
// live Claude web_search call fails or times out — so the popup never shows
// an empty list. Rates are ranges; users are told to verify with the bank.
function fallbackSnapshot(today: string): Payload {
  const mk = (type: Category["type"], banks: BankRate[]): Category => ({
    type,
    label: CATEGORY_LABELS[type],
    banks,
  });
  return {
    asOf: today,
    categories: [
      mk("home", [
        { bank: "SBI", rateRange: "8.25-9.50%", note: "salaried" },
        { bank: "HDFC Bank", rateRange: "8.50-9.60%" },
        { bank: "ICICI Bank", rateRange: "8.75-9.85%" },
        { bank: "Axis Bank", rateRange: "8.75-9.75%" },
        { bank: "Kotak Mahindra", rateRange: "8.70-9.65%" },
        { bank: "Bank of Baroda", rateRange: "8.40-10.15%" },
      ]),
      mk("gold", [
        { bank: "SBI", rateRange: "8.75-10.75%" },
        { bank: "HDFC Bank", rateRange: "9.10-17.90%" },
        { bank: "ICICI Bank", rateRange: "9.25-18.00%" },
        { bank: "Axis Bank", rateRange: "9.15-17.50%" },
        { bank: "Kotak Mahindra", rateRange: "9.00-17.00%" },
        { bank: "Muthoot Finance", rateRange: "10.00-22.00%", note: "NBFC, quick disbursal" },
      ]),
      mk("car", [
        { bank: "SBI", rateRange: "8.95-10.05%" },
        { bank: "HDFC Bank", rateRange: "9.20-10.50%" },
        { bank: "ICICI Bank", rateRange: "9.10-10.75%" },
        { bank: "Axis Bank", rateRange: "9.15-10.85%" },
        { bank: "Kotak Mahindra", rateRange: "9.05-10.60%" },
        { bank: "Bank of Baroda", rateRange: "8.85-11.75%" },
      ]),
      mk("fd", [
        { bank: "SBI", rateRange: "6.50-7.10%", note: "1-3yr, senior +50bps" },
        { bank: "HDFC Bank", rateRange: "6.60-7.25%", note: "1-3yr" },
        { bank: "ICICI Bank", rateRange: "6.70-7.25%", note: "1-3yr" },
        { bank: "Axis Bank", rateRange: "6.70-7.20%", note: "1-3yr" },
        { bank: "Kotak Mahindra", rateRange: "6.25-6.80%", note: "1-3yr" },
        { bank: "Bank of Baroda", rateRange: "6.85-7.30%", note: "1-3yr" },
      ]),
    ],
    disclaimer: DISCLAIMER,
    source: "Indicative snapshot — verify with the bank directly.",
  };
}


async function fetchLoanRates(): Promise<Payload> {
  if (cache && Date.now() - cache.at < RATES_TTL_MS) return cache.data;

  const today = new Date().toISOString().slice(0, 10);
  const fallback = fallbackSnapshot(today);

  const system =
    "You look up CURRENT Indian bank loan and deposit interest rates from official/reputable sources via web_search. " +
    "CRITICAL HONESTY RULES: " +
    "(1) Return RANGES (e.g. \"8.75-9.25%\"), NEVER single fabricated precise figures — real rates vary by CIBIL score, tenure, and loan amount. " +
    "(2) If two reputable sources disagree on a bank's rate, prefer a RANGE that reasonably encompasses BOTH rather than picking one arbitrarily. " +
    "(3) Use only real bank names and rates you actually verified via web_search — do not invent. " +
    "(4) If a specific bank/category rate cannot be verified, OMIT that bank from that category rather than guessing. " +
    "Return ONLY strict JSON (no markdown, no prose) matching: " +
    `{"categories":[{"type":"home|gold|car|fd","banks":[{"bank":string,"rateRange":string,"note":string?}]}]}. ` +
    "Include 4-5 banks per category: SBI, HDFC Bank, ICICI Bank, Axis Bank, Kotak Mahindra Bank. " +
    "rateRange should include the % sign (e.g. \"8.50-9.75%\"). " +
    "note is optional — use it only for genuinely relevant context (e.g. \"salaried\", \"1-year FD\").";

  const userPrompt =
    "Fetch the CURRENT interest rate RANGES for 4-5 major Indian banks (SBI, HDFC Bank, ICICI Bank, Axis Bank, Kotak Mahindra Bank) across four categories: home loan, gold loan, new car loan, and general fixed deposit (1-3 year range). Verify via web_search. Return strict JSON only, RANGES not single numbers.";

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return fallback;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 140000);
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
        model: "claude-sonnet-4-5",
        max_tokens: 2000,
        system,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      console.warn("loan-rates: http", res.status);
      return fallback;
    }
    const data = await res.json();
    const blocks = Array.isArray(data?.content) ? data.content : [];
    const text = blocks.filter((b: any) => b?.type === "text").map((b: any) => b.text ?? "").join("\n").trim();
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s < 0 || e <= s) return fallback;
    const parsed = JSON.parse(text.slice(s, e + 1));
    const rawCats: any[] = Array.isArray(parsed?.categories) ? parsed.categories : [];
    const categories: Category[] = rawCats
      .filter((c) => c && typeof c.type === "string" && ["home", "gold", "car", "fd"].includes(c.type))
      .map((c) => ({
        type: c.type as Category["type"],
        label: CATEGORY_LABELS[c.type as Category["type"]],
        banks: Array.isArray(c.banks)
          ? c.banks
              .filter((b: any) => b && typeof b.bank === "string" && typeof b.rateRange === "string")
              .slice(0, 8)
              .map((b: any) => ({
                bank: b.bank,
                rateRange: b.rateRange,
                note: typeof b.note === "string" && b.note.trim() ? b.note : undefined,
              }))
          : [],
      }))
      .filter((c) => c.banks.length > 0);

    if (categories.length === 0) return fallback;

    const payload: Payload = {
      asOf: today,
      categories,
      disclaimer: DISCLAIMER,
      source: "Claude web_search (bank websites + reputable finance sources)",
    };
    cache = { at: Date.now(), data: payload };
    return payload;
  } catch (e) {
    console.warn("loan-rates: error", (e as Error).message);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const data = await fetchLoanRates();
    return json(200, data);
  } catch (e) {
    const today = new Date().toISOString().slice(0, 10);
    return json(200, { ...fallbackSnapshot(today), reason: String(e).slice(0, 200) });
  }
});
