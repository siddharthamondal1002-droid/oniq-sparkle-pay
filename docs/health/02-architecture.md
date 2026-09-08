# ONIQ Health — architecture

Status: Phase 1 is built **dark** (every flag `false`, migration not applied,
function not deployed). Phases 2–9 are designed here and not built.

## 1. Principles, in the order they are enforced

1. **Consent before processing.** No health row is written and no document is registered unless an active `store_records` consent covers the data category. Revocation is one action and takes effect on the next request.
2. **Provenance on every datum.** A record without a source is refused at the type level and at the database (`provenance jsonb NOT NULL` with a CHECK on `source`).
3. **Audit without content.** `health_audit` records who, what kind, which object, under which consent, with which outcome — never a value, a title, a note or a file name. The chain is sha256-linked and verifiable.
4. **Isolation.** Only `src/health/**`, the four `app.health*` routes, `supabase/functions/health-api/**` and `supabase/functions/_shared/health/**` may name a health table or the health bucket. A test enumerates the whole tree and fails on any other match, comments stripped.
5. **Flags everywhere, fail closed.** Client flags are compile-time constants; server flags are a single `health_config` row, and a missing row means "off".
6. **Not a doctor.** No feature diagnoses, prescribes, doses or changes medication. The AI phase (not built) is specified below with that as a hard filter, not a prompt suggestion.
7. **Nothing native, nothing Google-privileged, nothing shared, until its phase.** Phase 1 makes no call outside Supabase.

## 2. Module layout (Phase 1)

```
src/health/                       the only client code that names the health tables
  flags.ts        HEALTH_FLAGS — the eleven names, all false; HEALTH_ENABLED
  domain.ts       HealthRecord, HealthDocument, Provenance, HealthConsent, closed lists
  consent.ts      consentCovers(), activeConsents() — pure
  redact.ts       redactForLog(), safeMessage() — pure
  retention.ts    expiryFor() — pure
  api.ts          healthApi(action, payload) → the one caller of health-api
  i18n.ts         health.* strings for en / hi / bn, registered as an overlay
  doors.ts        HEALTH_WORLD (Home tile), HEALTH_NAV (bottom tab) — pre-wired, flag-gated
  __tests__/      flags, agreement, consent, redact, doors, isolation, migration,
                  wiring, Play declaration, i18n, retention
src/routes/_authenticated/
  app.health.tsx           flag gate → header → <Outlet />
  app.health.index.tsx     timeline of records (provenance chips)
  app.health.records.tsx   documents: register → upload → confirm; list; delete
  app.health.consent.tsx   consents (grant / revoke), export, purge
supabase/functions/_shared/health/
  domain.ts consent.ts redact.ts retention.ts    byte-identical mirrors of src/health (drift-tested)
  flags.ts        readHealthFlags(admin) → all eleven, false when the row is missing
  audit.ts        auditDetail() whitelist, event names
  adapter.ts      HealthcareAdapter interface + NullAdapter (Phase 4 adds GoogleFhirAdapter)
supabase/functions/health-api/index.ts
supabase/migrations/20260908120000_oniq_health_phase1.sql
docs/health/                      this folder
```

Deno functions cannot import from `src/`, and `src/` must not import from `supabase/functions` at runtime (the bundle test forbids escapes in the other direction). So the pure modules exist twice and `agreement.test.ts` asserts the two copies are identical with comments stripped — the pattern `src/data/languages.ts` already uses.

## 3. Domain model (above FHIR)

