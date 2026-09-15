# ONIQ AGI Architecture v0.1

**Status:** Proposed from baseline evidence. This is not a production or AGI
claim.  
**Pinned repository:** `main` at
`b97f6b73a06c33a242b9122d94a73fdc82858d1a`

## Evidence-Backed Reuse Map

| Layer | Observed reusable component | Evidence | Current limit |
|---|---|---|---|
| Model inventory | 15 typed `ModelEntry` records across text, image, video, speech, and retrieval-related paths | `supabase/functions/_shared/modelRegistry.ts::MODEL_REGISTRY` | `selectByCapability()` is found only in the registry and tests, not a production caller |
| Text and tools | Direct Google, Anthropic tool-use, and gateway paths | `modelRegistry.ts`; `supabase/functions/ting/index.ts`; `smart-scout/index.ts` | Provider quality/latency ranking is not operationally measured |
| Retrieval | Retrieval-first evidence-package and validation helpers with exact URL checks, price/source checks, and a six-call bound | `supabase/functions/_shared/webRetrieval.ts` | No production call site was found; its reservation helper is not observed as integrated |
| Grounding UX | Ting and Smart Scout return sources; image/PDF inputs are accepted | `ting/index.ts`; `smart-scout/index.ts` | No sealed live grounding or raw-multimodal score |
| Personalization memory | Six-key consent-aware user preference store with confirm/delete operations and RLS policies | `src/lib/memory.ts`; migrations `20260802111835...sql`, `20260803130657...sql` | Not working, episodic, or semantic agent memory; write failures are swallowed |
| Cognitive loop | Bounded objectives, checkpoints, capability states, recovery, experiments, and tri-state self-evaluation | `src/oqca/autonomy/runtime.ts`; `selfEval.ts` | Mostly deterministic/replayed evidence; no sealed live completion baseline |
| Model boundary | Provider-independent adapter with fail-closed default and replay support | `src/oqca/cognitive/modelAdapter.ts` | Replay key omits `toolsOffered`, causing permission-surface collisions |
| Verification | Claims retain supporting and contradicting provenance | `verificationEngine.ts`; `provenance.ts` | Two records are treated as two sources without deduplication or independence checks |
| Tool control | Closed registry, declared-property checks, authorization, shadow refusal, reserve/call/settle | `supabase/functions/_shared/oqcaRuntime/toolRouter.ts` | No sealed real-tool selection/argument/recovery evaluation |
| Production observation | Bounded database observations and local evidence research | `oqcaRuntime/productionEvidence.ts`; `observe.ts`; `research.ts` | Read coverage is product-specific and not a general research system |
| Spend control | Per-run bounds plus atomic provider admission and settlement | `oqcaRuntime/engine.ts`; `pricing.ts`; `searchGuard.ts`; migration `20260911200000...sql` | Documentation says `$0` while the live observer allows `$0.05`/50,000 tokens per run |
| Admin research | Admin/JWT revalidation, staged exact confirmation, one-time request consumption | `docs/rnd/agi/RESEARCH_LAB_V1.md`; `RESEARCH_LAB_AGENT_CHANNEL_OPERATIONS.md` | Agent trigger is open-loop; result retrieval, permission envelope, and settled cost are unknown |

## Proposed Control and Execution Flow

`Objective -> Safety Kernel -> Planner -> Evidence/Memory -> Model Router -> Tool Gateway -> Verifier -> Result -> Evaluation -> Approved Memory`

The Safety Kernel remains outside the model-controlled loop. Untrusted inputs
include user content, retrieved pages, tool output, model output, memory
candidates, and critic suggestions. Trusted enforcement includes authenticated
identity, immutable scopes, durable budgets, one-time approvals, audit append,
and emergency shutdown.

## Proposed v0.1 Components

1. **Task contract:** objective, acceptance tests, permitted data/tools, impact
   class, budget, retry bound, deadline, and rollback.
2. **Capability router:** reuse `MODEL_REGISTRY`; filter policy-ineligible and
   shutdown entries, then rank eligible models using measured quality, settled
   cost, latency, region, and provenance requirements.
3. **Evidence envelope:** canonical URL or repository locator, retrieval time,
   immutable excerpt hash, claim links, freshness, source identity, and
   contradiction state. Independence is based on canonical source identity,
   not evidence-row count.
4. **Permission-aware memory:** separate working, episodic, semantic, and user
   preference stores; require tenant, purpose, provenance, retention, deletion,
   and promotion policy on every record.
5. **Bounded agent runtime:** explicit state machine, idempotent tools, typed
   failures, capped retries, read-back verification, checkpoints, and terminal
   conditions.
6. **Independent verifier:** deterministic tests first; otherwise a separately
   configured critic with no access to hidden expected outputs during execution.
7. **Evaluation plane:** sealed manifests, versioned adapters, complete traces,
   task-clustered statistics, cost settlement, and release gates.

## Smallest Integration

Do not add another agent framework. Fix the replay-key, provenance-independence,
and self-evaluation defects, then route one reversible sandbox tool through the
existing router/tool gateway under the proposed sealed benchmark. Reject the
architecture path if it cannot produce at least a 15 percentage-point paired
completion gain over the direct arm without a family, safety, or cost regression.

## Defensible ONIQ Work

Third-party models remain identified as third-party. Potentially defensible
ONIQ technology is the evidence-preserving retrieval layer, permission and cost
kernel, product-specific task/evaluation corpus, safe tool contracts, and
measured routing policy. A wrapper around a provider model is not proprietary
ONIQ intelligence.
