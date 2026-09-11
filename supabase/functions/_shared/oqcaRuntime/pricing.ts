/**
 * THE PRICE BOUNDARY — brief section 21.
 *
 * "If price is unknown: REFUSE. Never: unknown -> 0. Never allow: unknown cost
 * -> execute." Every function here returns `null` for a model it cannot price,
 * and `null` is what `wouldBreach` turns into the `unpriced` bound.
 *
 * IT ADDS NO RATE TABLE. `searchBudget.ts` already holds ONIQ's published
 * rates, already returns null for an id it does not know, and is already what
 * `financialLedger` settles against — a second table is a second thing to keep
 * in step with a vendor's pricing page, and this repo has the receipt for what
 * two copies of a number cost.
 */
import {
  MODEL_RATES,
  actualUsdFromUsage,
  estimateSearchUsd,
  readUsage,
  type ProviderUsage,
} from "../searchBudget.ts";

/**
 * Characters per token, as a BOUND rather than an estimate.
 *
 * Anthropic's own guidance is ~4 characters per token for English; a prompt
 * that is mostly punctuation, JSON or a non-Latin script runs denser than that.
 * 3 is the conservative direction — it prices a prompt HIGHER, so the gate
 * refuses sooner rather than later. Being wrong cheaply is the safe way to be
 * wrong about a spend ceiling.
 */
export const CHARS_PER_TOKEN = 3;

export function boundedInputTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Is this an id ONIQ has published rates for? */
export function isPriced(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODEL_RATES, model);
}

/**
 * What a call is expected to cost, or null when the id is unpriced.
 *
 * No searches: this loop's engine is `callText` without server tools, so a
 * search count would be a number invented to fill a field.
 */
export function estimateUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (!isPriced(model)) return null;
  return estimateSearchUsd({ model, searches: 0, inputTokens, outputTokens });
}

/**
 * What a call ACTUALLY cost, from what the provider reported.
 *
 * THE ANSWERER IS NOT ALWAYS THE MODEL THAT WAS PRICED. `callText` tries Gemini
 * direct and catches with Claude, so a run priced against the standard id can
 * be answered by either engine — and the HEAVY tier's id,
 * `gemini-3.1-pro-preview`, is genuinely absent from `MODEL_RATES`. So this
 * returns null there, and the caller must fall back to the ESTIMATE rather
 * than to zero. That is exactly what `financialLedger` does with the same null
 * ("a null here means unknown, and the ledger then charges the ESTIMATE, never
 * zero"), and it is why the estimate is retained after the call rather than
 * discarded.
 *
 * UNTIL 2026-09-11 THIS RETURNED NULL ON EVERY GEMINI CALL, AND NOT FOR THAT
 * REASON. `translateGeminiResponseToAnthropic` stamped every reply with the
 * constant `gemini-fallback/gemini-3.6-flash` whatever model was called, so no
 * Gemini answer was ever priceable and the estimate was charged for all of
 * them — 4.7x the real figure on the first measured OQCA tap. The label is now
 * the id that was called, so the standard path prices for real and this null
 * means what it says.
 */
export function actualUsd(model: string, usage: ProviderUsage | null | undefined): number | null {
  return actualUsdFromUsage(model, readUsage(usage));
}

/** Token counts as the provider reported them. Missing fields are 0 COUNTS. */
export function measuredTokens(usage: ProviderUsage | null | undefined): {
  inputTokens: number;
  outputTokens: number;
} {
  const m = readUsage(usage);
  return { inputTokens: m.inputTokens, outputTokens: m.outputTokens };
}
