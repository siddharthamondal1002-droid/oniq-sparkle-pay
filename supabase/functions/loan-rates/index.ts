// loan-rates — cached (24h) snapshot of current Indian bank loan & FD rate RANGES.
// Uses Claude with web_search grounding (same pattern as market-ticker's rates lookup).
// Rates vary by CIBIL score, tenure, and bank policy — we return RANGES, not fake single numbers.

import { callClaude, corsHeaders, json } from "../_shared/llm.ts";

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

async function fetchLoanRates(): Promise<Payload> {
  if (cache && Date.now() - cache.at < RATES_TTL_MS) return cache.data;

  const today = new Date().toISOString().slice(0, 10);
  const empty: Payload = { asOf: today, categories: [], disclaimer: DISCLAIMER };

  const system =
    "You look up CURRENT Indian bank loan and deposit interest rates from official/reputable sources via web_search. " +
    "CRITICAL HONESTY RULES: " +
    "(1) Return RANGES (e.g. \"8.75-9.25%\"), NEVER single fabricated precise figures — real rates vary by CIBIL score, tenure, and loan amount. " +
    "(2) If two reputable sources disagree on a bank's rate, prefer a RANGE that reasonably encompasses BOTH rather than picking one arbitrarily. " +
    "(3) Use only real bank names and rates you actually verified via web_search — do not invent. " +
    "(4) If a specific bank/category rate cannot be verified, OMIT that bank from that category rather than guessing. " +
    "Return ONLY strict JSON (no markdown, no prose) matching: " +
    `{"categories":[{"type":"home|gold|car|fd","banks":[{"bank":string,"rateRange":string,"note":string?}]}]}. ` +
    "Include the same 5-6 banks across categories where possible: SBI, HDFC Bank, ICICI Bank, Axis Bank, Kotak Mahindra Bank, and one more (Bank of Baroda or PNB). " +
    "rateRange should include the % sign (e.g. \"8.50-9.75%\"). " +
    "note is optional — use it only for genuinely relevant context (e.g. \"women borrowers\", \"salaried\", \"1-year FD\").";

  const userPrompt =
    "Fetch the CURRENT interest rate RANGES for 5-6 major Indian banks (SBI, HDFC Bank, ICICI Bank, Axis Bank, Kotak Mahindra Bank, plus one more) across these four categories: home loan, gold loan, new car loan, and general fixed deposit (1-3 year range). Verify each via web_search. Return strict JSON only, RANGES not single numbers.";

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return empty;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
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
        max_tokens: 2500,
        system,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      console.warn("loan-rates: http", res.status);
      return empty;
    }
    const data = await res.json();
    const blocks = Array.isArray(data?.content) ? data.content : [];
    const text = blocks.filter((b: any) => b?.type === "text").map((b: any) => b.text ?? "").join("\n").trim();
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s < 0 || e <= s) return empty;
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
    return empty;
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
    return json(200, {
      asOf: new Date().toISOString().slice(0, 10),
      categories: [],
      disclaimer: DISCLAIMER,
      reason: String(e).slice(0, 200),
    });
  }
});
