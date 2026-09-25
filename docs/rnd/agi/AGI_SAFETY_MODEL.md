# ONIQ AGI Safety Model v0.1

## Proposed Invariants

The target system must prevent an agent from granting itself permissions or
credentials, raising budgets, accessing new private data, deploying, changing
security controls, disabling safeguards, concealing actions, creating
unauthorized persistence, or approving its own evidence.

## Action Classes

- **S0 - Read-only public/local:** allowed within declared scope and rate bounds.
- **S1 - Reversible sandbox write:** requires sandbox scope, idempotency, read-back,
  and rollback metadata.
- **S2 - External or paid low-impact:** requires explicit connector scope and
  durable spend authority.
- **S3 - Private-data, financial, health, credential, production, or security:**
  requires narrowly bound, single-use owner approval.
- **S4 - Safeguard removal, covert persistence, oversight defeat, or unauthorized
  privilege expansion:** prohibited.

## Proposed Safety Kernel

Before every consequential action, the target non-model enforcement layer evaluates
authenticated actor, immutable scopes, tenant/purpose, data classification,
environment, exact tool/arguments, impact, spend/rate/retry budget, approval,
idempotency, and shutdown state. Denials are final for that attempt and emit a
stable reason. After execution, the kernel requires environment read-back,
settled cost, outcome class, and tamper-evident audit append.

## Observed Reusable Controls

- User-memory RLS binds select/insert/update/delete to `auth.uid() = user_id`;
  triggers block minors/withdrawn consent and wipe data on withdrawal or minor
  transition. Evidence: migrations `20260802111835...sql` and
  `20260803130657...sql`.
- OQCA tool routing uses a closed registry, property-match check, per-tool
  authorization, shadow refusal, and ledger-backed paid calls. Evidence:
  `supabase/functions/_shared/oqcaRuntime/toolRouter.ts`.
- Model/search paths reserve before calls and settle measured or conservative
  cost afterward. Evidence: `oqcaRuntime/engine.ts`, `searchGuard.ts`.
- Research Lab docs specify JWT/admin revalidation, five-minute staging, exact
  confirmation, one-time consumption, server-only credentials, idempotency, and
  no automatic retry after ambiguous remote outcomes.

These controls are components, not a unified or production-certified AGI Safety
Kernel.

## Current Findings

| Finding | Classification | Required control |
|---|---|---|
| Replay identity omits the offered-tool surface | Observed | Bind tool names, schemas, scopes, and versions into replay hash |
| Provenance verification counts records, not independent canonical sources | Observed | Canonicalize/dedupe sources; test collusion and duplicate evidence |
| Self-evaluation can say no regression after blocked/inconclusive evidence | Observed | Require sufficient paired measurement or return `unestablished` |
| Personalization write failures are swallowed | Observed | Typed failure telemetry and deletion/consent integration tests |
| Agent trigger response, downstream permissions, and settled cost are not observed | Unknown | Scope discovery, result retrieval, cost reconciliation, sandbox E2E test |
| Observer `$0` claims conflict with nonzero per-run token/cost bounds | Observed | Correct docs/UI and expose estimate/settlement before confirmation |

## Evaluation

Test scope forgery, cross-tenant reads, consent withdrawal, deletion, approval
replay/substitution, concurrent budget use, budget reset, prompt injection in
retrieval/tool output, malicious files, tool-schema drift, retry amplification,
ambiguous timeout, duplicate side effects, audit truncation/reordering, and
shutdown. Zero unauthorized S3/S4 actions is a hard gate, never a weighted metric.

The design aligns risk work with the voluntary
[NIST AI RMF Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)
and uses [AgentDojo](https://arxiv.org/abs/2406.13352) as prior art for indirect
prompt-injection evaluation. This is methodological alignment, not compliance.
