/**
 * THE CAPABILITY REGISTRY — §7, §26. ONIQ's authorization, not the provider's.
 *
 * "OpenAI tools must be wrapped by ONIQ's capability authorization" is the
 * whole of this file. A model may ASK for any tool it likes; nothing runs
 * unless a registered entry permits it in the current execution mode. The
 * model's wish is an input to a decision, never the decision.
 *
 * EVERY TOOL DECLARES ITS COST BEFORE IT RUNS. §7's list is mandatory rather
 * than decorative: a tool with no declared side-effect level cannot be
 * registered, because the default a missing field would take is exactly the
 * one nobody chose.
 */
import { type ExecutionMode, type SideEffectLevel, mayExecute } from "./executionMode.ts";
import { type Provenance, type SourceKind } from "./provenance.ts";

export type ToolResult =
  | { readonly ok: true; readonly evidence: Provenance; readonly summary: string }
  | { readonly ok: false; readonly reason: string };

export type ToolSpec = {
  readonly name: string;
  readonly description: string;
  /** Argument names this tool understands. An unknown arg is refused. */
  readonly schema: readonly string[];
  readonly authorized: boolean;
  readonly sideEffect: SideEffectLevel;
  readonly reversible: boolean;
  readonly costUsd: number;
  readonly risk: number;
  readonly timeoutMs: number;
  /** What KIND of evidence a success produces. Drives §11's promotion. */
  readonly produces: SourceKind;
  readonly run: (args: Readonly<Record<string, string>>) => Promise<ToolResult>;
};

export type Refusal =
  "UNKNOWN_TOOL" | "UNAUTHORIZED" | "MODE_FORBIDS" | "UNKNOWN_ARGUMENT" | "DESTRUCTIVE_NEVER";

export type Decision =
  | { readonly allow: true; readonly spec: ToolSpec }
  | { readonly allow: false; readonly refusal: Refusal; readonly detail: string };

export type Registry = {
  readonly specs: readonly ToolSpec[];
};

/**
 * THE CHARSET EVERY MAINSTREAM PROVIDER ACCEPTS, and it is narrower than a
 * TypeScript identifier or a sensible-looking namespaced name.
 *
 * MEASURED 2026-09-12, the hard way: the first real benchmark run registered
 * tools as `db.job_counts` and BOTH models rejected the request before reading
 * a word of it —
 *
 *     HTTP 400 Invalid 'tools[0].name': string does not match pattern.
 *     Expected a string that matches the pattern '^[a-zA-Z0-9_-]+$'.
 *
 * The dot is the whole bug. A namespacing convention that reads perfectly in
 * this codebase is illegal on the wire, and nothing local could have caught it
 * because no local test ever sends the tool list anywhere.
 *
 * So the check moved to CONSTRUCTION. A registry built with an unusable name
 * now throws in the process that built it, naming the offender — rather than
 * surfacing hundreds of milliseconds later as a provider 400 that reads like
 * an outage. Underscores namespace fine: `db_job_counts`.
 */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function registry(specs: readonly ToolSpec[]): Registry {
  const names = new Set<string>();
  for (const s of specs) {
    if (!TOOL_NAME_PATTERN.test(s.name)) {
      throw new Error(
        `tool name ${JSON.stringify(s.name)} is not portable: it must match ${String(TOOL_NAME_PATTERN)}`,
      );
    }
    if (names.has(s.name)) throw new Error(`duplicate tool registered: ${s.name}`);
    names.add(s.name);
  }
  return { specs };
}

export function find(reg: Registry, name: string): ToolSpec | null {
  return reg.specs.find((s) => s.name === name) ?? null;
}

/**
 * THE GATE. Checked in a fixed order so a refusal always names the FIRST
 * reason rather than whichever check happened to run — the 2026-09-10 lesson
 * that a gate naming the wrong bound sends a reader to fix the wrong thing.
 */
export function decide(
  reg: Registry,
  mode: ExecutionMode,
  name: string,
  args: Readonly<Record<string, string>>,
): Decision {
  const spec = find(reg, name);
  if (!spec) return { allow: false, refusal: "UNKNOWN_TOOL", detail: `no tool named ${name}` };
  if (!spec.authorized) {
    return {
      allow: false,
      refusal: "UNAUTHORIZED",
      detail: `${name} is registered and not authorized`,
    };
  }
  if (spec.sideEffect === "DESTRUCTIVE") {
    return {
      allow: false,
      refusal: "DESTRUCTIVE_NEVER",
      detail: `${name} is destructive and this kernel has no authorized destructive path`,
    };
  }
  for (const k of Object.keys(args)) {
    if (!spec.schema.includes(k)) {
      return { allow: false, refusal: "UNKNOWN_ARGUMENT", detail: `${name} does not accept ${k}` };
    }
  }
  /**
   * AUTHORIZATION AND EXECUTION ARE DIFFERENT QUESTIONS, and conflating them
   * made the DRY_RUN branch below DEAD in the one case it exists for.
   *
   * The first draft refused here whenever `mayExecute` was false, which is
   * true of every side-effecting tool in DRY_RUN — so `invoke` could never
   * reach its own dry-run recording and a dry run of a write silently read as
   * a refusal. Caught by the test, not by reading: the branch looks correct
   * and is unreachable.
   *
   * So: everything above is authorization and is mode-independent. Mode
   * decides only whether an authorized call EXECUTES or is RECORDED, and the
   * one mode that refuses outright is OBSERVE.
   */
  if (mode === "OBSERVE" && !mayExecute(mode, spec.sideEffect)) {
    return {
      allow: false,
      refusal: "MODE_FORBIDS",
      detail: `${name} is ${spec.sideEffect} and the mode is ${mode}`,
    };
  }
  return { allow: true, spec };
}

export type Invocation = {
  readonly tool: string;
  readonly args: Readonly<Record<string, string>>;
  readonly outcome: "EXECUTED" | "DRY_RUN" | "REFUSED";
  readonly detail: string;
  readonly result: ToolResult | null;
};

/**
 * DRY_RUN RECORDS THE CALL AND DOES NOT MAKE IT — for anything with a side
 * effect. A read (NONE) still runs in DRY_RUN, deliberately: the point of a
 * dry run is to see what a plan WOULD do, and that is unknowable if the
 * kernel is blinded to the state it would read.
 */
export async function invoke(
  reg: Registry,
  mode: ExecutionMode,
  name: string,
  args: Readonly<Record<string, string>>,
): Promise<Invocation> {
  const d = decide(reg, mode, name, args);
  if (!d.allow) {
    return {
      tool: name,
      args,
      outcome: "REFUSED",
      detail: `${d.refusal}: ${d.detail}`,
      result: null,
    };
  }
  if (mode === "DRY_RUN" && d.spec.sideEffect !== "NONE") {
    return {
      tool: name,
      args,
      outcome: "DRY_RUN",
      detail: `would call ${name} (${d.spec.sideEffect}, reversible=${d.spec.reversible})`,
      result: null,
    };
  }
  const result = await d.spec.run(args);
  return {
    tool: name,
    args,
    outcome: "EXECUTED",
    detail: result.ok ? result.summary : `failed: ${result.reason}`,
    result,
  };
}