| Type               | Fields                                                                                                                                                                                                    | FHIR mapping (Phase 4 adapter)                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HealthRecord`     | `id, userId, kind, code?{system,code,display}, valueNum?, valueUnit?, valueText?, effectiveAt, recordedAt, status, provenance, documentId?, expiresAt?`                                                   | `kind` → `Observation` (vital, lab), `Condition`, `MedicationStatement`, `AllergyIntolerance`, `Immunization`, `Procedure`, `Encounter`; `code` → `CodeableConcept` (LOINC / SNOMED / ICD-10 / ATC allowed systems); `provenance` → FHIR `Provenance` |
| `HealthDocument`   | `id, userId, kind, title, mime, sizeBytes, sha256?, status, capturedAt?, provenance, expiresAt?` (storage path is server-only, never returned)                                                            | `DocumentReference` with `content.attachment.url` pointing at the blob                                                                                                                                                                                |
| `Provenance`       | `source ∈ {user_entry, document_upload, document_extraction, health_connect, abdm, clinician_import, ai_interpretation}`, `sourceRef?, capturedAt, method?, confidence?, verifiedBy? ∈ {user, clinician}` | `Provenance.agent` / `entity`                                                                                                                                                                                                                         |
| `HealthConsent`    | `consentId, userId, purpose, dataCategories[], source, recipient, startTime, expiryTime?, status ∈ {active, revoked, expired}, revokedAt?, createdAt, version, termsVersion`                              | FHIR `Consent` (only if Google enforcement is ever used)                                                                                                                                                                                              |
| `HealthAuditEvent` | `seq, id, userId, actor, action, objectType, objectId?, purpose?, consentId?, requestId, outcome, detail (whitelisted keys only), createdAt, prevHash, recordHash`                                        | none (ONIQ-internal)                                                                                                                                                                                                                                  |
| `RetentionPolicy`  | `category, retentionDays, basis`                                                                                                                                                                          | none                                                                                                                                                                                                                                                  |

Closed lists live in `domain.ts` on both sides:

- `RECORD_KINDS`: vital, lab, condition, medication, allergy, immunization, procedure, encounter, note
- `DATA_CATEGORIES`: vitals, labs, conditions, medications, allergies, immunizations, procedures, encounters, documents, notes, device_metrics
- `CONSENT_PURPOSES`: store_records, ai_interpretation, share_with_clinician, health_connect_sync, abdm_exchange, research_deidentified
- `RECIPIENTS`: oniq, google_vertex, clinician, abdm, research
- `DOCUMENT_KINDS`: lab_report, prescription, discharge_summary, imaging_report, vaccination, invoice, other

## 4. Consent model

- A consent is `purpose × dataCategories × recipient × [startTime, expiryTime)`, versioned. Granting the same purpose+recipient again revokes the previous version and writes version + 1, so history is never edited.
- `consentCovers(consent, need, now)` is the only evaluation rule and it is pure: status active, purpose equal, recipient equal, every needed category present, `startTime ≤ now`, and `expiryTime` absent or `> now`.
- **Where enforced:** in `health-api`, before every write (`store_records` for the record's category) and before every processing purpose that is not the person viewing their own data. Viewing your own data needs no consent beyond being you (RLS + ownership filter).
- **Revocation effects:** immediate on the next request. Writes in the revoked category are refused with a message that names the switch to turn back on. Existing rows stay (the person may still read and delete them) until they choose **purge**, which is one action away on the same screen. Retention policies may also expire them.
- **Children:** ONIQ's signup gate already routes under-threshold accounts through verifiable parental consent; Health does not re-implement it, and the AE/UAE block applies to the new tables through the same trigger.
- **The ISO 27560 ledger is reused, not replaced.** ONIQ already keeps `public.consent_records` (per-user hash chain, `purpose_id`, `notice_version`, `notice_locale`, `consent_state`, `jurisdiction`) with an audit trigger into the global `audit_log`. Every Health grant and revoke writes a row there too (`purpose_id = health.<purpose>`), so the cross-app consent history stays complete; `health_consents` carries the Health-specific shape (categories, recipient, window, version) that the ledger does not.

## 5. Provenance rules in the UI

| Source                                     | Label shown                                        | Extra                                                   |
| ------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------- |
| `user_entry`                               | "You entered this"                                 | editable / deletable                                    |
| `document_upload`                          | "From a document you uploaded"                     | link to the document                                    |
| `document_extraction`, `ai_interpretation` | "AI-read from your document" / "AI interpretation" | **AI label**, confidence, "verify against the document" |
| `health_connect`                           | "From your phone's Health Connect"                 | device and time                                         |
| `abdm`                                     | "From ABDM (facility name)"                        | consent artefact id                                     |
| `clinician_import`                         | "Imported from your clinician"                     |                                                         |

An unknown source renders as AI (over-label, never under-label — the rule already recorded for character portraits).

## 6. Audit

Events: `records.create`, `records.delete`, `documents.register`, `documents.confirm`, `documents.read`, `documents.delete`, `consents.grant`, `consents.revoke`, `export`, `purge`, `status` (read of the person's own overview is not audited; document reads are, because a signed URL is minted).

`detail` may contain only: `kind`, `category`, `documentKind`, `mime`, `sizeBytes`, `count`, `status`, `reason`, `version`, `purpose`, `recipient`. `auditDetail()` drops everything else and a test proves a record's values cannot pass through.

Chain: `health_audit_chain()` copies `audit_log_chain()` with its own advisory lock; `health_verify_audit_chain()` recomputes. Rows are appended only by `health_append_audit()` (SECURITY DEFINER, executable by `service_role` only). Admins may `SELECT` audit rows; nobody has an admin read path to record or document content.

**Audit runs after the write, and a failed audit fails the request.** In Phase 1 the mutation and its audit row are two statements; if the append fails after the row is written, the function answers `500 audit_failed` rather than pretending nothing happened, and the row stands. Phase 2 moves write-plus-audit into one SQL function so they commit or fail together; recorded here so it is not mistaken for a finished design.

## 7. The request pipeline in `health-api`

```
parse JSON → read health_config (missing ⇒ all off)
  → health.enabled false ⇒ 503 {reason:"health_disabled"}         (before any user-specific read)
  → verify JWT (asCaller.auth.getUser) ⇒ 401
  → per-action flag (uploads ⇒ health.uploads.enabled) ⇒ 503
  → consent check for writes / processing ⇒ 403 {reason:"consent_required", purpose, category}
  → action with .eq("user_id", user.id) on every read and write   (service role, so this IS the boundary)
  → DB trigger health_write_guard() refuses AE-home / AE-region writes ⇒ 403
  → health_append_audit(...)
  → json(body, status)                                              (body-first convention)
