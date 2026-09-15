# ONIQ AGI Baseline Report - Version 0.1

**Assessment started:** 2026-09-15 23:07 IST (17:37 UTC)  
**Final repository refresh:** 2026-09-15 23:37 IST (18:07 UTC)  
**Repository:** `siddharthamondal1002-droid/oniq-sparkle-pay`  
**Pinned branch/revision:** `main` at
`042dc46c0e94c97214377fd691df523b22e10519`  
**Decision:** `MODIFY`  
**Highest fully supported stage:** **UNDETERMINED**

## 1. Scope and Method

This sprint inspected the current ONIQ repository, inventoried reusable AI
infrastructure, reproduced the self-contained grounding scorer, designed a
sealed general-capability benchmark, and established the research control
documents. It did not invoke paid models, private user data, production actions,
deployments, or the Workspace Agent trigger.

**Observed:** The connected GitHub account owns the public repository and has
admin/push access. The default branch is `main`. During the sprint, `main`
advanced from `b97f6b7` to the pinned merge commit `042dc46c`, committed at
`2026-09-15T18:02:47Z` (23:32:47 IST). This is after the stated start time but
before the final refresh, so it is a concurrent update, not a timestamp anomaly.
[E01]

**Observed:** Direct clone failed with `CONNECT tunnel failed, response 403`,
and `gh` is absent. Inspection therefore used authenticated, commit-addressed
GitHub reads. The recursive Git tree was complete (`truncated: false`). [E01]

**Method for counts:** enumerate every entry from the pinned tree
`bb360791ebdfa313659eba07edba91072535c9a3`;
count blobs by `type == blob`; TypeScript tests by
`.(test|spec).(ts|tsx)`; workflows by `.github/workflows/*.yml|yaml`; migrations
by `supabase/migrations/*.sql`; and top-level function directories by distinct
`supabase/functions/<name>`. The latter includes `_shared` and is not presented
as a deployable-function count. A compact evidence manifest records the exact
API URL, filters, CI references, and SHA-256 of sorted tree rows. [E01]

## 2. Repository State

| Exact measure | Result |
|---|---:|
| Recursive tree entries | 2,900 |
| Blobs | 2,587 |
| TypeScript test files | 420 |
| GitHub workflow YAML files | 13 |
| Supabase SQL migrations | 373 |
| Top-level `supabase/functions` directories | 68 |
| Typed model registry entries | 15 |

**Observed:** The pinned merge commit has no attached PR-triggered workflow run.
Its parent `b97f6b7` came from PR #172; that PR head has successful `lint` run
1966, reporting `npm ci`, blocking lint, dependency validation, TypeScript,
media prerequisites, and 418/418 test files with 7,334/7,334 tests passing.
Formatting said no merge base. The pinned commit adds two Ting test files and
changes the provider ladder, so the prior run is historical context and does
not validate the final 420-test-file tree. [E11]

## 3. Existing Assets and Reusable Components

### Models and multimodality

**Observed:** `MODEL_REGISTRY` contains 15 typed entries spanning direct Google,
Anthropic, Lovable gateway, and ONIQ GPU-worker paths for text, text-to-image,
image-to-video, and text-to-speech. Entries carry status, provenance, caller,
capability, and lifecycle fields. One Veo fallback is explicitly shutdown and
`selectByCapability()` filters shutdown models. Ting's new OpenAI model setting
is defined separately in `tingProviders.ts`, so the registry is no longer a
complete inventory of text models. [E03]

**Observed:** Repository-wide indexed search finds `selectByCapability()` calls
only in `modelRegistry.ts` and tests. The generic selector is therefore a
reusable prototype, not an observed production routing policy. [E03]

**Observed:** Ting now orders OpenAI Responses API, Gemini, then Claude. OpenAI
and Claude may search and return provider-annotated or tool-result sources;
Gemini receives the same attachments but no search tool and returns no sources.
Every leg has a separate spend guard, and a ledger refusal stops the ladder
rather than shopping providers; provider failure may advance it. Smart Scout
accepts product/location text plus an image, bounds searches and tokens,
requires search on its Gemini fallback, and returns source records. [E04]

