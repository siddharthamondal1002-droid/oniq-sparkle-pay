# ONIQ AGI Research Backlog

**Ranking date:** 2026-09-15 IST  
**Decision:** `MODIFY`

Scores are 1 (low) to 5 (high). Value, evidence strength, effort, operational
risk, and expected external cost are estimates; they are not measured outcomes.

| Rank | Work item | Value | Evidence | Effort | Risk | Expected external cost |
|---:|---|---:|---:|---:|---:|---:|
| 1 | Review and merge E-003A replay, provenance, regression, seal, and mutation controls from draft PR #174 | 5 | 5 | 1 | 2 | $0 |
| 2 | Implement the 24-dev/72-sealed-task baseline and independent custody pipeline | 5 | 5 | 4 | 3 | $0 harness; inference pending approval |
| 3 | Integrate one reversible sandbox tool through router, Safety Kernel, read-back verifier, and settlement | 5 | 4 | 3 | 3 | <= approved experiment ceiling |
| 4 | Reconcile OQCA observer `$0` documentation with the actual `$0.05`/50,000-token run bounds | 4 | 5 | 1 | 2 | $0 |
| 5 | Add claim/source canonicalization and true source-independence checks | 5 | 5 | 3 | 2 | $0 local; retrieval eval pending |
| 6 | Close Research Lab agent loop with result retrieval, scoped capability/cost envelope, and audit settlement | 4 | 4 | 4 | 4 | Unknown until provider contract is measured |
| 7 | Instrument preference-memory failures and benchmark RLS isolation, consent withdrawal, export, and deletion | 5 | 4 | 3 | 4 | $0 sandbox |
| 8 | Add measured router ranking by quality, latency, cost, privacy, and region | 4 | 4 | 4 | 3 | Requires approved comparison budget |
| 9 | Define separate working, episodic, semantic, and user-controlled memory stores | 4 | 4 | 4 | 4 | $0 design; implementation unknown |
| 10 | Add approved offline learn-then-transfer with review and rollback | 4 | 3 | 5 | 5 | Unknown; defer until AGI-3 gate |

## Three Highest-Value Capability Gaps

1. **Sealed end-to-end task reliability:** components exist, but no live paired
   benchmark measures unfamiliar completion, grounding, tools, recovery, cost,
   and safety together.
2. **Evidence integrity:** current promotion can mistake duplicate records for
   independent sources, and the grounding fixture does not test semantic
   entailment or bind arm outputs.
3. **Permission-aware memory and adaptation:** user preferences are protected
   narrowly, but general memory provenance, retention, deletion, isolation, and
   learn-then-transfer are unverified.

## Selected Next Step

Review and merge Experiment E-003A from draft PR #174, then freeze the signed
runner/evaluator manifests and fail-closed Phase B preflight. The branch has
passed the full repository and focused mutation gates at zero external spend.
Proceed to paid Phase B only after the owner approves the
model/provider set, sandbox, custodian, representative workflows, red-team
scope, and hard cost ceiling.

## Deferred

Foundation-model training, broad production autonomy, unrestricted continual
learning, private-user-data evaluation, and deployment remain deferred. They
have no evidence-based priority over the smaller integration experiment.