```

Refuse, never degrade: a missing consent is a 403 with the purpose named, not a silent skip.

## 8. Documents

- Bucket `health-documents`, private, **no storage policy for `authenticated`**; the service role mints a signed **upload** URL (PUT) and 60-second signed **read** URLs. Path: `{uid}/health/{uuid}.{ext}`.
- Allowed: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`; max 10 MB (Phase 1). The client reads a 12-byte head through a stream reader to check the magic bytes before registering; whole-file reads (`arrayBuffer`, `readAsDataURL`) are banned on upload paths repo-wide and the wiring test bans them here too. `sha256` is therefore optional in Phase 1 and is filled by the processing worker of Phase 2.
- Delete marks the row (`status = 'deleted'`, `storage_path = null`) and removes the bytes — row first, bytes second, for the reason recorded in the creations delete.
- Account deletion: the bucket is in `PURGE_BUCKETS`; the rows cascade from `profiles`.

## 9. Retention

`health_retention_policies (category, retention_days, basis)` seeded with **placeholder** periods labelled as such (documents 3650 days, records 3650, audit 2555, consents: kept for the life of the account plus 2555 days) — counsel sets the real ones. `expires_at` is computed at write time by `expiryFor(category, now, policies)` (pure, mirrored). `health_apply_retention()` marks expired rows `deleted`; scheduling it (pg_cron) is an owner decision because it is a deletion policy.

## 10. Flags

