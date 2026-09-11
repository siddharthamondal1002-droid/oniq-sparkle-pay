/**
 * A SPEND LEDGER STANDING IN FOR POSTGRES, and it records what it was asked.
 *
 * `makeEngine` now reaches a provider only through `withProviderSpendGuard`, so
 * every test that exercises a real model call needs an admitting ledger. The
 * lazy version of this helper would answer `{ ok: true }` to anything and let
 * the tests carry on — which would leave nothing asserting that the engine
 * consults the ledger AT ALL, and a later edit removing the guard would stay
 * green. So the double keeps its calls, and the tests assert against them.
 *
 * IT IS NOT A REIMPLEMENTATION OF THE CEILINGS. `admit_provider_spend` holds
 * row locks and makes the real decision; a second copy of that arithmetic here
 * would be a second source of truth that agrees with itself and drifts from
 * Postgres. What this answers is "admitted" or "refused", by a flag the test
 * sets — the ENGINE's behaviour under each is what is being checked.
 */
import type { ServiceRpc } from "../../../supabase/functions/_shared/financialLedger.ts";

export type LedgerCall = { readonly fn: string; readonly args: Record<string, unknown> };

export type LedgerDouble = {
  readonly rpc: ServiceRpc;
  readonly calls: LedgerCall[];
  /** Every `admit_provider_spend` the engine made, in order. */
  admissions: () => LedgerCall[];
  /** Every `settle_provider_spend`, so a test can read what was CHARGED. */
  settlements: () => LedgerCall[];
};

export function makeLedgerDouble(
  opts: { readonly admit?: boolean; readonly reason?: string } = {},
): LedgerDouble {
  const calls: LedgerCall[] = [];
  const admit = opts.admit ?? true;
  const rpc: ServiceRpc = async (fn, args) => {
    calls.push({ fn, args: args as Record<string, unknown> });
    if (fn === "admit_provider_spend") {
      return {
        data: admit
          ? { ok: true, attempt: 1, remainingUsd: 100 }
          : { ok: false, reason: opts.reason ?? "daily-cap" },
        error: null,
      };
    }
    // settle and release answer with no body, exactly as the real ones do.
    return { data: null, error: null };
  };
  return {
    rpc,
    calls,
    admissions: () => calls.filter((c) => c.fn === "admit_provider_spend"),
    settlements: () => calls.filter((c) => c.fn === "settle_provider_spend"),
  };
}