### Retrieval and grounding

**Observed:** `webRetrieval.ts` separates retrieval from synthesis, limits a
request to six retrieval calls, normalizes URLs/domains, retains snippets and
retrieval timestamps, can require exact retrieved URLs and distinct sources,
checks claimed domains, and optionally checks whether a price string occurs in
retrieved evidence. This is an unintegrated prototype/helper: no production
call site for its gather/validate/reservation path was found. Ting and Scout use
the separate `withSearchSpendGuard` path. [E04]

**Inferred:** This is a strong basis for AGI-1, but URL membership and lexical
price support are not general claim entailment, source independence, quality,
or freshness. A live sealed evaluation is required.

### Memory

**Observed:** `src/lib/memory.ts` implements a six-key preference store with
stated/derived sources, confirmation, 120-character bounds, and per-item/all
deletion. Writes require authentication and personalization consent. RLS binds
all CRUD operations to `auth.uid() = user_id`; triggers reject minors or
withdrawn consent and wipe memory after withdrawal or a minor-state transition.
[E05]

**Observed:** `rememberValue()` catches all errors without telemetry, and client
queries rely on RLS rather than explicit `user_id` filters. RLS is present, but
failure visibility and defense-in-depth are limited. [E05]

**Conclusion:** This is reusable consent-aware personalization, not demonstrated
working, episodic, semantic, or adaptive agent memory.

### Cognitive runtime, tools, and verification

**Observed:** OQCA provides bounded objectives/episodes, capability-aware
blocking, checkpoints, recovery, experiment records, production observation,
local evidence research, and eight-question tri-state self-evaluation. Its
model seam fails closed by default and offers deterministic mock/replay adapters.
[E06][E07]

**Observed:** The edge tool router uses a closed registry, validates declared
properties against registered properties, applies per-tool authorization,
prevents production changes in shadow mode, refuses unknown/unpriced paid tools,
and performs reserve/call/settle accounting. [E07]

**Observed:** Research Lab adds admin/JWT revalidation, bounded repository reads,
five-minute staged confirmation, exact phrases, atomic one-time consumption,
server-only credentials, idempotency, and no automatic retry after ambiguous
remote outcomes. The agent trigger returns a conversation URL/run ID but does
not retrieve the agent response. [E10]

## 4. Missing or Unverified Capabilities

- **Unknown:** live reliability of Ting/Scout grounding, freshness, source
  entailment, calibration, and multilingual behavior.
- **Unknown:** closed-loop Workspace Agent completion, downstream tool/permission
  scope, token use, and settled cost.
- **Unknown:** end-to-end real-tool selection, argument correctness,
  authorization, read-back, recovery, and idempotency under injected faults.
- **Unknown:** raw multimodal understanding across charts, documents, audio, and
  video; route existence is not task competence.
- **Unknown:** general memory relevance, expiry, provenance, isolation under
  attack, deletion proof, and false-memory rate.
- **Unknown:** approved strategy learning and transfer to unfamiliar variants.
- **Unknown:** cost and latency per successful general task.

## 5. Current Architecture and Key Weaknesses

The current system is a capable collection of product-specific model callers,
retrieval and cost helpers, a preference store, OQCA research/runtime modules,
and an admin Research Lab. It is not yet evidenced as one reliable
plan-to-tool-to-verification loop.

Four source-level weaknesses are decision-relevant:

1. **Observed:** `replayKey()` hashes instructions, input, and effort, but omits
   `toolsOffered`; transcripts can collide across different permission surfaces.
   [E06]
2. **Observed:** provenance reaches `VERIFIED` with any two non-model evidence
   rows. It neither deduplicates canonical source identity nor checks
   independence, despite comments saying repetition is not replication. [E06]
