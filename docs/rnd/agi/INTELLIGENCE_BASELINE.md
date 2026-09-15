# ONIQ Intelligence Baseline v0.1

**Started:** 2026-09-15 23:07 IST  
**Final repository refresh:** 2026-09-15 23:37 IST  
**Pinned revision:** `main` at
`042dc46c0e94c97214377fd691df523b22e10519`  
**Measured stage:** **UNDETERMINED**  
**Decision:** `MODIFY`

## Method

The environment could not clone GitHub (`CONNECT tunnel failed, 403`) and did
not provide `gh`. Evidence was reconstructed through authenticated,
commit-addressed GitHub reads. The Git Trees API response was complete
(`truncated: false`). Targeted source files, migrations, docs, PR metadata, and
workflow status were inspected. The self-contained grounding scorer was
reconstructed and executed locally with Node 24. `BASELINE_EVIDENCE_MANIFEST.json`
records the pinned tree, exact filters, a canonical-row checksum, and CI links.
No paid model, private data,
production action, deployment, or external agent was invoked.

## Repository Baseline

| Measure | Result | Counting method |
|---|---:|---|
| Tree entries | 2,900 | Git Trees API, recursive, all returned entries |
| Blobs | 2,587 | entries where `type == blob` |
| TypeScript tests | 420 | paths matching `.(test\|spec).(ts\|tsx)` |
| Workflow files | 13 | `.github/workflows/*.yml` or `*.yaml` |
| SQL migrations | 373 | `supabase/migrations/*.sql` |
| Function top-level directories | 68 | distinct `supabase/functions/<name>` paths; includes `_shared`, so not a deployable-function count |
| Typed model entries | 15 | exported `ModelEntry` constants in `modelRegistry.ts` |

The pinned commit has no attached PR-triggered workflow run. Its parent
`b97f6b7` came from PR #172; that PR head has verified successful `lint` run
1966 with 418/418 files and 7,334/7,334 tests passing. The pinned commit then
adds two Ting test files and a provider-ladder change, so run 1966 is historical
context and does not validate the final 420-test-file tree.

## Capability Inventory

| Capability | Observed | Evidence-backed conclusion |
|---|---|---|
| Answer generation | Ting and model-backed product routes | AGI-0 implementation present; live behavior unmeasured |
| Grounded research | Search-capable Ting/Smart Scout plus retrieval-first validation | Implemented infrastructure; live reliability unknown |
| Model routing | Typed registry and capability filter | Reusable prototype; no production selector caller found |
| Tool use | OQCA closed registry, authorization, shadow mode, accounting | Safety-oriented infrastructure; no sealed real-tool competence result |
| Multimodal | Ting image/PDF and Scout image input; image/video/TTS providers | Routes exist; raw artifact understanding unmeasured |
| Memory | Consent-scoped preference KV with RLS and deletion | Narrow personalization, not general memory |
| Planning/recovery | OQCA bounded runtime, capability blocks, retries, checkpoints | Deterministic architecture evidence, not live long-horizon performance |
| Self-evaluation | Eight tri-state evidence questions | Bookkeeping; not an independent critic or accuracy result |
| Adaptation | Knowledge promotion/curriculum and experiment records | No held-out learn-then-transfer result |
| Safety/cost | Auth, RLS, closed tools, reserve/settle, per-run/daily bounds | Reusable controls with known consistency and evaluation gaps |

## Reproduced Behavioral Result

Command:

```text
node scripts/oqca-grounding-bench.ts --fixture src/oqca/benchmarks/grounding/synthetic-held-out.v1.json
```

The five-case fixture seal
`9d14220a39fef93929a3e420fce9988f260c7d8b71fed25efaa9d344e058468d`
verified and all ten configured threshold checks passed. Treatment metrics were
1.00 citation completeness, 0 unsupported-claim rate, 1.00 abstention accuracy,
0 answerability loss, and 1.00 injection resistance; the authored baseline was
0.25, 0.75, 0.40, 0.3333, and 0 respectively.

This is **scorer and fixture qualification only**. Responses are committed and
outside the suite seal; claims and valid citation IDs are evaluator-authored;
there is no model, network, retrieval, semantic entailment, or production call.
It does not raise ONIQ's capability stage.

Earlier E-002A `8/24` direct versus `24/24` loop results are also excluded from
capability scoring: the local fixture stores expected and arm answers together,
and the loop returns authored responses. They show harness plumbing, not
intelligence.

## Material Gaps

1. No sealed live-system baseline joins planning, tools, verification, recovery,
   and settlement.
2. Provenance promotion counts two non-model records as verification without
   canonical-source deduplication or independence testing.
3. `replayKey()` omits `toolsOffered`, permitting transcript collisions across
   different permission surfaces.
4. Self-evaluation can report no regression for `INCONCLUSIVE` or `BLOCKED`
   experiments when no world regression is supplied.
5. Research Lab documentation describes both issue creation and agent trigger
   while also calling the write surface a single action; the remote agent path
   has no response retrieval and its settled cost/permission envelope is unknown.
6. OQCA observer comments claim `$0`, but `TAP_BUDGETS` permits `$0.05` and
   50,000 tokens per run; tools remain disabled.

## Ladder Decision

- **AGI-0:** not awarded; implementation and CI exist, but no live or sealed
  answer-generation task was executed in this sprint.
- **AGI-1:** not awarded; live ONIQ-context grounding, uncertainty calibration,
  and source entailment have not passed a sealed suite.
- **AGI-2:** not awarded; real tool selection, arguments, authorization,
  settlement, and failure recovery are unmeasured end to end.
- **AGI-3+:** not awarded; no sealed unfamiliar long-horizon completion,
  learn-then-transfer, or broad-domain transfer result exists.

The next evidence gate is Experiment E-003 in `AGI_EXPERIMENTS.md`.
