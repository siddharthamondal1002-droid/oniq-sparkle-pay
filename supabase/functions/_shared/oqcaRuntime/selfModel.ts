/**
 * OQCA v1.7 — WHAT ONIQ IS ALLOWED TO DO TO ONIQ. Owner directive 2026-09-11 §12.
 *
 * The directive's boundary, in its own words: _"The autonomy kernel must NOT
 * gain arbitrary code execution. Do not give it: arbitrary shell, arbitrary
 * downloaded code, arbitrary production mutation. Instead expose registered
 * capabilities… Only capabilities explicitly registered and authorized may
 * execute."_
 *
 * THE GUARANTEE IS STRUCTURAL, NOT A CHECK. `CapabilityRequest` carries an id
 * from a CLOSED UNION and a bounded `args` record of strings — there is no
 * command field, no path field, no script field and no url field, so there is
 * no shape in which a caller could express "run this". A guard that scanned a
 * command string for dangerous words would be a blocklist, and the health red
 * team's finding was that a blocklist is what gets walked past; an id that must
 * already be in a table cannot be walked past at all.
 *
 * AND REGISTERED IS NOT AUTHORIZED. Both are required, separately, because they
 * fail differently: an unregistered id is a bug in the caller, an unauthorized
 * one is a decision somebody made. Collapsing them would report a policy
 * refusal as a typo. `authorized: false` is the shipped state for everything
 * that writes anywhere but ONIQ's own knowledge — see the table.
 *
 * NOTHING HERE READS A CLOCK, OPENS A SOCKET OR TOUCHES A DISK. The executor is
 * a seam with a refusing default, exactly like every other in this runtime.
 */
import type { Capability, CapabilityState } from "../oqca/loop/capability.ts";

/** §12's list, verbatim and closed. A tenth member is a deliberate change. */
export type RegisteredCapabilityId =
  | "RUN_TEST_SUITE"
  | "RUN_BENCHMARK"
  | "RUN_STATIC_ANALYSIS"
  | "RUN_MUTATION_TEST"
  | "UPDATE_KNOWLEDGE"
  | "UPDATE_CONFIGURATION"
  | "CREATE_EXPERIMENT"
  | "REBUILD_ARTIFACT"
  | "REQUEST_RESEARCH";

export type RegisteredCapability = {
  readonly id: RegisteredCapabilityId;
  /**
   * Which of the v1.6 ledger's four RESOURCE kinds this consumes. That ledger
   * is what `reconsider` reads, so a capability that named no resource could be
   * blocked and never reconsidered.
   */
  readonly resource: Capability;
  /** Can the effect be undone without a person? Read by PLAN, never guessed. */
  readonly reversible: boolean;
  /** Does it write anywhere a user could see? Shadow mode gates on this. */
  readonly touchesProduction: boolean;
  /**
   * May this build execute it AT ALL. False is the shipped state for everything
   * that writes outside ONIQ's own knowledge store — a self-improvement loop
   * that could rebuild an artifact or edit configuration unattended is §28's
   * self-modification, which the 2026-09-10 directive put behind a separate
   * gate and this one does not open.
   */
  readonly authorized: boolean;
  readonly describe: string;
};

/**
 * THE REGISTRY. Three are authorized and six are not, and the split is the
 * whole safety argument rather than a default anybody picked.
 *
 * What is ON is what can only READ, plus the one write that goes into ONIQ's
 * own knowledge store: running a test suite, a static analysis or a knowledge
 * update changes nothing a user can see and nothing a person would have to undo.
 *
 * What is OFF: a benchmark and a mutation run are not dangerous, they are
 * EXPENSIVE — minutes of CPU per call, unattended, on a schedule — and what a
 * scheduled job may spend is the owner's under CLAUDE.md's first rule, the same
 * reason `maxCostUsd` ships at 0. `UPDATE_CONFIGURATION` and `REBUILD_ARTIFACT`
 * write to things people depend on. `CREATE_EXPERIMENT` would let the loop add
 * work to its own future. `REQUEST_RESEARCH` reaches a provider that spends.
 */
export const CAPABILITY_REGISTRY: readonly RegisteredCapability[] = [
  {
    id: "RUN_TEST_SUITE",
    resource: "verification",
    reversible: true,
    touchesProduction: false,
    authorized: true,
    describe: "run the repository's own test suite and report pass/fail counts",
  },
  {
    id: "RUN_STATIC_ANALYSIS",
    resource: "verification",
    reversible: true,
    touchesProduction: false,
    authorized: true,
    describe: "run the repository's own typecheck and lint gate and report counts",
  },
  {
    id: "UPDATE_KNOWLEDGE",
    resource: "verification",
    reversible: true,
    touchesProduction: false,
    authorized: true,
    describe: "write a promoted record to ONIQ's durable knowledge store",
  },
  {
    id: "RUN_BENCHMARK",
    resource: "tool",
    reversible: true,
    touchesProduction: false,
    authorized: false,
    describe: "run a benchmark family; minutes of CPU per call, so it is a spend decision",
  },
  {
    id: "RUN_MUTATION_TEST",
    resource: "tool",
    reversible: true,
    touchesProduction: false,
    authorized: false,
    describe: "run the mutation script; minutes of CPU per call, so it is a spend decision",
  },
  {
    id: "CREATE_EXPERIMENT",
    resource: "tool",
    reversible: true,
    touchesProduction: false,
    authorized: false,
    describe: "add a standing experiment the loop would run on later cycles",
  },
  {
    id: "UPDATE_CONFIGURATION",
    resource: "tool",
    reversible: false,
    touchesProduction: true,
    authorized: false,
    describe: "change a value a running system reads",
  },
  {
    id: "REBUILD_ARTIFACT",
    resource: "tool",
    reversible: false,
    touchesProduction: true,
    authorized: false,
    describe: "rebuild something other code or a person depends on",
  },
  {
    id: "REQUEST_RESEARCH",
    resource: "research",
    reversible: true,
    touchesProduction: false,
    authorized: false,
    describe: "ask an external provider a question; spends money per call",
  },
];

