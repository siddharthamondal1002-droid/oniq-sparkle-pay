/**
 * OQCA v1.7 — ONIQ LOOKING AT ONIQ. Owner directive 2026-09-11 §2 and §3.
 *
 * §2: _"The system must discover the actual current architecture from available
 * evidence. Do not hard-code assumptions about files or modules."_ So there is
 * NO file list in this file, no module names and no thresholds about particular
 * subsystems. The host reads whatever it can actually read and hands back
 * `EvidenceItem`s; this turns them into `Observation`s and nothing else. Change
 * what the host can see and ONIQ's picture of itself changes with it — which is
 * also what the HARD RULE demands, because a hard-coded subject list here would
 * make every generated objective a fact about this file.
 *
 * §3: _"Do not treat 'no observation' as 'healthy.' Use OBSERVED / UNOBSERVED /
 * UNKNOWN as distinct states."_ That is `completeObservations`' job and this
 * file feeds it: an observer that answers three items produces three OBSERVED
 * rows and sixteen UNOBSERVED ones, and a host that refuses produces nineteen.
 *
 * THE ONE JUDGEMENT THIS FILE MAKES IS WHICH STATE AN ITEM IS IN, and it is
 * made from the item's own fields rather than from its kind. A severity the
 * host could not determine is UNKNOWN — it looked and could not tell — and a
 * severity of zero is OBSERVED and healthy. Reading a missing severity as zero
 * would be the §3 failure written into the one place §3 is enforced.
 */
import {
  type Observation,
  type ObservationContext,
  type ObservationKind,
  type ObservationProvenance,
  type ObservationResult,
  type SystemObserver,
  OBSERVATION_KINDS,
  observed,
  unknown,
} from "../oqca/autonomy/observation.ts";
import { isRegistered } from "./selfModel.ts";

/**
 * ONE THING THE HOST ACTUALLY READ. Not an observation — the host does not get
 * to decide what state ONIQ is in, only what it saw.
 */
export type EvidenceItem = {
  readonly kind: ObservationKind;
  /** What the reading is ABOUT. A module, a suite, a metric — the host's word. */
  readonly subject: string;
  /** Where it was read. §4's "every important claim must carry provenance". */
  readonly locator: string;
  readonly sourceVersion: string | null;
  readonly contentHash: string | null;
  readonly detail: string;
  /** A number the host MEASURED, or null when the reading carries none. */
  readonly value: number | null;
  /**
   * How bad, in [0, 1], or NULL BECAUSE THE HOST COULD NOT TELL. Null is not
   * zero: zero says "read, and fine", null says "read, and cannot say", and
   * those become OBSERVED and UNKNOWN respectively.
   */
  readonly severity: number | null;
  /** §12 registered capability ids acting on this would call. Validated here. */
  readonly requires: readonly string[];
};

export type SystemEvidenceResult =
  | { readonly ok: true; readonly items: readonly EvidenceItem[] }
  | { readonly ok: false; readonly reason: string };

/**
 * THE HOST'S EYE. A seam, because reading a repository needs a filesystem and
 * `security.test.ts` walks the kernel for exactly that — the runtime tree holds
 * the seam and the host holds the disk.
 */
export type SystemEvidence = {
  readonly read: (ctx: ObservationContext) => Promise<SystemEvidenceResult>;
};

export const NO_EVIDENCE: SystemEvidence = {
  read: async () => ({
    ok: false,
    reason: "no system evidence source is wired to this runtime",
  }),
};

/**
 * AN UNREGISTERED CAPABILITY NAME IS DROPPED, NOT CARRIED. `requires` decides
 * which RESOURCE an improvement objective waits on, and a name no registry
 * knows would resolve to no resource at all — so the objective would look
 * unconstrained and the planner would rank it as free. Dropping it leaves the
 * concern with no declared need, which is the honest "nothing known about what
 * this would cost" rather than a silent claim that it costs nothing.
 */
function knownRequirements(requires: readonly string[]): readonly string[] {
  return requires.filter((r) => isRegistered(r));
}

function provenanceOf(item: EvidenceItem, at: string): ObservationProvenance {
  return {
    locator: item.locator,
    sourceVersion: item.sourceVersion,
    contentHash: item.contentHash,
    agent: "supabase/functions/_shared/oqcaRuntime/observe.ts",
    at,
  };
}

/**
 * Turn one reading into one observation. Exported so a test can drive the
 * mapping without a host, and because the state decision is the only judgement
 * in this file and it deserves to be checkable on its own.
 */
export function observationFrom(item: EvidenceItem, at: string): Observation {
  const requires = knownRequirements(item.requires);
  const provenance = provenanceOf(item, at);
  if (item.severity === null) {
    return unknown(item.kind, item.subject, item.detail, provenance, requires);
  }
  return observed(item.kind, item.subject, {
    value: item.value,
    detail: item.detail,
    severity: item.severity,
    provenance,
    requires,
  });
}

/**
 * The §3 observer over a host's evidence.
 *
 * A REFUSAL TRAVELS THROUGH RATHER THAN BEING SWALLOWED. `completeObservations`
 * puts the host's own sentence on all nineteen UNOBSERVED rows, so an operator
 * reading the world state sees WHY ONIQ cannot see rather than an empty panel.
 *
 * `stampAt` is the host's clock, closed over — there is no clock argument on
 * `ObservationContext` on purpose, and a timestamp one argument away from a
 * hashed record is the mistake `transition.ts` records.
 *
 * IT IS NOT CALLED `at`, AND THAT IS A REAL COLLISION RATHER THAN A STYLE
 * CHOICE. `_shared/oqca/quantum/math/linalg.ts` exports a function called `at`,
 * and `edgeImports.test.ts` reports any `_shared` file that CALLS a shared
 * export it never imported. Its local-binding detector knows `function`,
 * `const`, `let`, `var`, `class` and class methods — not a parameter — so a
 * parameter named `at` reads as an unimported helper. Widening a guard that
 * exists to catch a real class of bug, in order to admit a two-letter name, is
 * the wrong trade; v1.6 made the same call on `security.test.ts` and reworded
 * instead.
 */
export function makeSystemObserver(
  evidence: SystemEvidence,
  stampAt: () => string,
): SystemObserver {
  return async (ctx: ObservationContext): Promise<ObservationResult> => {
    const read = await evidence.read(ctx);
    if (!read.ok) return { ok: false, reason: read.reason };
    const stamp = stampAt();
    const known = new Set<ObservationKind>(OBSERVATION_KINDS);
    // A kind this build does not know would produce a row `completeObservations`
    // never fills and `observationCoverage` counts as a whole extra instrument —
    // so an unknown kind is dropped and the kind is then reported UNOBSERVED,
    // which is true: nothing this runtime understands looked at it.
    const items = read.items.filter((i) => known.has(i.kind));
    return { ok: true, observations: items.map((i) => observationFrom(i, stamp)) };
  };
}
