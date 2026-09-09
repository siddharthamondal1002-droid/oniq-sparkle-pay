# ONIQ Health — Phase 2: the Health AI safety gateway and document intelligence

Owner brief, 2026-09-08 (§83): "Implement Phase 2 only." The objective is to
make ONIQ ready for safe health AI **without changing the production privacy
promise**: "Health data is never sent to any AI feature." In Phase 2 the only
provider that exists is synthetic; no health byte reaches Gemini, Vertex,
MedGemma, Healthcare Search or any external service, and a test proves the
direct path is impossible.

(The promise was replaced on 2026-09-09 by owner directive with the
consent-conditioned statement in `src/config/privacy.ts` — `02 §16`, `04 D4`.
`ai/isolation.test.ts` now ties the NEW statement to `RECIPIENT_FOR_PROVIDER`
holding no recipient but ONIQ; nothing else in this document changes.)

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
caps_unset               a daily cap of 0: THIS task's per-person cap, read by
                         capForTask from the row's ai_daily_caps JSON (B11,
                         the owner's table), or the house cap
                         (ai_daily_cap_house, default 0: the owner sets it)
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

**The emergency stop sits above all of this** (owner directive 2026-09-08).
`health_config.ai_kill_switch = true` makes `flagsFromRow` force
`health.ai.enabled` and `health.provider_sharing.enabled` off for every
function on its next read, so the first line above answers `ai_disabled`
everywhere — `status.aiAvailable` included, because it IS `checkGate` —
within seconds, with no SQL and no deploy. An admin flips it from
`/app/admin/health-ai` (two taps); `health-api`'s `admin.ai_kill` re-derives
`is_admin` from the JWT, audits both outcomes as `config.ai_kill`, and is one
of the two writes to the shared policy row that function makes — the other is
`admin.ai_caps` — and the authz red-team guard admits exactly those two chains
and no other. Only the boolean `true` counts, like every other column.

**The hierarchy the owner set** (2026-09-08, later the same day, with the
house cap approved at 500), as the gate enforces it:

```
ai_kill_switch = true            forces the AI flags off (flagsFromRow)
  → health.ai.enabled             the server row, else ai_disabled
    → house cap > 0        ┐      caps_unset if either is 0 — never "unlimited"
    → this task's cap > 0  ┘
      → house count this 24h < house cap          quota_house
        → this person's count of THIS task < cap   quota_user
          → the gateway
```

The house cap is a SYSTEM-WIDE safety ceiling, not a person's allowance; the
per-task caps are the tighter control; both are enforced, house first, so the
effective cap is the tighter of the two (`gateway.test.ts` pins it). Both are
set from `/app/admin/health-ai` → Daily caps through `admin.ai_caps` —
integers in `[0, 100000]`, only known tasks, admin re-derived, one audit row
per changed value (`config.ai_caps`, detail `{ house }` or `{ task, count }`)
— or by `UPDATE`; either way the row trigger `health_config_audit_ai_controls`
appends a `config.changed` row with the values after the change, so every
change is audited whatever path made it. Nothing is configurable by a client,
and nothing needs a migration.

## 4. Minimum-data context and the manifest

`buildMinimumContext` copies ONLY the fields in `FIELDS_FOR_TASK[task]`
(`pickRecord`), validates enums against their closed lists, scrubs every string
a person or document wrote, aliases rows `r1…`/`d1` by position, and refuses —
never trims — anything over a cap (`text_too_long`; the classification excerpt
is the one recorded truncation). **The cap is measured on the SCRUBBED text**:
scrubbing can grow a string (`a@b.cd` → `[email]`), and the cap bounds what the
provider sees, not what was typed. A field that trips the detector — display,
note OR unit — DROPS the row from a model-bound context and lists it in
`manifest.excluded` with a field name and a closed reason; for the rules-only
extractor it only raises `injectionSuspected`, with NO exclusion entry. **The
manifest describes what was sent**: an entry in `excluded` means the field is
absent from the provider input, always (`classify_document` drops injected
text and lists it; `extract_document` flags it and hands it to the regex).

The read is consent-driven: the LIST reads derive their kinds from the
consents before the query, so rows in a category without an AI consent are
never loaded. A TARGETED read (`explain_record`, the document tasks) must
load the row to learn its category; when that category is uncovered the
refusal names it and the row's content reaches no provider, no manifest, no
receipt and no audit row (`redteamAuthz.test.ts`). Priors for `explain_record`
are the same ANALYTE — same kind and same normalised display — not merely the
same kind; and excluded rows are BACKFILLED: the loop over loaded rows stops
when the context is full, not at the first `MAX_RECORDS` rows.

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
and the audit row for that refusal (`ai.refused`, reason `no_text`) is the
proof the pipeline ran. A refusal BEFORE the receipt — gate, consent, context,
caps — is audited, not receipted: the receipt is written only once a request
reaches the provider stage, and it is the cap ledger. (The first version of
this sentence said "receipt"; the red team measured that no pre-provider
refusal writes one, and the docs were wrong, not the code.)
The deployed body is CLOSED (`parseAiRequest`: unknown keys → 400) and carries
no text field — the first draft's inline-text path was killed in review (§14).