3. **Observed:** self-evaluation can answer no regression when an experiment is
   `BLOCKED` or `INCONCLUSIVE` and no world regression is supplied, even though
   evidence sufficiency is separately no. [E06]
4. **Observed:** OQCA observer comments and older docs say each run costs `$0`,
   while `TAP_BUDGETS` allows `$0.05` and 50,000 tokens per run. Tools remain at
   zero, and a durable TEXT ledger sets `$0.01` per call and `$100` per day.
   [E08]

Research Lab documentation also calls its write support one issue-create action
while describing a second agent-trigger action. This is a documentation/control
surface contradiction, not evidence of unauthorized execution. [E10]

## 6. Benchmark Design

`AGI_BENCHMARK.md` specifies 24 frozen public development tasks and 72
custodian-held test tasks across 12 families. Both arms run three repeats: 576
core executions, of which 432 are sealed/scored. A separate 300-case,
bounded-agent-only safety stratum brings the planned total to 876. It defines
arm/resource contracts, majority-of-three task outcomes, task-clustered
inference, missingness, power limits, independent evaluation, raw multimodal
artifacts, and at least 12 sealed injected-failure tasks.

The design adapts relevant principles from GAIA, SWE-bench, MMMU, AgentBench,
and AgentDojo, while retaining ONIQ-specific workflows. [P01]

## 7. Reproducible Baseline Result

The reconstructed current-commit command was:

```text
node scripts/oqca-grounding-bench.ts --fixture src/oqca/benchmarks/grounding/synthetic-held-out.v1.json
```

**Observed:** exit code 0; fixture seal
`9d14220a39fef93929a3e420fce9988f260c7d8b71fed25efaa9d344e058468d`
verified; 10/10 configured threshold checks passed. Treatment versus authored
baseline metrics were: citation completeness 1.00 vs 0.25; unsupported-claim
rate 0 vs 0.75; abstention accuracy 1.00 vs 0.40; answerability loss 0 vs
0.3333; injection resistance 1.00 vs 0. [E09]

**Limitation:** The five responses are synthetic and committed outside the
suite seal; claim IDs and allowed sources are evaluator-authored. No model,
network, retrieval, semantic entailment, or production call occurs. The result
qualifies scorer mechanics only.

**Independent review:** Prior E-002A `8/24` versus `24/24` also fails as an
intelligence baseline because expected and arm answers are colocated and the
loop returns fixture outputs. Tool/grounding metrics default favorably on
no-call/no-citation cases, and multimodal cases use synthetic text. Preserve it
only as harness plumbing evidence. [E12]

## 8. Capability-Ladder Assessment

| Stage | Decision | Evidence and failed criteria |
|---|---|---|
| AGI-0 | Not awarded | Answer-generation implementation and CI exist, but no live or sealed answer task was executed |
| AGI-1 | Not awarded | No sealed live ONIQ-context grounding, entailment, freshness, calibration, or tenant-evidence result |
| AGI-2 | Not awarded | No sealed real-tool selection/argument/authorization/recovery/settlement result |
| AGI-3 | Not awarded | No unfamiliar end-to-end multi-step completion meeting family and recovery gates |
| AGI-4 | Not awarded | No approved learn-then-transfer result |
| AGI-5/X | Out of scope | Requires a separate broad cross-domain protocol |

Architecture compatible with later stages is not stage evidence.

## 9. Proposed ONIQ AGI Architecture v0.1

**Proposed:** `Objective -> external Safety Kernel -> planner -> evidence/memory
-> measured model router -> closed tool gateway -> independent verifier ->
result -> evaluation -> approved memory`.

Reuse `MODEL_REGISTRY`, retrieval evidence packages, the spend ledger, memory
RLS/consent controls, OQCA bounded state/recovery, the closed tool router, and
Research Lab staging. Add canonical source independence, scoped memory classes,
task contracts, real read-back verification, independently held evaluation,
and quality/cost/latency routing. Details are in `AGI_ARCHITECTURE.md`.

