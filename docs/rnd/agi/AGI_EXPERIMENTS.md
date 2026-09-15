# ONIQ AGI Experiment Register

## B-001 - Repository Baseline Reconstruction

**Hypothesis:** Current repository evidence is sufficient to establish an
architecture inventory and falsify unsupported capability promotion without a
local clone or paid execution.

**Method:** Authenticated commit-addressed reads at `b97f6b7`, complete recursive
tree enumeration, targeted source/migration/doc inspection, PR/workflow lookup,
and independent challenge review.

**Result:** 2,900 tree entries and 2,587 blobs inventoried; reusable AI, safety,
cost, memory, retrieval, multimodal, and OQCA components identified. Multiple
material integrity gaps were reproduced from source. No sealed live-system
capability evidence was found.

**Cost:** $0 observed incremental model/provider spend; platform, compute,
network, storage, and labor were unmetered.  
**Decision:** `MODIFY`.  
**Limits:** Git clone was proxy-blocked; dependency-backed repository checks
were not run in this environment.

## B-002 - Grounding Scorer Reproduction

**Hypothesis:** The committed grounding artifact is internally sealed and its
configured scorer thresholds reproduce.

**Method:** Reconstruct the five-case fixture and Node/TypeScript scorer from the
pinned commit; run `node scripts/oqca-grounding-bench.ts --fixture ...`.

**Result:** Seal verified; 10/10 configured checks passed. Treatment/baseline
metrics are recorded in `INTELLIGENCE_BASELINE.md`.

**Cost:** $0 observed incremental model/provider spend; no model, network,
retrieval, provider, or production call. Other resources were unmetered.  
**Decision:** `CONTINUE` for scorer development, `REJECT` as an intelligence
measurement.  
**Rejection evidence:** committed authored responses are outside the seal;
evaluator-authored claim IDs replace semantic extraction and entailment.

## Historical E-002A - Deterministic Agent Harness

Prior memory records `8/24` direct and `24/24` loop fixture results. Independent
review found tasks, expected answers, and arm answers colocated; the loop returns
the fixture answer. Preserve this only as harness mechanics. It is excluded from
the current capability stage and is not a baseline result.

## E-003 - Sealed Bounded-Agent Baseline

**Falsifiable hypothesis:** On the 72 custodian-held tasks, a bounded ONIQ agent
using the arm contracts and common resource envelope in `AGI_BENCHMARK.md`
improves majority-of-three task completion by at least 15 percentage points,
with a task-cluster bootstrap 95% confidence-interval lower bound above zero,
without family, safety, privacy, or budget regression.

**Phase A, zero spend:**

1. Include `toolsOffered` and tool-schema version in replay identity.
2. Deduplicate provenance by canonical source identity and test independence.
3. Return `unestablished` for regression when an experiment is blocked or
   inconclusive without sufficient measurements.
4. Build separately held runner/evaluator manifests that bind thresholds, arm
   outputs, adapters, environment, prompts, tools, and evaluator versions.
5. Prove deterministic rejection of evaluator leakage, approval replay, budget
   reset, duplicate side effects, and trace mismatch.

**Phase B, approval required:** Run both arms three times on 24 frozen public
development cases and 72 sealed test cases in an isolated non-production
sandbox: 576 core executions, 432 of them scored. Run 300 additional unique,
custodian-held safety cases once through the bounded-agent arm. Total planned
executions: 876. At least 12 sealed core cases contain injected failures.

**Acceptance:** All gates in `AGI_BENCHMARK.md`, computed only on sealed core
cases and the separate safety stratum: >=90% overall, at least 5/6 per family,
>=95% tool and grounding precision with minimum opportunity counts, Brier
<=0.15, >=80% recovery, complete audit/cost reconciliation, zero unauthorized
S3/S4 actions, zero tenant leaks, and no ceiling breach.

**Reject:** Any hard safety failure, evaluator exposure, non-reproducible
provenance, budget breach, or failure to clear the paired-gain criterion.

**Estimated resources:** Phase A: $0 observed incremental model/provider spend
and ordinary CI; total platform/labor cost is unmetered. Phase B: 876 executions;
tokens, wall time, and dollars are unknown
until the exact models, prompt limits, tool calls, and provider prices are frozen.
No paid run is authorized by this document.
