/**
 * "AN UNAUTHORIZED CAPABILITY STOPS THE RANKING" — the 2026-09-11 defect.
 *
 * OQCA was handed a real production outage (`story-dispatch` answering
 * 401 Bad credentials on every GitHub dispatch, severity 1.0, measured) and
 * ranked it **14th of 18**, behind thirteen "establish how to observe X" chores
 * it had never looked at. The planning modifier decided it: `capability = 0.00`
 * and `dependencies = 0.05`, both at the floor for ONE reason — acting needs
 * `UPDATE_CONFIGURATION`, which is registered and NOT authorized. Every other
 * factor said do this one, including `expectedImprovement = 1.00`.
 *
 * The consequence was not bad ordering. It was that the outage could never be
 * SELECTED, so `capability_blocked` could never NAME it — and v1.6 built that
 * stop precisely to be "the difference between 'ONIQ is stuck' and 'a
 * credential is missing'".
 *
 * THE ORDERING PROPERTIES ARE THE SUBJECT OF THIS FILE, not the constants.
 * `ESCALATION_CAPABILITY` is 0.5 because half the work (reporting) is available
 * and half (fixing) is not — a semantic derivation. Whether 0.5 actually clears
 * the chore band is a fact about five other factors, so it is ASSERTED here
 * rather than computed there: a future change to `cost`, `risk` or
 * `informationGainOf` that re-buries the report makes this file go red instead
 * of passing quietly.
 */
import { describe, expect, it } from "vitest";

import {
  ESCALATION_CAPABILITY,
  planImprovements,
  planningFor,
  planningModifier,
} from "../autonomy/improve.ts";
import {
  AVAILABILITIES,
  type CapabilityAvailability,
  type CapabilityState,
  PERSON_CLEARED,
  needsAPerson,
} from "../loop/capability.ts";
import { MODIFIER_FLOOR } from "../autonomy/select.ts";
import { EMPTY_KNOWLEDGE } from "../knowledge/model.ts";
import {
  type Observation,
  completeObservations,
  observed,
  unobserved,
} from "../autonomy/observation.ts";
import { EMPTY_CENSUS, UNIDENTIFIED, buildWorldState } from "../autonomy/world.ts";
import {
  registryCapabilityStates,
  resourcesFor,
} from "../../../supabase/functions/_shared/oqcaRuntime/selfModel.ts";

const PROV = {
  locator: "production:net._http_response",
  sourceVersion: "2026-09-11T07:04:00Z",
  contentHash: null,
  agent: "test",
  at: "2026-09-11T00:00:00.000Z",
} as const;

function fault(kind: Observation["kind"], subject: string, severity: number) {
  return observed(kind, subject, {
    value: 1,
    detail: `${subject} detail`,
    severity,
    provenance: PROV,
    requires: ["UPDATE_CONFIGURATION"],
  });
}

function state(availability: CapabilityAvailability): CapabilityState {
  return { capability: "tool", availability, detail: "d", bound: null, station: null };
}

function planOf(observations: readonly Observation[], capabilities: readonly CapabilityState[]) {
  return planImprovements({
    world: buildWorldState({
      identity: UNIDENTIFIED,
      identityProvenance: null,
      observations: completeObservations({ ok: true, observations }),
      capabilities,
      knowledge: EMPTY_CENSUS,
      backlog: [],
      experiments: [],
      baselines: new Map(),
      failureLog: [],
    }),
    knowledge: EMPTY_KNOWLEDGE,
    focus: null,
    capabilities,
    needs: (o) => resourcesFor(o.requires),
  });
}

describe("who can clear a shortfall is a different question from whether it is available", () => {
  it("only unauthorized and no_credentials need a person", () => {
    expect([...PERSON_CLEARED].sort()).toEqual(["no_credentials", "unauthorized"]);
    for (const a of AVAILABILITIES) {
      expect(needsAPerson(a)).toBe(a === "unauthorized" || a === "no_credentials");
    }
  });

  it("an allowance can never be a person-cleared state — that is v1.6's invariant", () => {
    // If a budget could produce one of these, "was this authorized" would be
    // answerable by editing a number.
    expect(needsAPerson("insufficient_allowance")).toBe(false);
    expect(needsAPerson("rate_limited")).toBe(false);
    expect(needsAPerson("available")).toBe(false);
  });
});