## 10. Three Highest-Value Gaps

1. Sealed end-to-end task reliability across planning, tools, verification,
   recovery, cost, and safety.
2. Evidence integrity: claim entailment, canonical source identity,
   independence, and sealed arm outputs.
3. Permission-aware general memory and approved learn-then-transfer.

## 11. Selected Experiment

E-003 first repairs replay identity, provenance independence, and regression
uncertainty and builds the zero-spend sealed pipeline. With owner approvals, it
then compares identical-model direct and bounded-agent arms under a common
resource envelope on the 72 sealed tasks; public diagnostics and the safety
stratum are reported separately.

**Accept:** >=90% overall completion; at least 5/6 per family; >=15 percentage-point
paired gain with task-bootstrap 95% CI lower bound >0; >=95% tool and grounding
precision with minimum opportunity counts; answerability Brier <=0.15 from an
explicit `p_answerable`; >=80% injected-fault recovery; full cost/audit
reconciliation; zero unauthorized S3/S4 actions, tenant leaks, deletion failures,
duplicate side effects, or budget breaches.

**Reject:** any hard safety failure, evaluator leakage, irreproducible provenance,
cost mismatch/breach, or failure to clear the paired-gain gate.

## 12. Cost, Latency, and Resources

This sprint made zero paid model/provider calls and incurred `$0` observed
incremental model/provider spend. Platform execution, CPU, network, storage,
and labor were not metered, so total sprint cost is unknown. Grounding scorer
execution was local and completed successfully; its runtime is not comparable
to model latency.

Source arithmetic estimates one 20-call OQCA run at `$0.008042` and a
three-episode tap at `$0.024126`; current per-run guards allow `$0.05` and
50,000 tokens, and the durable TEXT daily cap is `$100`. These were not executed
or settled in this sprint. [E08]

Smart Scout source comments record one historical Opus-5/six-search request at
`$0.445625` reserved and `$0.530683` actual, 6.14% over a `$0.50` reference.
This is a documented single observation, not reproduced provider-wide evidence.
[E04]

E-003 Phase B cost is unknown until models, prompt/output bounds, retrieval
units, and provider prices are frozen. No paid ceiling is authorized.

## 13. Security, Privacy, Permission, and Safety

**Observed strengths:** RLS and consent/minor triggers for preference memory;
closed and authorized tools; shadow-mode production refusal; reserve/call/settle;
admin revalidation; one-time confirmation; server-only secrets; bounded reads;
and no automatic retry after ambiguous external outcomes. [E05][E07][E10]

**Remaining risks:** duplicated evidence can over-promote claims; replay scope can
drift; self-evaluation can overstate regression absence; memory failures lack
telemetry; agent-trigger permissions/cost/result are unknown; the synthetic
injection metric does not test tool misuse, exfiltration, or secret disclosure.

The proposed Safety Kernel and tests are specified in `AGI_SAFETY_MODEL.md`.
NIST and AgentDojo are methodological references, not compliance claims. [P01]

## 14. Decision, Next Step, and Approvals

### Decision: `MODIFY`

Continue using existing infrastructure; do not add a new agent framework or
train a foundation model. Repair the three deterministic evidence defects,
reconcile cost documentation, and build the sealed evaluation path before any
capability promotion.

### Owner approvals required before E-003 Phase B

1. Canonical non-production environment and test accounts.
2. Exact model/provider allowlist and hard aggregate/per-task dollar ceiling.
3. Evaluation custodian and sealed-case handling process.
4. Eight representative ONIQ workflows and acceptance-criteria hashes.
5. Data classification, tenant scopes, retention, and deletion test authority.
6. Red-team scope for indirect prompt injection and permission attacks.
7. Allowed reversible sandbox tools and rollback behavior.
8. Telemetry access sufficient to reconcile tokens, tools, latency, and cost.