const BY_ID = new Map(CAPABILITY_REGISTRY.map((c) => [c.id, c] as const));

export function registeredCapability(id: string): RegisteredCapability | null {
  return BY_ID.get(id as RegisteredCapabilityId) ?? null;
}

export function isRegistered(id: string): boolean {
  return BY_ID.has(id as RegisteredCapabilityId);
}

/**
 * WHAT THE REGISTRY ALREADY KNOWS WITHOUT ATTEMPTING ANYTHING, and why the
 * planner has to be told it.
 *
 * The v1.6 ledger learns a capability's state by OBSERVING an episode use it.
 * That works for an allowance or a provider outage — something is attempted and
 * refused. It cannot work for an UNAUTHORIZED capability, and the failure is a
 * closed loop: nothing may attempt it, so nothing observes it, so the ledger
 * stays silent about it forever, so `planningFor` sees an unknown resource and
 * scores the objective at the floor, so it is never selected, so nothing
 * attempts it. Measured on the 2026-09-11 story-dispatch outage, which sat at
 * `cap=0.00` with an EMPTY ledger and came 14th of 18.
 *
 * Authorization is not something to discover by trying — it is a column in the
 * table above, true before any episode runs. So the host reports it, in the
 * ledger's own vocabulary, and the runtime merges it UNDER anything an episode
 * actually observed: a real observation always beats this derivation.
 *
 * A kind is only claimed `unauthorized` when NO registered capability using it
 * is authorized. `verification` has three authorized members, so it is absent
 * here and must still be observed — "absent is not available" (v1.6), and a
 * host asserting `available` from a table would be fabricating an observation.
 */
export function registryCapabilityStates(): readonly CapabilityState[] {
  const byResource = new Map<Capability, RegisteredCapability[]>();
  for (const cap of CAPABILITY_REGISTRY) {
    const list = byResource.get(cap.resource) ?? [];
    list.push(cap);
    byResource.set(cap.resource, list);
  }
  const out: CapabilityState[] = [];
  for (const [resource, caps] of [...byResource].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (caps.some((c) => c.authorized)) continue;
    out.push({
      capability: resource,
      availability: "unauthorized",
      detail: `no ${resource} capability is authorized in this build: ${caps
        .map((c) => c.id)
        .sort()
        .join(", ")}`,
      // An authorization refusal has no bound to name — naming one would send
      // whoever reads the log to raise a number that would not help.
      bound: null,
      station: null,
    });
  }
  return out;
}

/** The RESOURCE kinds a set of registered ids would consume, deduped. */
export function resourcesFor(ids: readonly string[]): readonly Capability[] {
  const out = new Set<Capability>();
  for (const id of ids) {
    const c = registeredCapability(id);
    if (c) out.add(c.resource);
  }
  return [...out].sort();
}

/**
 * WHAT A CALLER MAY SAY, AND IT IS DELIBERATELY ALMOST NOTHING. An id from the
 * closed union and up to `MAX_ARGS` short string pairs, whose meaning is the
 * EXECUTOR's to interpret. No command, no path, no script, no url — see the
 * header. `args` exists so a test-suite run can name a glob the host recognises,
 * not so a caller can hand over a shell fragment, and the host is free to
 * refuse any key it does not know.
 */
export const MAX_ARGS = 8;
export const MAX_ARG_LENGTH = 200;

export type CapabilityRequest = {
  readonly id: RegisteredCapabilityId;
  readonly args: Readonly<Record<string, string>>;
};

export type CapabilityResult =
  | {
      readonly ok: true;
      /** What the capability MEASURED, when it measured anything. */
      readonly value: number | null;
      readonly unit: string;
      readonly detail: string;
    }
  | { readonly ok: false; readonly reason: string };

export type CapabilityExecutor = (req: CapabilityRequest) => Promise<CapabilityResult>;

/** Executes nothing and SAYS SO. The default for a runtime with no host. */
export const NO_EXECUTOR: CapabilityExecutor = async (req) => ({
  ok: false,
  reason: `no executor is wired to this runtime: ${req.id} did not run`,
});

/**
 * THE ONE DOOR. Registration, authorization and argument bounds are all checked
 * HERE, before the executor is reached, so a host that forgets to check is still
 * safe and a refusal always names which of the three failed.
 */
export async function executeCapability(
  req: CapabilityRequest,
  executor: CapabilityExecutor = NO_EXECUTOR,
): Promise<CapabilityResult> {
  const cap = registeredCapability(req.id);
  if (!cap) return { ok: false, reason: `${String(req.id)} is not a registered capability` };
  if (!cap.authorized) {
    return { ok: false, reason: `${cap.id} is registered but NOT authorized in this build` };
  }
  const keys = Object.keys(req.args);
  if (keys.length > MAX_ARGS) {
    return { ok: false, reason: `${cap.id}: ${keys.length} arguments exceeds ${MAX_ARGS}` };
  }
  for (const k of keys) {
    const v = req.args[k];
    if (typeof v !== "string" || v.length > MAX_ARG_LENGTH) {
      return { ok: false, reason: `${cap.id}: argument ${k} is not a bounded string` };
    }
  }
  return await executor(req);
}
