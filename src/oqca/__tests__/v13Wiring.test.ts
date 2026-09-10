/**
 * v1.3 — the properties a typecheck cannot see.
 *
 * COMMENTS ARE STRIPPED FIRST, ALWAYS. Every file below explains in prose the
 * thing it is checked for: `research.ts`'s header says why it refuses,
 * `persistence.ts`'s says what it does not store, `flag.ts`'s names the third
 * mode it will not return. A grep strict enough to be useful hits those
 * sentences, and this repo has made that mistake twelve times.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "@/test/sourceText";
import {
  RUN_MODES,
  mayAct,
  mayActUnattended,
  MEMORY_LAYERS,
  NO_RESEARCH,
  EMPTY_KNOWLEDGE,
  UNKNOWN_TOOL_PROPERTIES,
} from "../loop/seams.ts";
import { NO_PERSISTENCE, makeRun, runProgress } from "../loop/cognitiveRun.ts";
import {
  type LoopState,
  EMPTY_WORLD,
  PROVENANCES,
  isEvidential,
  isTerminal,
  sealLoopState,
  TERMINAL_STATUSES,
} from "../loop/loopState.ts";
import { DEFAULT_BUDGETS, NO_SPEND } from "../loop/seams.ts";
import { CognitiveState } from "../formalState.ts";
import { makeFailure, safeToReplay } from "../recovery/failure.ts";

const RUNTIME = "supabase/functions/_shared/oqcaRuntime";
const code = (f: string) => stripComments(readFileSync(f, "utf8"));

describe("section 2 — one run object, and the third mode is unreachable", () => {
  it("names all three modes, and only one may act unattended", () => {
    expect([...RUN_MODES]).toEqual(["shadow", "assisted", "controlled_autonomy"]);
    expect(mayAct("shadow")).toBe(false);
    expect(mayAct("assisted")).toBe(true);
    expect(mayAct("controlled_autonomy")).toBe(true);
    expect(mayActUnattended("assisted")).toBe(false);
    expect(mayActUnattended("controlled_autonomy")).toBe(true);
  });

  it("NO ENVIRONMENT VALUE PRODUCES controlled_autonomy", () => {
    /* ------------------------------------------------------------------ *
     * THE RECOVERY BRIEF'S CLOSING SENTENCE IS THE REASON THIS IS A TEST
     * RATHER THAN A COMMENT: "This recovery loop is mandatory for every
     * consequential ONIQ action before controlled autonomy is enabled."
     * The loop exists as of this change; whether it has been exercised enough
     * to trust with unattended writes is an authorization, not an inference.
     *
     * So the mode is DEFINED (a later switch needs no new type) and
     * CONFIGURABLE BY NOBODY. `parseMode` is a closed list of two; the router
     * is a two-value type. A typo cannot reach it and neither can an
     * environment variable.
     * ------------------------------------------------------------------ */
    const flag = code(`${RUNTIME}/flag.ts`);
    expect(flag).toMatch(/OqcaMode = "off" \| "shadow" \| "assisted"/);
    expect(flag).not.toMatch(/return "controlled_autonomy"/);
    expect(flag).not.toMatch(/"autonomous"/);
    const router = code(`${RUNTIME}/toolRouter.ts`);
    expect(router).toMatch(/RouterMode = "shadow" \| "assisted"/);
    expect(router).not.toMatch(/controlled_autonomy/);
  });

  it("makeRun refuses on every seam it was not given", async () => {
    const run = makeRun({ runId: "r1" });
    expect(run.mode).toBe("shadow");
    expect(await run.research.investigate("anything")).toMatchObject({ ok: false });
    expect(await run.knowledge.lookup("anything", 5)).toEqual([]);
    expect(await run.persistence.persist({} as never)).toBe(false);
    expect(await run.persistence.load("x")).toBeNull();
    expect(run.classifier({ status: 500, body: "", retryAfterHeader: null })).toBeNull();
    // Jitter defaults to none, so a backoff is exactly reproducible.
    expect(run.jitter()).toBe(0);
  });

  it("status and iteration are read from the state, never stored twice", () => {
    // Section 2 lists them on the run object; they live on the HASHED state,
    // and a second mutable copy is the drift the section's own "no
    // module-level mutable execution state" exists to prevent.
    const src = code("src/oqca/loop/cognitiveRun.ts");
    // SCOPED TO THE TYPE BODY. A whole-file match hit `runProgress`'s own
    // return type — the ACCESSOR, which is the thing that makes this legal —
    // so the assertion would have failed on the code that satisfies it.
    // "A count over a whole file is not a guard when the thing counted is
    // common in it", from 2026-09-09, in a fourth place.
    const body = src.slice(
      src.indexOf("export type CognitiveRun = {"),
      src.indexOf("export type RunDraft"),
    );
    expect(body.length).toBeGreaterThan(200);
    expect(body).not.toMatch(/^\s*(readonly )?status[?]?:/m);
    expect(body).not.toMatch(/^\s*(readonly )?iteration[?]?:/m);
    expect(runProgress({ status: "running", iteration: 3 } as never)).toEqual({
      status: "running",
      iteration: 3,
    });
  });
});