## 6. The response contract — refuse, never trim

| Class               | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record_fact`       | cites ≥ 1 alias in the manifest; every number (digits, number words, every Indic/Thai/Arabic digit block) is grounded in a cited record's value or the digits of its display, unit or note; the date is quotable ONLY as the record's `dateLabel` (stripped before the numbers are read) — a day of month, a year or the citation count is not a value; never advises the reader (`fact_advises_reader`: "you should/must/need to…", en/hi/bn) |
| `general_info`      | cites nothing; never addresses the reader (en/hi/bn second person, including `u`, `ur`, `thou`)                                                                                                                                                                                                                                                                                                                                                |
| `ai_interpretation` | cites ≥ 1; allowed only by the provider's class allowlist (synthetic: no); never advises the reader                                                                                                                                                                                                                                                                                                                                            |
| `unknown`           | cites nothing; carries no number                                                                                                                                                                                                                                                                                                                                                                                                               |

Then every segment and the JOINED response go through the forbidden groups on
normalised text (NFKC, format characters and Latin combining marks stripped,
every digit block mapped to ASCII, number words digitised — "fifty mg" is
"50 mg" — and sentence punctuation opened, so "500 mg. Twice a day" is one
dose): `forbidden_dose`, `forbidden_prescribe`, `forbidden_med_change`,
`forbidden_diagnosis`, `forbidden_impersonation`, `forbidden_care_avoidance`
(modal negations too: "should not see a doctor", "no point in seeing"),
`forbidden_off_app`, plus `identifier_in_output`, `obfuscated_output`,
`disclaimer_in_output` (the gateway attaches the disclaimer by i18n key; a
provider may not write one), `language_unsupported`.

The groups run TWICE per segment: on the text with cited content MASKED (a
fact quoting the person's own "Metformin 500 mg" is not a dose instruction),
and then UNMASKED, where a hit is tolerated only when a cited record's own
text — display, value with unit, note, as one string — trips the same group
by itself. So the person's own record can be echoed back to them, and a
provider cannot wrap a cited fragment in an instruction ("Take Metformin
500 mg twice a day" citing "Metformin 500 mg" is refused). The joined pass
is the same pair.

The two non-response kinds have their own validators: `validateClassification`
rebuilds `{kind ∈ DOCUMENT_KINDS, confidence ∈ [0,1], method}` and refuses
`classification_shape` otherwise; `validateExtraction` admits a candidate only
as an entry of `CANDIDATE_TABLE` (display, code and kind the table's, the unit
one the table allows) and refuses `candidate_outside_table`,
`extraction_shape`, or `too_many_candidates` (over `MAX_CANDIDATES` is a
refusal, not a slice). Every output kind must match the task
(`task_mismatch`), and the client response is built from named fields —
nothing a provider writes reaches a row or the wire. Every refusal is one of
44 closed codes.

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
`started`). Both rolling-24h counts (house first, then person) ignore status;
the person's count is **per task** (`.eq("task", task)`), the house count is
every task. The per-task caps are the owner's B11 table in
`health_config.ai_daily_caps` — JSON, changed by `UPDATE`, never a migration:
`answer_question` 10, `explain_record` 5, `summarize_timeline` 3,
`classify_document` 10, `extract_document` 10 — and `capForTask` reads one
task's number at the call site; anything that is not a positive number (no
key, 0, a string, a negative) is 0 and refuses `caps_unset`. The house cap
(`ai_daily_cap_house`) still defaults to **0 = refuse** until the owner sets
it. The price row is checked in the gate, so nothing can spend before it can
price
(`MODEL_ALLOWLIST ⊆ PRICE_PER_1M` is a test). `health-ai` rate-limits at 10
per minute.

## 9. Audit

`ai.request` (ok) / `ai.refused`, `documents.classify`, `documents.extract`,
`records.confirm`, `records.reject`, through `auditDetail()` — whose whitelist
gained `task, provider, model, method, code`, then `switch` and `house` for the
config actions. Every refusal detail is a code.

The config actions audit under object type `config`: `config.ai_kill` and
`config.ai_caps` are health-api's rows — WHO asked, the admin as actor and
user, `ok` or `refused`; `config.changed` is the row trigger's — WHAT changed,
the values after the change, actor the database role, `user_id` null (a system
row, readable by admins under the audit policy). An API-driven change therefore
leaves two rows; a raw `UPDATE` leaves one. The hash chain covers all of them.

The trigger as Phase 2 shipped it named five columns, and the first value the
go sequence sets — `enabled` — was not one of them. Since
`20260908181500_oniq_health_config_audit_every_column.sql` (applied to
production the same evening, before the sequence ran) it diffs
`to_jsonb(new) - 'updated_at'` against `old`, fires on any difference, keeps the
five keys the Phase 2 rows already carry, adds `enabled` and `uploads`, and
carries `changed` — the columns that differed, with their new values. A column
added to `health_config` later is audited without an edit;
`configAuditEveryColumn.test.ts` fails if the condition ever names a column
again. Six rows on production so far (seq 1–6), every one recomputed by
`scripts/health-production-check.sql`.

**And the chain did not survive an account's erasure — found by that check,
fixed the same evening.** `health_audit.user_id` is `on delete set null`
against `auth.users`, and the chain trigger hashes it. Real erasure deletes the
auth user (`purgeUserData.ts` step 4), so every audit row naming that person
would have had a hashed column rewritten by the cascade and failed the
recompute for good. Measured on seq 4 after the throwaway probe account was
deleted: the row verifies with its original id substituted back, and seq 5
still links to it. `20260908190000_oniq_health_audit_chain_survives_erasure.sql`
changes the VERIFIER only: the user slot is `user_id`, else `actor` when it is
a UUID, else `''` — sound because both writers pass `actor = userId`
(`auditChainSurvivesErasure.test.ts` pins that over every `appendAudit` call,
comments stripped), and `actor` is text the cascade never touches. Nothing is
rewritten and nothing new is retained. Stated limit: a row whose `actor` is
not the person's id (none can be written today) would still be unverifiable
after erasure; that day needs a stored commitment column, not a verifier rule.
The same migration revokes the PUBLIC default EXECUTE Phase 1 had left on the
verifier.

## 10. Database — `20260908150000_oniq_health_phase2.sql` (applied to production 2026-09-08 — see `06 §Deploy record`)

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
2. Egress ALLOWLIST (server): each function directory is exactly `index.ts`;
   every file in the two function directories and the whole `_shared/health/**`
   tree imports only the Supabase client or a NAMED health sibling (a file
   under `ai/` reaches `../` only for the listed shared modules; `../../` is
   refused everywhere); every module reachable from an entrypoint,
   TRANSITIVELY, is inside `_shared/health`; the source with comments
   stripped and strings KEPT carries no `fetch`, `.functions`, `functions[`,
   `import(`, WebSocket, EventSource, XMLHttpRequest, sendBeacon, Worker,
   globalThis, self, navigator, eval, `new Function`, or any `Deno.` but
   `env`/`serve`; `.rpc(` only from `{health_append_audit, is_admin,
is_adult_18, has_active_legal_hold}`. Mutation-checked 2026-09-08 against
   the four escapes the red team found in the first version (a fetch inside a
   template literal; a new `ai/vertex.ts` importing `../../fetchTimeout.ts`;
   a new `health-ai/net.ts`; `functions["invoke"]`, an aliased
   `globalThis.fetch` and a `Worker`) plus an import-only escape — all seven
   red. The Phase 1 guard's model/host/fetch scan now covers the whole shared
   tree, not only the two entrypoints.
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
labels every AI-derived row (`needsAiLabel` → `HEALTH_AI_LABEL`, "AI-assisted"
— owner directive B12, rendered in place of the app-wide label, and
`AI_LABEL_OVERRIDES` in `playCompliance.ts` tells the Play guard to require
that identifier instead — + `<AiOutputReport surface="health_ai_output" />`) and offers Explain /
Summarise / Ask only when BOTH the server's `status.aiAvailable` and the
client constant `HEALTH_AI_ENABLED` are true — the server says whether
health-ai would answer, the client constant is the rollback, and gating on the
server field alone left every control visible after a client-only rollback
with each tap refused locally. `status.aiAvailable` is computed by the SAME
`checkGate` health-ai runs, on the same inputs (provider, model, caps,
environment, region, admin bit, age), so it cannot say "available" to a person
every call would refuse. A provider's own refusals (`response.refusals`) are
rendered under `health.ai.refusal.<code>` in three languages, and the answer's
"report bad output" control targets the receipt id, never a constant. The
Documents tab lists "Suggested records" whenever candidates exist (rollback
cannot strand them) and offers extraction on the same two conditions. The
Consent tab has the AI switch (recipient ONIQ). `/app/admin/health-ai` is the
verification door, linked from Profile; it also carries the two admin controls
— the emergency stop and the daily caps (house and per task), each two taps,
each an admin-gated, audited `health-api` action, with Status showing the
values the server reads (`aiKillSwitch`, `aiCaps`). All three files are in `AI_SURFACES`,
and none passes content to a report. Under every answer the disclosure is the
owner's sentence, `health.ai.disclosure` in three languages — the gateway's
`AI_DISCLAIMER_KEY`; the Health shell's general footer `health.disclaimer` is
a different sentence, because a timeline of the person's own entries is not
AI-assisted information. No health screen or string says "AI Doctor",
"Medical AI" or "Diagnosis" as a label — `surfaces.test.ts` and
`i18n.test.ts` ban the phrases.

**Phase 2 produces zero candidates and zero answers for any production user**:
the client constant `health.ai.enabled` stays false, and even with it on the
server refuses everyone but a verifying admin.

## 13. Activation and rollback

Server: `health_config.enabled AND ai_enabled AND NOT ai_kill_switch`,
`ai_daily_caps[task] > 0`, `ai_daily_cap_house > 0`, and for production
verification `ai_admin_verification_enabled`. Client:
`HEALTH_FLAGS["health.ai.enabled"]`. Off on either side is off. The house cap is 500 by owner directive
(2026-09-08, later the same day); the migration shipped 0 so the deploy landed
fail-closed, and the row was set to 500 by audited `UPDATE` at 18:18Z the same
evening (with `enabled` and `ai_admin_verification_enabled` before and after
it — `06 §Production verification`). `ai_enabled` stays off behind the Phase 3
authorization and legal gate. Rollback is the flag — or
the emergency stop on the admin screen (§3), which needs no SQL; candidates
stay reachable
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

| Requirement                                                                       | Test                                                                                                            |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Existing tests pass                                                               | the full suite                                                                                                  |
| Health → AI direct path impossible                                                | `ai/isolation.test.ts`, `isolation.test.ts`                                                                     |
| Policy engine: one input, one reason, in order; production by project             | `ai/policy.test.ts`                                                                                             |
| Consent: recipient, terms disclosure, revocation, categories                      | `consent.test.ts`, `ai/policy.test.ts`, `ai/gateway.test.ts`                                                    |
| Minimum data, aliases, quarantine, caps refuse                                    | `ai/context.test.ts`                                                                                            |
| Injection detector vs corpus; scrubber                                            | `ai/scrub.test.ts`                                                                                              |
| Contract: per-class, grounding, masking, en/hi/bn, closed codes                   | `ai/contract.test.ts`                                                                                           |
| Classification, extraction (canonical names, dates, validation)                   | `ai/classify.test.ts`, `ai/extract.test.ts`                                                                     |
| Price before spend; no default caps                                               | `ai/cost.test.ts`, `ai/policy.test.ts`                                                                          |
| Receipt before provider; never left started; caps ignore status; two users        | `ai/gateway.test.ts`                                                                                            |
| Nothing a person wrote lands in a receipt, audit or log                           | `ai/redaction.test.ts`                                                                                          |
| health-ai wired: flags → JWT → closed body → actor; Store bound; house cap named  | `ai/wiring.test.ts`                                                                                             |
| health-api: confirm gated, reject above, purge marks, legal hold, export          | `wiring.test.ts`                                                                                                |
| Migration equals the lists, named constraints, RLS, set null                      | `migration.test.ts`, `ai/migration2.test.ts`                                                                    |
| Regex safety                                                                      | `ai/regexSafety.test.ts`                                                                                        |
| Labelled where it renders; doors exist; hooks above returns                       | `ai/surfaces.test.ts`, `playCompliance.test.ts`, `adminDoors.test.ts`, `routeNesting.test.ts`, `routes.test.ts` |
| Twelve flags, both sides, all off                                                 | `flags.test.ts`                                                                                                 |
| Mirrors identical, `ai/types` included                                            | `agreement.test.ts`                                                                                             |
| en/hi/bn strings agree; every reason has three sentences                          | `i18n.test.ts`, `redact.test.ts`                                                                                |
| Red-team attacks stay refused                                                     | `ai/redteam*.test.ts`                                                                                           |
| Non-response outputs validated and rebuilt; task/kind agree; named-field wire     | `ai/redteamExfil.test.ts`, `ai/gateway.test.ts`                                                                 |
| Unit injection-checked; manifest says what was sent; scrubbed cap; analyte priors | `ai/context.test.ts`, `ai/redteamInjection.test.ts`, `ai/redteamSpend.test.ts`                                  |
| Isolation guard survives the seven mutations                                      | `scripts/health-mutate-guards.sh` (run by hand; §11)                                                            |
| `status.aiAvailable` is `checkGate`; purge fails closed; reports purged           | `ai/redteamAuthz.test.ts`, `wiring.test.ts`                                                                     |
| Audit failure after a settled receipt propagates as `audit_failed`                | `ai/redteamSpend.test.ts`                                                                                       |

## 16. Red team, second pass — what the attack files found and what changed

The adversarial workflow (five lenses: injection, authorization, spend,
server exfiltration, client exfiltration) wrote 212 attack tests against the
real gateway and left 36 of them red. Eleven findings were confirmed by
independent verifiers, the rest went unverified for want of session budget
and were read and acted on here. Everything below is a test now; the four
attack files are kept under `ai/redteam*.test.ts`.

FIXED IN CODE:

- **`valueUnit` was scrubbed but never injection-checked** — a 24-char
  instruction reached the provider and was echoed. It goes through
  `cleanField` like display and note, and excludes the row.
- **The manifest listed document text as EXCLUDED while the provider was
  handed it** (classify and extract). Classify drops the text and lists it;
  extract flags it and lists nothing. The receipt now says what was sent.
- **The cap was measured on the raw string**; scrubbing grew a 497-char
  question to 568 and a 19,999-char document past 20,000. The cap is on the
  scrubbed text and refuses.
- **Combining marks and unmapped digit scripts** walked past every pattern
  (`ig͏nore`, `táke`, Gujarati/Tamil/Thai digits). The normaliser
  strips marks off Latin letters and maps nineteen digit blocks.
- **Tamil, Urdu, Gujarati, Marathi and two Hinglish shapes** were invisible to
  the detector; they run on every language now.
- **Dose instructions in number words, or split by a full stop**, passed the
  dose groups; a cited fragment could be **wrapped in an instruction**;
  **modal care avoidance** ("you should not see a doctor") and **advice in a
  fact** ("your HbA1c means you need to fast") passed; **`u`/`ur`/`thou`**
  were not second person; **a day of month, a year or the citation count**
  grounded a fabricated value. Each is a refusal now (§6).
- **The synthetic provider's own priors** were the same KIND, not the same
  analyte — an HbA1c row became "an earlier Cholesterol reading", and a
  "Vitamin B12" target was refused as ungrounded on its own display digits.
  Priors are the same analyte and the prior segment cites the target too.
- **Only the response kind was validated**: a classification's kind and a
  candidate's display/code/unit were stored verbatim, over `MAX_CANDIDATES`
  was sliced, and a provider-invented key reached the wire. All three kinds
  are validated and rebuilt (§6), and the output kind must match the task.
- **A failed audit after an ok receipt** overwrote the receipt as a provider
  error. The settled receipt stands and `audit_failed` propagates.
- **An unverified `recordId` on a summary** became the audit row's objectId.
  Only an explained record inside the manifest is named.
- **Non-string task/provider/language** passed a `String()` name check;
  **an environment string outside `ENVIRONMENTS`** opened the synthetic
  provider to a non-admin at the gate. Exact strings and fail-closed now.
- **`status.aiAvailable` re-derived half the gate** and said "available" for
  an unlisted model, a missing date of birth or a blocked region. It calls
  `checkGate`.
- **`actPurge` ignored the legal-hold rpc's error** (an rpc failure read as
  "not held"). It refuses 500.
- **A health record uuid + reporter identity left the domain into
  `public.reports`** (admin-readable, outside the health purge). The answer's
  report now targets the receipt id, and the person's own
  `health_ai_output` report rows are the one delete in the purge.
- **Provider refusals had no rendering and no i18n key**; the AI controls
  stayed visible after a client-only rollback. Both fixed (§12).
- **Summarise read 120 rows and considered 30**; excluded rows were not
  backfilled. They are.
- **Four one-file edits opened a real egress path with every guard green.**
  The guard is rewritten (§11, item 2) and mutation-checked.

DOCUMENTED LIMITS, kept as tests that assert the limit rather than pretend:

- A fact citing two records may quote either record's value; the grounding
  check is token membership, not attribution. The client renders both source
  ids; a number from neither is still refused.
- A targeted read loads the row to learn its category before the consent
  check; its content goes nowhere (§4).
- A person's own record that IS a dose instruction is echoed back to them,
  inside a fact citing that record, and nowhere else.

CORRECTED IN THE DOCS, not the code: a refusal before the receipt is audited,
not receipted (§5). The design had promised a receipt for `no_text`; the audit
row is the proof.

NOT CHANGED, on purpose: `PRICE_PER_1M` and `MODEL_ALLOWLIST` are not frozen —
nothing in runtime code writes to them, the tests that prove the gate/cost
split mutate them deliberately, and freezing would force those tests onto
module mocks. The whole health tree is asserted to contain no assignment to
either.

## 17. Phase 3 as built — the Vertex provider behind the same gateway (owner directive 2026-09-09)

The owner authorised the full implementation, deployment and activation of
ONIQ Health AI: "Firebase → Vertex AI", behind the existing
`HealthAIProvider` abstraction, no second pipeline, no bypass, Anthropic off
the health path. What was added, and what was deliberately NOT changed:

**The provider — `supabase/functions/_shared/health/ai/vertex.ts`.** One
class, `VertexHealthAIProvider` (`id: "vertex"`, `recipient: "google_vertex"`,
`synthetic: false`), registered by a zero-arity factory next to the synthetic
one. "Firebase → Vertex" means the Firebase project's own service account
(`FIREBASE_SERVICE_ACCOUNT`, read through `_shared/googleAuth.ts` exactly as
`voice-clone` reads it), project `oniq-309bd` from inside that JSON, role
Vertex AI User (granted 2026-09-07, proven by the first successful Vertex call
the same day), endpoint `generateContent` at location `global` on
`aiplatform.googleapis.com`, model `gemini-3.1-flash-lite` (the one
`MODEL_ALLOWLIST.vertex` names; priced in `cost.ts` from the [PAGE] table in
`01`: $0.25 in / $1.50 out per 1M). The request is JSON mode with the
contract's own schema, temperature 0.2, at most 1,024 output tokens, no
tools, no grounding, a 25-second abort.

**What travels is the gateway's `ProviderInput` and nothing else** — aliases
(r1…), kinds, displays, values, units, date labels, the scrubbed question.
The provider reads no table and cannot: the isolation guard names the two
modules outside the health tree it may import (`googleAuth.ts`,
`vertexError.ts`), pins exactly one `fetch` and exactly one host literal in
the file, and `scripts/health-mutate-guards.sh` M9–M11 prove that a second
host, a third module and a rewritten host constant each go red.

**What comes back is judged by the contract HERE, one segment at a time.**
Every segment the model returns is run through `validateAiResponse` alone,
against a pseudo-manifest of aliases; a segment that cites outside the
manifest, states a number no cited record carries, advises the reader, or
carries a dose, a diagnosis, a disclaimer or an identifier is DROPPED and the
rest is answered. Nothing survives → one `unknown` segment in the request's
language with a refusal code, receipted `ok` for what it cost. The gateway
then validates the whole response again (unchanged code) and refuses
`output_rejected` if anything slipped past.

**Failures are closed codes, never sentences.** `ProviderError.code` is
`vertex_http_403_permission_denied`, `vertex_http_404_not_found`,
`vertex_timeout`, `vertex_bad_json`, `vertex_no_token`, … (Google's own STATUS
token, lower-cased, never its message). The gateway audits the code on the
`ai.refused` row and returns it as `detail.code`; Google's sentence stays on
the thrown object and dies in the catch. The receipt completes as `error`.

**The gate is unchanged and now real.** `provider_not_allowed` refuses vertex
while `health.provider_sharing.enabled` is off, naming the recipient;
`synthetic_in_production` applies only to recipient ONIQ, so an ordinary adult
in production reaches vertex with no admin verification; caps, region, age,
consent, receipt-before-provider, contract, audit — all as §3–§9 built them.

**Consent names Google or it covers nothing.** `GRANTABLE_CONSENTS` gained
`(ai_interpretation, google_vertex)`; `CONSENT_TERMS_VERSIONS.ai_interpretation`
is `health-ai-terms-v2`, and `DISCLOSED_RECIPIENTS_BY_TERMS["health-ai-terms-v2"]`
is `["oniq", "google_vertex"]`. A v1 row covers the vertex provider for
nobody (`consent.test.ts`, `redteamAuthz`, `vertex.test.ts`). `health-api`
offers a person exactly the registered provider's pair
(`recipient_not_offered` otherwise) and now reports `aiRecipient` in
`status`; the consent screen grants to THAT, never to a typed recipient.
`20260909100000_oniq_health_phase3_vertex.sql` widens the three CHECKs
(config provider, receipt provider, consent terms/recipient) to exactly what
the code names — `migration3.test.ts` — and does nothing else.

**Disclosure.** The approved statement is untouched and a recipient sentence
follows it (`HEALTH_AI_RECIPIENT_SENTENCE`): in the public notice, beside the
AI consent in English/Hindi/Bengali (`health.privacy.ai_recipient`,
translations labelled counsel-review placeholders), and in the Play
declaration (the AI-processing entry and a declared server-side host,
`aiplatform.googleapis.com`). The consent DETAIL no longer says "nothing is
sent to Google"; it names Google Cloud Vertex AI (Gemini) and the
not-used-to-train position. `privacyDisclosure.test.ts` pins every copy and
bans the retired sentence in every language.

**Anthropic is off the health path.** `supabase/functions/health-scan` is a
410 stub (no key read, no body read, no fetch — `anthropicRetired.test.ts`),
the Vitals report-scan section is gone, and the six search-fleet tests that
listed it no longer do. Deploying the stub closes the production path from
here whether or not the function is ever deleted from the dashboard.

**Not changed:** the text-source registry (`null` only — extraction still
answers `no_text` for every production user; the vertex provider can extract
and classify, proven under an injected test source, but no document byte
reaches it in production until a source is registered under its own gate);
uploads (off); the caps (B11), the house cap (500), the kill switch; the
gateway's order; the audit vocabulary; the label (B12).

**Activation and rollback (Phase 3).** Server: `ai_provider = 'vertex'`,
`ai_model = 'gemini-3.1-flash-lite'`, `provider_sharing_enabled = true`,
`ai_enabled = true`, each an audited UPDATE. Client: `health.enabled`,
`health.ai.enabled`, `health.provider_sharing.enabled` true in
`src/health/flags.ts`. Rollback is any ONE of: the emergency stop on
`/app/admin/health-ai` (seconds, no publish, forces both AI flags off);
`ai_enabled = false` (SQL, audited); `ai_provider = 'synthetic'` (the synthetic
provider stays registered and its consent pair grantable, so a rollback needs
no migration); or the client constant. Measured values, the first real POST
and the smoke test are in `07-phase3-report.md`.

## 18. Phase 3b as built — uploads on, the PDF text layer, and transcription of scans (owner directive 2026-09-09, "i want A, B and C all done")

The owner saw that Health had no attachment facility and, offered three
shapes — A: attach and keep; B: the AI reads PDFs; C: the AI reads photos and
scans — chose all three. What that added to the Phase 2/3 gateway, and what
it did not touch.

**A — uploads on.** `health.uploads.enabled` true in `src/health/flags.ts` and
`uploads_enabled = true` on the row (audited by the row trigger). The upload
flow was built in Phase 1 and had never been switched on: register → a signed
upload straight to the private bucket → confirm (size re-checked against the
stored object) → list, view through 60-second signed URLs, delete. The Play
declaration gained the "Health info" entry that `playDeclaration.test.ts`
requires exactly when the flag is on, naming reports, prescriptions and
discharge summaries.

**B — the PDF's own text layer, read on ONIQ's side.** The text-source seam
(`textSource.ts`) now reads the STORED document. `StoredDocumentSource.read()`
loads the person's own file (the loader in `health-ai/index.ts` filters the
row by the id the JWT proved and only in a readable status, then downloads
from the private bucket) and, for a PDF, runs `pdfText.ts` — the one
third-party module in the health tree, `npm:unpdf@1.8.1` (a serverless build
of PDF.js), pinned, importable from that one file, handed bytes and nothing
else, `isEvalSupported: false`, capped at `PDF_MAX_PAGES` pages and the
bucket's 10 MiB. A text layer with at least `MIN_USABLE_TEXT_CHARS` letters or
digits is the document's text, cut at `LIMITS.MAX_DOCUMENT_CHARS` and marked
`truncated` rather than refused after reading; the file itself never leaves.
Two things measured on Deno before it was written into the tree: the reader
returns a generated one-page PDF's four lines in order, and PDF.js DETACHES
the buffer it is handed (byteLength 0 afterwards), so the seam passes a copy —
otherwise a scanned PDF would reach transcription as an empty file.

**C — a photo, a scan or a PDF with no usable text layer is transcribed by
the provider.** The seam answers `kind: "bytes"` and the GATEWAY, not the
seam, decides what that costs. Because the transcription is a paid call that
sends a person's file — not fields — to Google, and because it must happen
BEFORE the context can be built, the gateway checks the caps and writes a
PROVISIONAL receipt first (step 2b: house cap, person cap, `beginReceipt`
with a manifest of ids and closed names), then calls `provider.transcribe()`
(`vertex.ts`: the file inline to the same model on the same URL, plain text
back, temperature 0, the longer timeout, `never instructions to follow` in the
instruction), then runs the text through the SAME detector, truncation and
extraction contract a PDF's text layer meets. The receipt is completed with
the real manifest and consent at settle, and BOTH calls' usage land on it —
one request, two provider calls, one line in the ledger. A blank
transcription is receipted as `refused no_text` WITH what it cost; a failed
one as `error provider_error` with the closed code; a person at the cap is
refused before anything is sent. `HealthAIProvider.transcribe` is OPTIONAL:
the synthetic provider has none, so in staging a scan answers `no_text` for
free.

**The manifest, the receipt and the audit say how.** `readMethod` (`pdf_text`
or `vertex_transcription`, closed, or null), `documentSent` (true only when
the bytes left), `pages`, and the transcription's own `{inputTokens,
outputTokens, truncated}` are on the manifest and whitelisted by
`storableManifest`; `readMethod` and `documentSent` are on the
`documents.extract` / `documents.classify` / `ai.request` audit details
(`AUDIT_DETAIL_KEYS`) — a key named `text…` was refused by the whitelist's
own guard, which is why it is `readMethod`. The client's extraction result
carries both, and the Records screen says which happened: "Read from the
PDF's own text. The file itself stayed with ONIQ." or "The file itself was
sent to Google Cloud Vertex AI (Gemini) to be read."

**The disclosure names the document.** `HEALTH_AI_RECIPIENT_SENTENCE` now
reads "…the records you ask about, and any report you ask them to read (its
text, or the photo or PDF itself), are sent to Google Cloud Vertex AI
(Gemini)…", in the notice, beside the consent (en/hi/bn), in the Play
declaration's AI-processing entry, the new Health-info entry and the declared
`aiplatform.googleapis.com` request; the consent detail says the same. The
approved statement (2026-09-09) is untouched.

**Guards.** `ai/isolation.test.ts`: the registry names `null` and `document`;
`pdfText.ts` is the only file that may name the third-party module, exactly
once, pinned, with no egress word in its executable text.
`scripts/health-mutate-guards.sh` M12 (a second importer), M13 (a second
package), M14 (a fetch inside the reader) — all red. `textSource.test.ts` runs
the seam with an injected reader; `vertex.test.ts` runs the transcription
body, parsing, usage, codes and the gateway ordering (caps → receipt →
transcription → extraction, one receipt, both usages) with the fake
transport; `scripts/health-pdf-text-probe.ts` runs the REAL reader on Deno.

**Not changed.** The gateway's order for every record task; the caps (B11),
the house cap, the kill switch, the label (B12), the audit vocabulary; the
consent pairs and terms (`health-ai-terms-v2` already covered `documents`);
the schema (no migration — the manifest is jsonb, the audit keys are a
whitelist in code). Extraction still writes CANDIDATES only; nothing joins
the timeline until the person confirms it.

**Rollback.** `health.uploads.enabled = false` (client) and `uploads_enabled =
false` (row, audited) close the attachment facility; the emergency stop or
`ai_enabled = false` stops every transcription and extraction in seconds;
documents already stored stay stored and readable. Measured values and the
live test are in `07-phase3-report.md`, "2026-09-09 (later)".

## 19. The audit chain under concurrency (2026-09-09, found by the production check)

Phase 1's `health_audit_chain()` trigger took the chain lock before reading
the latest row for `prev_hash` — but `seq` was the column default,
`nextval()`, evaluated before any BEFORE INSERT trigger runs, outside the lock.
Two concurrent appends could therefore number in one order and hash in the
other; on production the Phase 3b smoke test's two `documents.register` calls
did exactly that (seq 44 linked to 45, 45 to 43, 46 to 45), leaving row 44
referenced by nothing — deletable without breaking the chain.

Migration `20260909130000`: the trigger assigns `seq` itself, inside the lock,
from the same read that supplies `prev_hash` (`coalesce(latest.seq, 0) + 1`),
so number and link are decided together in commit order; a UNIQUE index on
`seq` makes any future numbering race an error rather than a fork; the hash
expression is unchanged so every existing row keeps verifying.

The two rows already written were repaired without rewriting a hash:
**adoption**. A later, chained row with action `chain.adopt` (object type
`chain`, written by an operator from SQL — the app's closed lists do not carry
it) names the orphan's `record_hash` in `detail.adopts`. The verifier
(`health_verify_audit_chain()`) and `scripts/health-production-check.sql`
content-verify an adopted row against its own stored `prev_hash`, leave it out
of the linking of the rows around it, and refuse an adopt row that names a
hash with no EARLIER row behind it — so the orphan can no longer vanish (the
adopting row commits to its hash), and the chain 43 → 45 → 46 → … → 58
verifies. `src/health/__tests__/auditChainSeqUnderLock.test.ts` pins the
trigger's order of operations, the unchanged digest, the unique index, the
adoption rules and the retained erasure fallback; the production check gains
`MISSING_INDEX`, `CHAIN_SEQ_NOT_UNDER_LOCK`, `AUDIT_ADOPTED_ROW_ALTERED` and
`AUDIT_ADOPTION_INVALID`.
