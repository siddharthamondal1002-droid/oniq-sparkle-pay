# ONIQ Health — Phase 2: the Health AI safety gateway and document intelligence

Owner brief, 2026-09-08 (§83): "Implement Phase 2 only." The objective is to
make ONIQ ready for safe health AI **without changing the production privacy
promise**: "Health data is never sent to any AI feature." In Phase 2 the only
provider that exists is synthetic; no health byte reaches Gemini, Vertex,
MedGemma, Healthcare Search or any external service, and a test proves the
direct path is impossible.

Status: **BUILT DARK.** Reviewed by five adversarial lenses before code (§14),
implemented, red-teamed through the real gateway in vitest, and green. Nothing
is applied, deployed or published; the go sequence is `04 §A-2`.

## 1. What Phase 2 adds, in one picture

```
client ──(JWT)──▶ health-ai (Deno)
   flags → JWT → rate → CLOSED body → actor → GATEWAY → one redacted log line
                                                │
   _shared/health/ai/                           │
   ├─ policy.ts     checkGate: flags, task, provider, sharing switch, model,
   │                PRICE ROW, caps, region, age, environment; checkConsent
   ├─ context.ts    buildMinimumContext: consent-driven rows → field list per
   │                task → aliases r1…/d1 → scrub → quarantine → cap → manifest
   ├─ scrub.ts      normalizeForMatch, scrubText, detectInjection (en/hi/bn/
   │                Hinglish, obfuscation), cleanField
   ├─ provider.ts   HealthAIProvider, PROVIDER_REGISTRY = { synthetic }, zero-arity
   ├─ synthetic.ts  SyntheticHealthAIProvider — deterministic, en/hi/bn templates
   ├─ contract.ts   validateAiResponse: per-class rules, grounding, masking,
   │                forbidden groups, joined-text pass, closed codes
   ├─ classify.ts   rules over title + excerpt → {kind, confidence, method}
   ├─ extract.ts    28 analytes + BP → CANDIDATE records, canonical names only
   ├─ textSource.ts DocumentTextSource, TEXT_SOURCE_REGISTRY = { null }
   ├─ cost.ts       PRICE_PER_1M (synthetic-v1: 0), estimates; no default caps
   └─ gateway.ts    runHealthAi against a Store BOUND TO THE CALLER:
                    gate → consents → read → context → consent → caps →
                    RECEIPT → provider → contract → persist → receipt → audit
```

`health-api` gained the record side: `records.candidates`, `records.reject`
(both above every AI gate), `records.confirm` (behind the AI flag and the
storage consent), the AI consent pair, receipts in export, receipts MARKED on
purge, a legal-hold check on purge, and `status.aiAvailable`.

## 2. The tasks and their purposes