describe("sections 3, 6 and 30 — perception is not inference", () => {
  it("the four provenance classes exist and only one is evidence", () => {
    expect([...PROVENANCES]).toEqual(["OBSERVED", "INFERRED", "PREDICTED", "UNKNOWN"]);
    expect(isEvidential("OBSERVED")).toBe(true);
    for (const p of ["INFERRED", "PREDICTED", "UNKNOWN"] as const) {
      expect(isEvidential(p)).toBe(false);
    }
  });

  it("provenance is REQUIRED on both records — no default demotes a reading", () => {
    const src = code("src/oqca/loop/loopState.ts");
    // Neither is optional (`provenance?:`), so a construction site must choose.
    expect(src).not.toMatch(/provenance\?:/);
    expect(src.match(/readonly provenance: Provenance;/g)?.length).toBe(2);
  });

  it("a wall clock on a percept is stripped from the hash, not merely optional", () => {
    // v1.3 section 3: "A timestamp may exist in an audit record. It must never
    // enter the deterministic cognitive stateId." The type allows it; the
    // PAYLOAD is what enforces it, so the payload is what is read.
    const src = code("src/oqca/loop/loopState.ts");
    const payload = src.slice(
      src.indexOf("function hashPayload"),
      src.indexOf("export function sealLoopState"),
    );
    expect(payload).toMatch(/percepts: s\.percepts\.map/);
    expect(payload).not.toMatch(/observedAt/);
    // ...and the whole-array spread that would have carried it in is gone.
    expect(payload).not.toMatch(/percepts: s\.percepts,/);
  });

  it("isTerminal reads the list rather than testing for `running`", () => {
    // The old predicate was `status !== "running"` and never read this array.
    // Harmless today; the day a second non-terminal status is added it calls
    // that status terminal and the loop stops on it silently.
    const src = code("src/oqca/loop/loopState.ts");
    expect(src).toMatch(/return TERMINAL_STATUSES\.includes\(status\)/);
    expect(TERMINAL_STATUSES).toHaveLength(6);
    expect(isTerminal("running")).toBe(false);
    for (const s of TERMINAL_STATUSES) expect(isTerminal(s)).toBe(true);
  });
});

describe("sections 5, 11 and 12 — knowledge is sourced and research may refuse", () => {
  it("the six memory layers are the brief's six", () => {
    expect([...MEMORY_LAYERS]).toEqual([
      "working",
      "episodic",
      "semantic",
      "procedural",
      "project",
      "approved_user_context",
    ]);
  });

  it("both retrieval seams REQUIRE a limit, so neither can dump its store", () => {
    const src = code("src/oqca/loop/seams.ts");
    expect(src).toMatch(/recall: \(query: string, limit: number\)/);
    expect(src).toMatch(/lookup: \(query: string, limit: number\)/);
    // An optional limit is a limit a caller in a hurry omits.
    expect(src).not.toMatch(/limit\?: number/);
  });

  it("a research refusal is NOT an empty finding set", async () => {
    // The union is the guard: `{ok:true, findings:[]}` would be a fabricated
    // negative result, which is exactly what section 12 forbids.
    const refusal = await NO_RESEARCH.investigate("anything");
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.reason.length).toBeGreaterThan(0);
    // And the empty knowledge adapter genuinely answers nothing.
    expect(await EMPTY_KNOWLEDGE.lookup("anything", 5)).toEqual([]);
  });

  it("the runtime research adapter refuses and never fabricates", () => {
    const src = code(`${RUNTIME}/research.ts`);
    expect(src).toMatch(/ok: false/);
    expect(src).not.toMatch(/ok: true/);
  });

  it("every knowledge fact must carry a source reference", () => {
    const src = code("src/oqca/loop/seams.ts");
    expect(src).toMatch(/readonly sourceRef: string;/);
    expect(src).not.toMatch(/sourceRef\?:/);
  });

  it("the runtime knowledge facts name the modules they came from", () => {
    // v1.4-R MOVED THE FACTS AND LEFT THE RULE. They were four sentences in
    // `knowledge.ts`; they are substrate RECORDS now, and every one still
    // carries the module its claim was read out of — as an evidence LOCATOR
    // rather than a `sourceRef` string, which is stricter: `makeEvidence`
    // refuses a record with no locator, where the old shape merely had a field
    // somebody filled in.
    const src = code(`${RUNTIME}/substrate.ts`);
    for (const ref of ["dispatchJob.ts:DISPATCH_BACKOFF_MS", "dispatchJob.ts:isDispatchable"]) {
      expect(src).toContain(ref);
    }
    // And the wrapper that replaced them owns no facts at all: a fact list back
    // in `knowledge.ts` would be a second knowledge source beside the store.
    const wrapper = code(`${RUNTIME}/knowledge.ts`);
    expect(wrapper).not.toMatch(/statement:/);
    expect(wrapper).toMatch(/recordingKnowledge/);
  });
});