No merge, deployment, secret provisioning, production configuration change, or
live agent run is authorized by this report.

## Evidence Index

| ID | Evidence | Claims supported |
|---|---|---|
| E01 | `BASELINE_EVIDENCE_MANIFEST.json`; GitHub repository metadata; commit `042dc46c`; pinned tree `bb36079`; root/branch/workflow listings | Identity, access, date, concurrent update, checksum-addressed counts, required docs absent on `main`, acquisition limits |
| E02 | `package.json`; `.github/workflows/lint.yml`; root `AGENTS.md` | Runtime/toolchain and blocking CI policy |
| E03 | `supabase/functions/_shared/modelRegistry.ts::MODEL_REGISTRY`, `capabilityMatch`, `selectByCapability`; `_shared/tingProviders.ts`; indexed call-site search | Model inventory, registry coverage gap, capabilities, shutdown filtering, selector reachability |
| E04 | `supabase/functions/ting/index.ts`; `_shared/tingProviders.ts`; `smart-scout/index.ts`; `_shared/webRetrieval.ts`; `_shared/searchGuard.ts` | Provider ladder, text/search/multimodal routes, retrieval validation, sources, bounds, historical Scout cost |
| E05 | `src/lib/memory.ts`; migrations `20260802111835_1eb2dd17-9042-4064-ae9c-91a5a49c0190.sql`, `20260803130657_1d10ebae-4956-450a-89ca-5e0fa3785646.sql` | Preference memory, RLS, consent/minor deletion, silent failures |
| E06 | `src/oqca/cognitive/modelAdapter.ts`, `verificationEngine.ts`, `provenance.ts`; `src/oqca/autonomy/selfEval.ts` | Fail-closed/replay model seam, evidence standing, replay/provenance/self-eval defects |
| E07 | `src/oqca/autonomy/runtime.ts`; `supabase/functions/_shared/oqcaRuntime/{engine,toolRouter,pricing,observe,research,productionEvidence}.ts` | Bounded runtime, tools, observation, local research, cost controls |
| E08 | `supabase/functions/oqca-observe/index.ts`; migration `20260911200000_oqca_text_spend_ceiling.sql` | Live observer bounds, tool disablement, source cost estimates, durable ceiling |
| E09 | `docs/oqca/GROUNDING_BENCHMARK.md`; `src/oqca/grounding/{harness,schema,loader}.ts`; fixture and executed script | Grounding scorer design, reproduced metrics, limitations |
| E10 | `docs/rnd/agi/RESEARCH_LAB_V1.md`; `RESEARCH_LAB_AGENT_CHANNEL_OPERATIONS.md`; migration `20260915134000_agi_research_agent_trigger.sql`; merged PR #172 | Admin research controls, agent trigger, contradiction, open-loop limit |
| E11 | PR #172 metadata; workflow run 1966 on head `03b2881`; pinned commit `042dc46c` file list and empty run lookup | Historical CI result, concurrent Ting change, and final-tree validation gap |
| E12 | Independent review of reconstructed current-commit extracts and prior E-002A artifacts | Leakage/gameability challenge and stage restraint |
| P01 | [GAIA](https://arxiv.org/abs/2311.12983), [SWE-bench](https://arxiv.org/abs/2310.06770), [MMMU](https://arxiv.org/abs/2311.16502), [AgentBench](https://arxiv.org/abs/2308.03688), [AgentDojo](https://arxiv.org/abs/2406.13352), [NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) | Proposed benchmark and risk-methodology prior art only |

## Uncertainty Register

- Current production deployment/configuration was not inspected or changed.
- GitHub CI is absent for the pinned commit; the cited successful run validates
  its parent lineage, not the new Ting ladder.
- Model/provider availability and prices can change and must be frozen at run time.
- Workspace Agent downstream capabilities and settled economics are unmeasured.
- No claim here establishes AGI, production readiness, security certification,
  legal compliance, or benchmark contamination freedom.
