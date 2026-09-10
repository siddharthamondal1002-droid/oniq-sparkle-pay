/**
 * THE QUANTUM SECURITY AND SPEND BOUNDARY — quantum brief §21.
 *
 *   "Quantum adapters must not introduce: network access, credentials,
 *    automatic cloud QPU calls, unbounded spend."
 *   "Default: remoteQuantumExecution = false, maxQuantumCostUsd = 0"
 *
 * BOTH DEFAULTS ARE THE BRIEF'S OWN NUMBERS, and they are refusing defaults for
 * the reason every other zero in this repo is: `health_config.ai_daily_cap_house`
 * shipped as 0, `maxToolCalls`/`maxTokens`/`maxCostUsd` ship as 0, and what a
 * system may spend is the owner's decision under CLAUDE.md's first rule — never
 * a constant an agent picked.
 *
 * THE POLICY IS A VALUE, NOT AN ENVIRONMENT READ. `security.test.ts` walks this
 * tree and admits no `Deno.` or `process.env`; a caller that wants a different
 * policy constructs one and passes it, which also means a test can prove the
 * refusal rather than mutating global state.
 */

export type QuantumPolicy = {
  /** May any adapter reach a network at all? */
  readonly remoteQuantumExecution: boolean;
  /** Dollars this run may spend on quantum execution. */
  readonly maxQuantumCostUsd: number;
  /** Qubit ceiling for the local simulator — memory is 2^n complex amplitudes. */
  readonly maxSimulatedQubits: number;
  /** Shot ceiling, so a sampling loop cannot run unbounded. */
  readonly maxShots: number;
};

/**
 * `maxSimulatedQubits: 14` is 16,384 amplitudes — a few hundred kilobytes, and
 * matrices up to 16384² for the dense path. It is a RUNAWAY guard rather than a
 * spend guard, so unlike the two money fields it is deliberately non-zero:
 * v1.2's `maxExecutionTimeMs: 0` lesson says a bound that fails DEAD gets raised
 * wholesale, taking the real money bounds with it.
 */
export const DEFAULT_QUANTUM_POLICY: QuantumPolicy = {
  remoteQuantumExecution: false,
  maxQuantumCostUsd: 0,
  maxSimulatedQubits: 14,
  maxShots: 100_000,
};

export type QuantumRefusal =
  | "remote_execution_disabled"
  | "cost_budget_zero"
  | "cost_budget_exceeded"
  | "too_many_qubits"
  | "too_many_shots"
  | "adapter_unavailable";

export type PolicyCheck =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: QuantumRefusal };

const ALLOW: PolicyCheck = { allowed: true };
const deny = (reason: QuantumRefusal): PolicyCheck => ({ allowed: false, reason });

/**
 * THE REMOTE GATE. Two independent refusals, checked in this order, and the
 * order is the point: a caller who flipped `remoteQuantumExecution` to true
 * without also funding it is refused on COST, which names the thing they still
 * have to decide. A single combined check would say "remote disabled" and send
 * them to change the flag they already changed.
 */
export function checkRemote(policy: QuantumPolicy, estimatedUsd: number): PolicyCheck {
  if (!policy.remoteQuantumExecution) return deny("remote_execution_disabled");
  if (policy.maxQuantumCostUsd <= 0) return deny("cost_budget_zero");
  if (estimatedUsd > policy.maxQuantumCostUsd) return deny("cost_budget_exceeded");
  return ALLOW;
}

export function checkLocal(policy: QuantumPolicy, qubits: number, shots: number): PolicyCheck {
  if (qubits > policy.maxSimulatedQubits) return deny("too_many_qubits");
  if (shots > policy.maxShots) return deny("too_many_shots");
  return ALLOW;
}

export const REFUSAL_TEXT: Readonly<Record<QuantumRefusal, string>> = {
  remote_execution_disabled:
    "remote quantum execution is disabled by policy (§21 default); no QPU vendor is configured",
  cost_budget_zero:
    "maxQuantumCostUsd is 0, which means refuse — the owner has set no quantum budget",
  cost_budget_exceeded: "the estimated cost exceeds maxQuantumCostUsd",
  too_many_qubits: "the local statevector simulator's qubit bound was exceeded",
  too_many_shots: "the shot bound was exceeded",
  adapter_unavailable: "this adapter needs a library that is not a dependency of ONIQ",
};