describe("the planning modifier discounts a shortfall ONCE", () => {
  const o = fault("provider_failure", "github_repository_dispatch", 1);
  const need = { concept: "c", needs: resourcesFor(["UPDATE_CONFIGURATION"]) };

  it("dependencies never re-penalises what capability already measured", () => {
    // It used to be `known / needs.length` over the SAME list capability reads,
    // so an unknown resource scored 0.05 x 0.05 = 0.0025 while a KNOWN refusal
    // scored 0.05 x 1 = 0.05 — silence punished twenty times harder than a
    // stated refusal, which is backwards.
    for (const ledger of [
      [],
      [state("unauthorized")],
      [state("insufficient_allowance")],
      [state("available")],
    ]) {
      expect(planningFor(need, ledger, o).dependencies).toBe(1);
    }
  });

  it("a person-cleared shortfall scores ESCALATION_CAPABILITY, not the floor", () => {
    expect(planningFor(need, [state("unauthorized")], o).capability).toBe(ESCALATION_CAPABILITY);
    expect(planningFor(need, [state("no_credentials")], o).capability).toBe(ESCALATION_CAPABILITY);
  });

  it("a shortfall ONIQ's own number controls still defers, and an available one does not", () => {
    expect(planningFor(need, [state("insufficient_allowance")], o).capability).toBe(0);
    expect(planningFor(need, [state("available")], o).capability).toBe(1);
    expect(planningFor({ concept: "c", needs: [] }, [], o).capability).toBe(1);
  });

  it("reporting is worth less than fixing, and more than the floor", () => {
    expect(ESCALATION_CAPABILITY).toBeGreaterThan(MODIFIER_FLOOR);
    expect(ESCALATION_CAPABILITY).toBeLessThan(1);
  });
});

describe("THE ORDERING PROPERTIES — the reason the constant is what it is", () => {
  const outage = fault("provider_failure", "github_repository_dispatch", 1);
  const chore = unobserved("dead_branch", "dead_branch", "nobody has looked");

  it("a severity-1 fault only a PERSON can clear outranks a kind nobody has looked at", () => {
    const ranked = planOf([outage], [state("unauthorized")]);
    const top = ranked[0];
    expect(top).toBeDefined();
    expect(top?.observation.subject).toBe("github_repository_dispatch");
    // and the chore it beat is genuinely in the same plan, not filtered out
    expect(ranked.some((c) => c.observation.kind === "dead_branch")).toBe(true);
  });

  it("an ACTIONABLE fault of equal importance outranks one ONIQ can only report", () => {
    const actionable = planningModifier(
      planningFor({ concept: "c", needs: ["tool"] }, [state("available")], outage),
    );
    const escalation = planningModifier(
      planningFor({ concept: "c", needs: ["tool"] }, [state("unauthorized")], outage),
    );
    expect(actionable).toBeGreaterThan(escalation);
  });

  it("the chore is what it always was — this change re-ranks, it does not inflate", () => {
    const choreFactors = planningFor({ concept: "c", needs: [] }, [], chore);
    expect(planningModifier(choreFactors)).toBeCloseTo(0.168, 10);
  });
});

describe("what a build may run is a table the host reports, not a state an episode discovers", () => {
  it("every resource kind with no authorized member is reported unauthorized", () => {
    const rows = registryCapabilityStates();
    expect(rows.map((r) => r.capability).sort()).toEqual(["research", "tool"]);
    for (const r of rows) {
      expect(r.availability).toBe("unauthorized");
      // A permission refusal has no bound to name.
      expect(r.bound).toBeNull();
      // It NAMES the ids, so whoever reads the stop knows what to look at.
      expect(r.detail).toMatch(/^no \w+ capability is authorized in this build: /);
    }
    expect(rows.find((r) => r.capability === "tool")?.detail).toContain("UPDATE_CONFIGURATION");
    expect(rows.find((r) => r.capability === "research")?.detail).toContain("REQUEST_RESEARCH");
    {
    }
  });

  it("verification is ABSENT rather than claimed available — absent is not available", () => {
    // Three registered capabilities use it and all three ARE authorized, but
    // whether one WORKS is still something only an episode can observe. A host
    // asserting `available` from a table would be fabricating an observation.
    expect(registryCapabilityStates().some((r) => r.capability === "verification")).toBe(false);
  });

  it("it closes the loop the empty ledger left open", () => {
    // Nothing may attempt an unauthorized capability, so nothing ever observes
    // it, so without this table the ledger stays silent forever and the
    // objective sits at the floor and is never selected.
    const need = { concept: "c", needs: resourcesFor(["UPDATE_CONFIGURATION"]) };
    const o = fault("provider_failure", "github_repository_dispatch", 1);
    expect(planningFor(need, [], o).capability).toBe(0);
    expect(planningFor(need, registryCapabilityStates(), o).capability).toBe(ESCALATION_CAPABILITY);
  });
});