| Task                 | Purpose                                                                        | Context it may see (the field list is the manifest's)                                                             | Output                       |
| -------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `explain_record`     | `ai_interpretation`                                                            | the target (kind, display, value, unit, day, date label, source, NOTE) + up to 5 prior of the same kind (no note) | segments                     |
| `summarize_timeline` | `ai_interpretation`                                                            | last 30 active records in consented categories; no notes                                                          | segments                     |
| `answer_question`    | `ai_interpretation`                                                            | records whose kind/display match the scrubbed question, max 20; the question                                      | segments                     |
| `classify_document`  | `ai_interpretation`                                                            | kind, title, mime, size, captured day, a 2,000-char EXCERPT                                                       | `{kind, confidence, method}` |
| `extract_document`   | `ai_interpretation` (+ `store_records` for labs and vitals, because it WRITES) | the document's text (≤ 20,000 chars)                                                                              | candidate records            |

One purpose, one consent sentence for counsel. The recipient on the consent
must equal the registered provider's recipient — synthetic is `oniq` — and the
consent's TERMS VERSION must have disclosed that recipient
(`DISCLOSED_RECIPIENTS_BY_TERMS`), so a consent given for ONIQ can never be
re-read as one for Google by editing a column.

## 3. The policy engine — one input, one reason, in order

```
ai_disabled              health.enabled or health.ai.enabled off (server row)
task_not_allowed         task ∉ AI_TASKS
provider_not_allowed     ∉ PROVIDER_IDS, or a recipient ≠ oniq while
                         health.provider_sharing.enabled is off (§83C's switch)
model_not_allowed        ∉ MODEL_ALLOWLIST[provider]
unpriced_model           allowed but no PRICE_PER_1M row — before any receipt
caps_unset               a daily cap of 0 (the row's default: the owner sets them)
region_blocked           cf-ipcountry in HEALTH_BLOCKED_REGIONS
age_unverified           no date of birth on file
minor_blocked            under 18 (is_adult_18)
synthetic_in_production  a synthetic answer never reaches a real user in
                         production; an admin may verify there only with
                         health_config.ai_admin_verification_enabled, audited
                         as method=admin_verification
ai_consent_required      no active consent (purpose × category × recipient)
```

**Production is decided by the project, not the row.** `resolveEnvironment`
returns `production` whenever `SUPABASE_URL` names `bqwttemnnoexadpwifcj`,
whatever `health_config.environment` says; unknown values are production too.
`ai_minors_allowed` was dropped in review: not an adult means refused.

## 4. Minimum-data context and the manifest

`buildMinimumContext` copies ONLY the fields in `FIELDS_FOR_TASK[task]`
(`pickRecord`), validates enums against their closed lists, scrubs every string
a person or document wrote, aliases rows `r1…`/`d1` by position, and refuses —
never trims — anything over a cap (`text_too_long`; the classification excerpt
is the one recorded truncation). A field that trips the detector DROPS the row
from a model-bound context and lists it in `manifest.excluded` with a field
name and a closed reason; for the rules-only extractor it only raises
`injectionSuspected`. The read is consent-driven: rows in a category without an
AI consent are never loaded.

The manifest is ids and counts — `recordIds` (position i ↔ `r{i+1}`),
`documentIds`, `categories`, `fields`, `charCount`, `estimatedInputTokens`,
`redactions`, `excluded`, `truncated`, `injectionSuspected`, `language` — and
the receipt stores `storableManifest()` of it, a `keep()`-style whitelist.

## 5. Providers, text sources, and why they are the boundary

`PROVIDER_REGISTRY = { synthetic: () => new SyntheticHealthAIProvider() }`;
`providerFor` throws for anything else and checks the object's recipient
against `RECIPIENT_FOR_PROVIDER`. The factory takes no arguments — nothing from
a request or a row reaches a constructor — and the misbehaving provider the
contract tests use is a test-only class under `__tests__/ai/`. The synthetic
provider speaks the request's language and never emits `ai_interpretation`
(`PROVIDER_CLASS_ALLOWLIST`).

`TEXT_SOURCE_REGISTRY = { null }`. Phase 2 ships no OCR and no model that reads
a PDF, so **in production `extract_document` answers `no_text` for everyone**,
and the receipt and audit row for that refusal are the proof the pipeline ran.
The deployed body is CLOSED (`parseAiRequest`: unknown keys → 400) and carries
no text field — the first draft's inline-text path was killed in review (§14).

## 6. The response contract — refuse, never trim

| Class               | Rule                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record_fact`       | cites ≥ 1 alias in the manifest; every number (digits, number words, Indic digits) is grounded in a cited record's value, unit, display, date, or the citation count |
| `general_info`      | cites nothing; never addresses the reader (en/hi/bn second person)                                                                                                   |
| `ai_interpretation` | cites ≥ 1; allowed only by the provider's class allowlist (synthetic: no)                                                                                            |
| `unknown`           | cites nothing; carries no number                                                                                                                                     |

Then every segment and the JOINED response go through the forbidden groups on
NFKC-normalised text with cited content masked: `forbidden_dose`,
`forbidden_prescribe`, `forbidden_med_change`, `forbidden_diagnosis`,
`forbidden_impersonation`, `forbidden_care_avoidance`, `forbidden_off_app`,
plus `identifier_in_output`, `obfuscated_output`, `disclaimer_in_output` (the
gateway attaches the disclaimer by i18n key; a provider may not write one),
`language_unsupported`. Every refusal is one of 39 closed codes.

## 7. Document intelligence

- **Classification**: keyword scoring over title and excerpt → a hint stored
  as `health_documents.classification` (`kind, confidence, method, at,
provider, model`). The person's declared kind stays authoritative.
- **Extraction**: `extractCandidates(text, fallbackDay)` → CANDIDATES for 28
  analytes and blood pressure. The display is the closed table's, never the
  page's; only the number and a recognised unit come from the page; there is
  no free-text candidate (the migration enforces `value_text IS NULL` for
  `document_extraction`). A page with no printed date is dated to the
  document's captured day, never the epoch. Rows are inserted with
  `status = candidate`, `confidence`, and provenance
  `{source: document_extraction, sourceRef, capturedAt, method, confidence}`.
- **Confirm / reject** live in `health-api`. Reject and the candidate list sit
  ABOVE the AI gate (rollback must not strand candidates); confirm is behind
  the AI flag, the region axis, the storage consent for the category, and
  `validateRecordInput`. A confirmed row keeps `document_extraction` and gains
  `verifiedBy: "user"`, so it renders labelled as AI-read. A rejected candidate
  never renders; a candidate never renders on the timeline.

## 8. Cost instrumentation and caps

`health_ai_requests` is the receipt, written **before** the provider runs and
completed after — `ok`, `refused` (+ `contract_code`), or `error`; a throw
anywhere after the receipt completes it as an error (no row is left
`started`). Both rolling-24h counts (house first, then person) ignore status.
Caps come from the row and default to **0 = refuse**; the price row is checked
in the gate, so nothing can spend before it can price
(`MODEL_ALLOWLIST ⊆ PRICE_PER_1M` is a test). `health-ai` rate-limits at 10
per minute.

## 9. Audit

`ai.request` (ok) / `ai.refused`, `documents.classify`, `documents.extract`,
`records.confirm`, `records.reject`, through `auditDetail()` — whose whitelist
gained exactly `task, provider, model, method, code`. Every refusal detail is
a code.

## 10. Database — `20260908150000_oniq_health_phase2.sql` (not applied)

Separate from Phase 1, every constraint NAMED. `health_config` + twelfth flag
and AI columns (provider CHECK synthetic, caps default 0, admin-verification
switch); `health_records` statuses + confidence + numeric-extraction rule +
candidate index; `health_documents` classification/extraction_status/
text_chars; `health_consents` jurisdiction + terms/recipient CHECK;
`health_audit` action CHECK widened; `health_ai_requests` (user_id → auth.users
ON DELETE SET NULL — the cap ledger survives deletion; RLS select-only;
closed-code CHECKs; `purged_at`); retention row `ai_requests` and the sweep.

## 11. "Health → AI direct path = impossible" — the tests that demonstrate it

1. `ai/isolation.test.ts` — registry keys `["synthetic"]`; `providerFor`
   throws for vertex/gemini/medgemma/…; zero-arity factory; every recipient is
   `oniq`; text-source registry `["null"]`.
2. Egress ALLOWLIST (server): the health functions and `_shared/health/**`
   import only health siblings and the Supabase client; executable text has no
   `fetch`, `functions.invoke`, `import(`, WebSocket, EventSource,
   XMLHttpRequest, sendBeacon, `Deno.connect/Command/run/listen`; `.rpc(` only
   from `{health_append_audit, is_admin, is_adult_18, has_active_legal_hold}`.
3. Egress allowlist (client): `src/health/**` and the health/admin screens
   invoke only `"health-api"`/`"health-ai"`, fetch nothing, import no SDK.
4. The provider input, captured through the real gateway, carries no uuid, no
   user id, no path, no consent id, no identifier — aliases and counts only.
5. Universal inverse: no other edge function names a health table, the bucket
   or `"health-ai"`, or imports from `_shared/health` (isolation.test.ts, both).
6. The privacy sentence still stands, and it is tied to
   `RECIPIENT_FOR_PROVIDER` having no non-oniq value.
7. `ai/regexSafety.test.ts` — no `.*`/`.+`/quantified group in any pattern, and
   20,000-char adversarial inputs stay fast through every stage.
8. `ai/redteam*.test.ts` — the attacks the adversarial workflow wrote against the
   real gateway, kept as regression tests.

## 12. Client (dark)

`src/health/ai/client.ts` sends the closed body to `health-ai`. The timeline
labels every AI-derived row (`needsAiLabel` → `AI_OUTPUT_LABEL` +
`<AiOutputReport surface="health_ai_output" />`) and offers Explain /
Summarise / Ask only when the server's `status.aiAvailable` is true. The
Documents tab lists "Suggested records" whenever candidates exist (rollback
cannot strand them) and offers extraction on `aiAvailable`. The Consent tab has
the AI switch (recipient ONIQ). `/app/admin/health-ai` is the verification
door, linked from Profile. All three files are in `AI_SURFACES`.

**Phase 2 produces zero candidates and zero answers for any production user**:
the client constant `health.ai.enabled` stays false, and even with it on the
server refuses everyone but a verifying admin.

## 13. Activation and rollback

Server: `health_config.enabled AND ai_enabled`, `ai_daily_cap_per_user > 0`,
`ai_daily_cap_house > 0`, and for production verification
`ai_admin_verification_enabled`. Client: `HEALTH_FLAGS["health.ai.enabled"]`.
Off on either side is off. Rollback is the flag; candidates stay reachable
(reject is above the gate), receipts and audit rows stay. Phase 3 replaces
nothing: it adds a provider whose recipient is not ONIQ, which is refused until
`health.provider_sharing.enabled` is on, the consent pair and a NEW terms
version are added, a price row is dated, and the privacy notice changes
(`02 §16`).

## 14. Design review outcomes — what changed before code was written

Five lenses (exfiltration, injection, consent, operability, completeness) read
the first design; every blocker and major became a requirement here:

- **Recipient**: `RECIPIENT_FOR_PURPOSE.ai_interpretation = google_vertex`
  would have refused the synthetic gateway forever → recipient derives from the
  provider; grantable pairs + per-purpose terms versions + disclosed-recipient
  rule.
- **Egress**: blocklist → allowlist, both trees; `.rpc` closed list.
- **Inline text**: no `text` in the deployed body; closed schema; test-only
  text source; `TEXT_SOURCE_REGISTRY = { null }`.
- **Environment**: production bound to the project ref; `ai_minors_allowed`
  dropped; admin verification behind its own column and audited.
- **Store**: bound to the JWT user, no user-id parameters; two-user fixture.
- **Receipts**: `auth.users ON DELETE SET NULL`, indexes, closed-code CHECKs,
  in export/purge(mark)/retention; whitelisted manifest.
- **Whitelist**: `AUDIT_DETAIL_KEYS` += task/provider/model/method/code.
- **Reachability**: an admin door and client callers for extraction and
  confirm/reject, pinned by test.
- **Migration**: a separate, named-constraint Phase 2 file; `migration.test.ts`
  reads both files.
- **Play**: timeline AND documents tab AND admin door in `AI_SURFACES`.
- **Prices before spend**: `unpriced_model` in the gate; allowlist ⊆ price keys.
- **Injection corpus**: 50 positives, 37 benign, en/hi/bn/Hinglish/obfuscated.
- **i18n**: every AI refusal reason has a sentence in three languages;
  `ai_consent_required` is its own reason.
- **Twelfth flag**: kept, because §83C names it; consulted by the sharing clause.

## 15. Definition of Done (Phase 2) — each line is a test

| Requirement                                                                      | Test                                                                                                            |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Existing tests pass                                                              | the full suite                                                                                                  |
| Health → AI direct path impossible                                               | `ai/isolation.test.ts`, `isolation.test.ts`                                                                     |
| Policy engine: one input, one reason, in order; production by project            | `ai/policy.test.ts`                                                                                             |
| Consent: recipient, terms disclosure, revocation, categories                     | `consent.test.ts`, `ai/policy.test.ts`, `ai/gateway.test.ts`                                                    |
| Minimum data, aliases, quarantine, caps refuse                                   | `ai/context.test.ts`                                                                                            |
| Injection detector vs corpus; scrubber                                           | `ai/scrub.test.ts`                                                                                              |
| Contract: per-class, grounding, masking, en/hi/bn, closed codes                  | `ai/contract.test.ts`                                                                                           |
| Classification, extraction (canonical names, dates, validation)                  | `ai/classify.test.ts`, `ai/extract.test.ts`                                                                     |
| Price before spend; no default caps                                              | `ai/cost.test.ts`, `ai/policy.test.ts`                                                                          |
| Receipt before provider; never left started; caps ignore status; two users       | `ai/gateway.test.ts`                                                                                            |
| Nothing a person wrote lands in a receipt, audit or log                          | `ai/redaction.test.ts`                                                                                          |
| health-ai wired: flags → JWT → closed body → actor; Store bound; house cap named | `ai/wiring.test.ts`                                                                                             |
| health-api: confirm gated, reject above, purge marks, legal hold, export         | `wiring.test.ts`                                                                                                |
| Migration equals the lists, named constraints, RLS, set null                     | `migration.test.ts`, `ai/migration2.test.ts`                                                                    |
| Regex safety                                                                     | `ai/regexSafety.test.ts`                                                                                        |
| Labelled where it renders; doors exist; hooks above returns                      | `ai/surfaces.test.ts`, `playCompliance.test.ts`, `adminDoors.test.ts`, `routeNesting.test.ts`, `routes.test.ts` |
| Twelve flags, both sides, all off                                                | `flags.test.ts`                                                                                                 |
| Mirrors identical, `ai/types` included                                           | `agreement.test.ts`                                                                                             |
| en/hi/bn strings agree; every reason has three sentences                         | `i18n.test.ts`, `redact.test.ts`                                                                                |
| Red-team attacks stay refused                                                    | `ai/redteam*.test.ts`                                                                                           |