describe("sections 7 and 19 — idempotency and persistence are declared, not guessed", () => {
  it("an unregistered tool is non-idempotent, irreversible and touches production", () => {
    expect(UNKNOWN_TOOL_PROPERTIES).toEqual({
      idempotency: "UNKNOWN",
      reversible: false,
      touchesProduction: true,
    });
    expect(safeToReplay(UNKNOWN_TOOL_PROPERTIES.idempotency)).toBe(false);
  });

  it("every registered tool DECLARES its idempotency — there is no default", () => {
    const src = code(`${RUNTIME}/toolRouter.ts`);
    expect(src).toMatch(/readonly idempotency: IdempotencyClass;/);
    expect(src).not.toMatch(/idempotency\?:/);
    expect(src).not.toMatch(/idempotency:\s*spec\.idempotency\s*\?\?/);
  });

  it("the dispatch tool is non-idempotent and the hold is a read", () => {
    const src = code(`${RUNTIME}/dispatchJob.ts`);
    expect(src).toMatch(/idempotency: "NON_IDEMPOTENT_WRITE"/);
    expect(src).toMatch(/idempotency: "READ"/);
  });

  it("persist returns whether it persisted, so a no-op cannot read as a write", async () => {
    expect(await NO_PERSISTENCE.persist({} as never)).toBe(false);
    const src = code("src/oqca/loop/cognitiveRun.ts");
    expect(src).toMatch(/persist: \(state: LoopState\) => Promise<boolean>/);
  });

  it("the loop counts what the ADAPTER stored, never the chain length", () => {
    const src = code("src/oqca/loop/cognitiveLoop.ts");
    const flush = src.slice(src.indexOf("const flushChain"), src.indexOf("const flushChain") + 600);
    expect(flush).toMatch(/if \(await run\.persistence\.persist\(/);
    expect(flush).not.toMatch(/stored = chain\.length/);
  });
});

describe("sections 20 and 31 — a failure is part of the state's IDENTITY", () => {
  /* -------------------------------------------------------------------- *
   * THE FIRST VERSION OF THIS GUARD ESCAPED ITS OWN MUTATION, and the
   * reason is worth more than the guard. `shadowRun.test.ts` asserted that
   * `state.failures` HAD entries — which stays true when `failures` is
   * dropped from `hashPayload`, because the ARRAY is still populated. Only
   * the hash changes.
   *
   * "Never mutate history to hide a failure" (§20) and "a failure must never
   * disappear merely because a retry succeeded" (§31) are both claims about
   * the state ID: a replay that dropped a failure must not verify. So the
   * assertion is about the ID, which is the only thing the mutation moves.
   * -------------------------------------------------------------------- */
  const seal = (over: Partial<Omit<LoopState, "stateId">>): LoopState =>
    sealLoopState({
      parentStateId: null,
      goal: { id: "g", statement: "s", requires: [] },
      percepts: [],
      failures: [],
      activeHypotheses: [],
      worldState: EMPTY_WORLD,
      evidenceIds: [],
      knowledgeGaps: [],
      candidatePlans: [],
      selectedPlan: null,
      futures: [],
      predictions: [],
      outcomes: [],
      verification: null,
      memoryRefs: [],
      quantumState: CognitiveState.fromWeights(["A"], [1], {
        contextId: "t",
        tags: {},
      }).snapshot(),
      iteration: 0,
      budgets: DEFAULT_BUDGETS,
      spent: NO_SPEND,
      status: "running",
      createdAt: 0,
      ...over,
    });

  const failure = makeFailure({
    id: "ACT#1@s",
    runId: "r",
    stateId: "s",
    station: "ACT",
    class: "TOOL",
    code: "tool_refused",
    message: "the tool said no",
    attempt: 1,
    maxAttempts: 3,
    idempotency: "READ",
    evidenceRefs: [],
    effectUncertain: false,
  });

  it("two states that differ ONLY in their failures have different ids", () => {
    const clean = seal({});
    const failed = seal({ failures: [failure] });
    expect(failed.stateId).not.toBe(clean.stateId);
  });

  it("...and the id is stable, so a replay of the same failure reproduces it", () => {
    expect(seal({ failures: [failure] }).stateId).toBe(seal({ failures: [failure] }).stateId);
  });

  it("a run that failed and then succeeded cannot be replayed as one that did not", () => {
    // The whole of §31 in one assertion: dropping the failure from a state
    // whose LATER fields are identical still changes what the state IS.
    const withHistory = seal({ failures: [failure], status: "success" });
    const rewritten = seal({ failures: [], status: "success" });
    expect(rewritten.stateId).not.toBe(withHistory.stateId);
  });
});