| Flag                               | Gates                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health.enabled`                   | the module, every door, every action                                                                                                                                               |
| `health.uploads.enabled`           | `documents.*` actions and the Records screen                                                                                                                                       |
| `health.ai.enabled`                | Phase 2's gateway (synthetic provider, in-process). A provider that LEAVES ONIQ (Phase 3) additionally needs `health.provider_sharing.enabled` and the privacy-notice change (§16) |
| `health.health_connect.enabled`    | Phase 5 native sync                                                                                                                                                                |
| `health.abdm.enabled`              | Phase 6                                                                                                                                                                            |
| `health.fhir.enabled`              | Phase 4 mirror                                                                                                                                                                     |
| `health.dicom.enabled`             | Phase 7                                                                                                                                                                            |
| `health.hl7.enabled`               | HL7v2 ingestion (no phase; only if a hospital feed exists)                                                                                                                         |
| `health.medgemma.enabled`          | Phase 8 evaluation endpoint                                                                                                                                                        |
| `health.healthcare_search.enabled` | Agent Search for Healthcare                                                                                                                                                        |
| `health.research.enabled`          | Phase 9 de-identified analytics                                                                                                                                                    |
| `health.provider_sharing.enabled`  | §83C's twelfth switch: the gate a provider must pass to carry a health byte OUT of ONIQ (recipient ≠ `oniq`). No Phase 2 provider does                                             |

Client and server carry the same twelve names; `flags.test.ts` fails if they drift. To turn a flag on: client — change the constant in `src/health/flags.ts` and publish; server — `update health_config set enabled = true` (or the column for the feature) through the Lovable agent or the owner's SQL, and the change is live on the next request.

## 11. Environments and test data

Recommendation: a second GCP project (`oniq-health-dev`) for every non-production Healthcare API dataset, and a non-production Supabase branch/project for Health migrations before they touch production. `health_config.environment` names the environment the row believes it is in; a future `records.seed` action refuses unless it is not `production`. Tests use fixtures only; no real person's data appears in any test, doc or log in this repository.

## 12. Notifications

Phase 1 sends none. When one is sent (Phase 2+), it may say only "ONIQ Health: something new in your records" with a deep link; no kind, value, title or document name. `isolation.test.ts` fails if `send-push` or `push.ts` learns a health kind.

## 12a. AI labelling on the timeline

Phase 1 rows were all `user_entry`. Phase 2 can produce `document_extraction` rows (a confirmed candidate), so `app.health.index.tsx`, `app.health.records.tsx` and the admin door are in `AI_SURFACES` under `health_ai_output`, and the timeline renders `AI_OUTPUT_LABEL` + `<AiOutputReport />` for every row `needsAiLabel()` is true for — `ai/surfaces.test.ts` and `playCompliance.test.ts` guard it.

## 13. Admin

Admins (`is_admin`) may read `health_audit` and the flags row. There is no admin action that returns a record value or a document, and none is planned; support cases work from audit rows and the person's own export.

## 14. Internationalisation

Every user-facing Health string is a `health.*` key registered for `en`, `hi` and `bn`; `i18n.test.ts` fails if the three key sets differ or any value is empty. Numbers and dates render through the existing locale plumbing.

## 15. Phases 2–9 (designed, not built)

- **Phase 2 — the Health AI safety gateway + document intelligence (BUILT DARK, see `05-phase2-ai-gateway.md`):** the gateway, policy engine, consent enforcement, minimum-data context, redaction, provider abstraction with a SYNTHETIC-only registry, model allowlist, receipts, audit, the four-class response contract, rules-based classification and extraction into candidate records the person confirms, caps from the row. No text source is registered, so production extraction answers `no_text`. Nothing leaves the process.
- **Phase 3 — a real provider:** a registry entry whose recipient is not ONIQ (refused until `health.provider_sharing.enabled`), a model in the allowlist with a dated price row, the `google_vertex` consent pair under a NEW terms version, a text source (OCR / Gemini on Vertex with the Health service account) registered in `TEXT_SOURCE_REGISTRY`, the prompt adapter that renders the STRUCTURED provider input with delimiters, an evaluation suite in CI, zero-data-retention terms; **blocked until §16 is done, and NOT AUTHORIZED (owner + legal gate)**.
- **Phase 4 — Google Healthcare adapter:** `GoogleFhirAdapter` implements `HealthcareAdapter` (put/get/search/delete/export) against a FHIR R4 store in `asia-south1`; Postgres stays authoritative and the mirror is eventually consistent; a user write never waits on Google; per-store IAM; Cloud Audit Logs on.
- **Phase 5 — Health Connect:** Capacitor plugin (Lovable adds the dependency), explicit per-type permissions, Play Health declaration, a Play release; `health_connect` provenance; steps/heart rate/sleep first.
- **Phase 6 — ABDM:** after sandbox credentials and the official spec; ONIQ as PHR app; consent artefacts stored under `abdm_exchange`; WASA and PHR certification are external.
- **Phase 7 — DICOM:** DICOM store, rendered previews via the API, imaging reports as documents until then.
- **Phase 8 — MedGemma:** hourly evaluation endpoint against the Phase 3 suite; never a product until it wins.
- **Phase 9 — analytics:** de-identified export to BigQuery under `research_deidentified` consent only; opt-in, revocable, with a re-identification review by counsel.

## 16. The privacy-notice change the AI phase needs

`src/routes/privacy.tsx` says **"Health data is never sent to any AI feature."** and `playCompliance.test.ts` verifies no edge function names the three Vitals tables. **Phase 2 does not contradict the sentence**: its only provider is an in-process synthetic checker, and `ai/isolation.test.ts` ties the sentence to `RECIPIENT_FOR_PROVIDER` holding no recipient but ONIQ. Phase 3 contradicts the sentence. Before a real provider goes live: the notice must state which health data is sent, to whom (Google, on Vertex or the paid Gemini API), that it is not used to train, and that it happens only under a consent the person can withdraw; Play Data safety must declare it; the test must be rewritten to assert the new, true sentence. Owner and counsel decision.

## 17. Definition of Done (Phase 1) — each line is a test

| Requirement                                                      | Test                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| Existing tests pass                                              | the full suite                                          |
| Health tables named nowhere outside the module                   | `isolation.test.ts`                                     |
| No model or Google call in Phase 1                               | `isolation.test.ts`, `wiring.test.ts`                   |
| Consent required for writes; revocation refuses                  | `consent.test.ts`, `wiring.test.ts`                     |
| Every mutation audited, no content in audit                      | `wiring.test.ts`, `redact.test.ts`, `migration.test.ts` |
| Flags identical on both sides, all false                         | `flags.test.ts`                                         |
| Doors shut, and openable by one flag                             | `doors.test.ts`                                         |
| Migration: RLS on, cascade, AE guard, private bucket, hash chain | `migration.test.ts`                                     |
| Play declaration must change when uploads go live                | `playDeclaration.test.ts`                               |
| en/hi/bn strings agree                                           | `i18n.test.ts`                                          |
| Deletion covers the bucket                                       | `purge.test.ts`                                         |
