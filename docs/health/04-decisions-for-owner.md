# ONIQ Health — decisions that are the owner's, and what each unblocks

Under CLAUDE.md's first rule, every line here chooses a paid provider, spends
money, or changes a user-visible policy, so none of it was decided in code.
Phase 1 is built dark and needs none of these to be merged.

## A. The go sequence for Phase 1 (no money, no user change)

1. **Merge the dark build.** Nothing renders, nothing is called.
2. **Apply the migration** `20260908120000_oniq_health_phase1.sql` (Lovable agent; one message). Creates six empty tables and one private bucket; RLS deny-by-default; no client can write.
3. **Deploy `health-api`** (same message, or the next). Answers `503 health_disabled` to everyone until the row says otherwise.
4. **Turn on `health.enabled` server-side** (`update health_config set enabled = true`) — still invisible, because the client constant is `false`.
5. **Flip `HEALTH_FLAGS["health.enabled"]`** in `src/health/flags.ts` and publish. The tile, the tab and the three screens appear; documents stay off until `health.uploads.enabled` on both sides.

Before step 5, the Play Data safety form needs a "Health records" entry if uploads are on — `playDeclaration.test.ts` goes red on the flip until `DATA_COLLECTED` carries it.

## B. Paid Google surfaces (each is a provider-and-money choice)

| #   | Decision                                                                           | Recommendation                                                                                                                                  | Monthly cost at 10K / 100K users (see the cost model) |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| B1  | Which credential and model serve health prompts (Phase 3)                          | Vertex AI with a **separate** Health service account, Gemini 3.1 Flash-Lite; never a free-tier key                                              | $35 / $354                                            |
| B2  | Enable the Cloud Healthcare API and create a FHIR store in `asia-south1` (Phase 4) | Yes, when interoperability (ABDM, clinician sharing) is wanted; not before                                                                      | +$3.4 / +$39                                          |
| B3  | Where document bytes live                                                          | Supabase Storage now (Lovable-billed); move to Google blob storage only with the FHIR mirror                                                    | $0 Google / ≈ $2 / $20 if moved                       |
| B4  | Healthcare Natural Language API for extraction                                     | **No** — ~270× Gemini's cost at these volumes                                                                                                   | +$1,550 / +$17,750                                    |
| B5  | Agent Search for Healthcare                                                        | **Not in V1/V2** — $20 per 1,000 queries                                                                                                        | +$240 / +$2,400                                       |
| B6  | Google consent enforcement (`applyConsents`)                                       | **Not until records leave ONIQ** — $0.05 per consent per month                                                                                  | +$150 / +$1,500                                       |
| B7  | MedGemma                                                                           | Evaluation runs only, by the hour (≈ $34 per 8-hour run); no standing endpoint                                                                  | $0 standing; $3,084 if left on                        |
| B8  | Health Connect (Phase 5)                                                           | Needs a Capacitor plugin (Lovable adds it), the Play Health declaration, a Play release; choose the data types (steps, heart rate, sleep first) | $0 Google                                             |
| B9  | ABDM (Phase 6)                                                                     | Owner registers for the sandbox and obtains the official spec; PHR certification and WASA audit are external costs **[UNKNOWN]**                | $0 Google                                             |
| B10 | Budget alerts                                                                      | Set a GCP Billing budget with alerts at 50/80/100% on the health project; per-user and house caps stay in code                                  | —                                                     |

## C. Console actions (owner-only credentials)

- C1 Create (or reuse) a GCP project for Health; recommendation: `oniq-health-dev` for non-production datasets and production datasets in `oniq-309bd` or a dedicated `oniq-health-prod`.
- C2 Enable `healthcare.googleapis.com`; grant the Health service account per-store roles only (no dataset admin on the runtime principal).
- C3 Turn on Cloud Audit Logs data-access logging for the Healthcare API.
- C4 Vertex: confirm the data-governance position (no training) and ask the account team for zero-data-retention terms if counsel wants them in writing.
- C5 Play Console: Health apps declaration (when Health Connect ships) and the Data safety update (when uploads or AI ship).
- C6 The Firebase/GCP console items still open from earlier days (Email/Password off, third-party auth registration, Firestore confirmation) are unrelated to Health and unchanged.

## D. Legal counsel items (flagged, not decided)

- D1 Retention periods per category (`health_retention_policies` ships with placeholders).
- D2 Whether ONIQ is or will become a Significant Data Fiduciary under DPDP once health records are held at scale.
- D3 The itemised consent notice text for each purpose (`store_records`, `ai_interpretation`, `share_with_clinician`, `health_connect_sync`, `abdm_exchange`, `research_deidentified`) in English, Hindi and Bengali.
- D4 The privacy-notice change required before any health AI: today's sentence "Health data is never sent to any AI feature" must become a true, specific statement — see `02-architecture.md` §16.
- D5 A health-specific breach runbook (72-hour Board notification) added to `docs/incident-response.md`.
- D6 Whether a DPIA is required before Phase 3 (AI on health data) and Phase 9 (research export).
- D7 Age: whether health features are offered to under-18 accounts at all, and the parental-consent wording if so.
- D8 The UAE block: whether other jurisdictions in the country registry need the same treatment for medical records.
- D9 Health Connect and ABDM terms of participation, once the official documents are in hand.

## E. Free checks to run before any of B (no credit, no spend)

- E1 `GET healthcare.googleapis.com/v1/projects/<project>/locations` with the service account — answers whether the API is enabled and which regions are offered; `asia-south1` present settles the residency question.
- E2 The privacy-audit SQL (`scripts/privacy-audit.sql`) after the migration — must return zero rows.
- E3 `select * from health_verify_audit_chain()` — must be ok before and after the first real event.
- E4 `npm test` — the isolation and door guards are the cheapest protection against the next agent leaking a health table into a prompt.
