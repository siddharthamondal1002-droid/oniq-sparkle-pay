# ONIQ Health — Google healthcare research report

Written 2026-09-08. Every figure carries a source label:

- **[PAGE]** read directly from a `cloud.google.com` page fetched from this container on 2026-09-08 (the pages under `docs.cloud.google.com` are proxy-blocked here, the pricing pages are not).
- **[SNIPPET]** a web-search result snippet of an official or third-party page that could not be fetched. Treat as a pointer, not a citation.
- **[MEASURED]** probed from this container.
- **[TRAINING]** the author's prior knowledge, not verified today. Verify before relying on it.
- **[UNKNOWN]** could not be established from here.

Prices are USD list prices as Google publishes them; no reseller or negotiated rate is assumed. Historical prices are not quoted anywhere in this document.

## 1. Product inventory

| Product                                                            | What it does                                                                                                                                     | Where it would sit in ONIQ                                                                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud Healthcare API — FHIR stores                                 | Managed FHIR R4 (also STU3/DSTU2) resource store with search, bulk export, Pub/Sub notifications                                                 | The interoperable copy of a person's structured records (V2). Postgres stays the system of record for identity, consent and audit.                                           |
| Cloud Healthcare API — DICOM stores                                | DICOMweb store, rendered retrieval, transcoding, Nearline/Coldline/Archive classes                                                               | Imaging (V3). ONIQ users hold X-ray/CT/MRI mostly as PDFs and photos; raw DICOM is rare on a phone.                                                                          |
| Cloud Healthcare API — HL7v2 stores                                | Message store for hospital feeds                                                                                                                 | Not in scope for a consumer app; only relevant if a hospital pushes ADT/ORU messages to ONIQ (V3 at the earliest).                                                           |
| Cloud Healthcare API — de-identification                           | FHIR/DICOM de-id (redact, replace, hash, date-shift, infoType inspection)                                                                        | Required before any analytics or research export (V3).                                                                                                                       |
| Cloud Healthcare API — Consent Management API                      | Consent stores, user data mappings, attribute definitions, access determination; and FHIR `Consent` enforcement on FHIR stores (`applyConsents`) | Optional. ONIQ's own consent table is the authority in V1/V2; Google's enforcement matters only once records are shared with other parties from the FHIR store.              |
| Healthcare Natural Language API                                    | Entity analysis over medical text with vocabulary linking                                                                                        | Candidate for extracting structured facts from uploaded reports. Priced per 1,000 characters; see §3 — Gemini extraction is an order of magnitude cheaper at ONIQ's volumes. |
| Agent Search for Healthcare (Vertex AI Search, healthcare edition) | Medically tuned search over FHIR/document corpora with grounded answers                                                                          | V2/V3 candidate for "find in my records". Expensive per query (§3).                                                                                                          |
| Gemini on Vertex AI / Gemini API                                   | General multimodal models                                                                                                                        | The AI layer for grounded explanation of the person's own records (Phase 3), once the privacy notice allows it.                                                              |
| MedGemma (Health AI Developer Foundations)                         | Open-weight Gemma 3 variants tuned on medical text and images; 4B multimodal and 27B                                                             | Evaluation only; self-hosted; not a product.                                                                                                                                 |
| Health Connect (Android)                                           | On-device health data hub with typed permissions                                                                                                 | Native plugin + Play Health declaration (Phase 5).                                                                                                                           |
| BigQuery, Pub/Sub, Cloud Storage, Sensitive Data Protection        | Data plane                                                                                                                                       | Analytics on de-identified exports; event fan-out; document bytes; DLP as a second inspection engine.                                                                        |

## 2. Regions, auth, limits

**Regions.** The Cloud Healthcare API regions page lists `asia-south1` (Mumbai) among the Asia Pacific locations, with `asia-south2` (Delhi) absent from the snippet **[SNIPPET — docs page blocked here]**. A dataset's location is fixed at creation; data at rest stays in it **[SNIPPET]**. From this container, `GET healthcare.googleapis.com/v1/projects/oniq-309bd/locations/asia-south1/datasets` answered `401` with a JSON error, as did `us-central1` **[MEASURED]** — the host and path pattern resolve; entitlement is unknown until a credential is presented. Recommendation: **`asia-south1` for every dataset**; DPDP does not require it (§7) but ABDM participants and users expect Indian residency, and the Agent Search / Gemini `global` endpoints are separate from where the data rests.

**Authentication.** The Healthcare API accepts OAuth 2 credentials asserting a principal (service account, or a user token). API keys are not accepted for privileged operations **[TRAINING, consistent with the Vertex measurement recorded in `_shared/googleAuth.ts`: "API keys are not supported by this API"]**. ONIQ already mints service-account tokens server-side; the same module serves the Healthcare API. The key stays in Supabase secrets; nothing Google-privileged ever reaches the Android app.

**IAM (least privilege).** Grant per store, not per project **[TRAINING — verify role names in the console]**: `roles/healthcare.fhirResourceEditor` on the FHIR store the app writes, `roles/healthcare.dicomEditor` only when DICOM ships, `roles/healthcare.consentEditor` only if the Consent API is used, and **no** `datasetAdmin` on the runtime principal. A separate service account for Health is recommended so a compromise of the Firebase account does not reach medical data.

**Quotas and limits.** Per-project request quotas exist and are raised by request **[TRAINING]**; the exact defaults could not be read here **[UNKNOWN]**. FHIR resources are limited in size (the documented cap is in the single-digit megabytes) **[TRAINING]**; documents belong in blob storage with a `DocumentReference` pointing at them, not inline.

**Data governance for models.** Vertex AI does not use customer prompts or responses to train models, and enterprise customers can obtain zero-data-retention terms through a DPA amendment **[SNIPPET — Vertex data governance page]**. The Gemini Developer API's paid tier likewise does not use prompts to improve products; the **free tier does** **[SNIPPET]**. Rule for ONIQ: health prompts only ever go through Vertex (service account) or the paid Gemini API key, never a free-tier key, and the choice is recorded beside the call.

## 3. Pricing — current list prices, as read

### Cloud Healthcare API **[PAGE, `cloud.google.com/healthcare-api/pricing`]**

| Item                                             | Price                                                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Structured storage (FHIR, HL7v2, consent stores) | first 1 GiB-month free; 1–1,024 GiB-month $0.000328767/GiB-hour (≈ $0.24/GiB-month); above $0.000260274/GiB-hour (≈ $0.19)                                                                             |
| Blob storage (DICOM instances, attachments)      | first 1 GiB-month free; then $0.000027397/GiB-hour (≈ $0.02/GiB-month)                                                                                                                                 |
| Standard requests                                | first 25,000/month free; then $0.39 per 100,000; $0.29 above 1 billion                                                                                                                                 |
| Complex requests (search, validate, etc.)        | first 25,000 free; $0.69 per 100,000; $0.59 above 1 billion                                                                                                                                            |
| Multi-operation requests (bundles)               | first 25,000 free; $0.39 per 100,000                                                                                                                                                                   |
| Advanced operations (point-in-time recovery)     | $0.99 per 100,000                                                                                                                                                                                      |
| Notifications (Pub/Sub)                          | first 100,000 free; $0.29 per million                                                                                                                                                                  |
| Export batch / streaming                         | $0.14 / $0.29 per GiB in the 1–1,024 GiB tier                                                                                                                                                          |
| DICOM Nearline / Coldline / Archive at rest      | $0.000027397 / $0.000013699 / $0.00000411 per GiB-hour; retrieval $0.01 / $0.02 / $0.05 per GiB, plus a complex request each                                                                           |
| De-identification — inspection                   | first 1 giga-unit free; $0.30 per GU to 1 TU; $0.20; $0.10 (units = bytes × infoTypes, minimum 10 infoTypes)                                                                                           |
| De-identification — transformation               | first 1 GU free; $3.00 per GU to 1 TU; $2.00; $1.00                                                                                                                                                    |
| De-identification — processing                   | structured batch $0.60/GiB (1–1,024 GiB); blob batch $0.08/GiB                                                                                                                                         |
| FHIR consent enforcement                         | $0.05 per active patient consent per month; $50 per active admin policy per month                                                                                                                      |
| Consent Management API                           | managed consents $0.000068493/hour (≈ $0.05/month); batch access determination $0.016 per million; a promotional period waives storage and standard/complex operations on consent stores **[SNIPPET]** |
| Inter-region transfer, Asia Pacific              | $0.05/GiB                                                                                                                                                                                              |

### Healthcare Natural Language API **[PAGE, same page]**

Text record = 1,000 characters. First 2,500 text records/month free; low-volume tier **$0.10 per text record** (implied by the worked example: 0.8 record → $0.08); high-volume tier above 1,000,000 records (the page's example implies a lower rate; the per-record number for that tier was not printed as a number on the page **[UNKNOWN]**).

### Agent Search for Healthcare **[PAGE, `cloud.google.com/generative-ai-app-builder/pricing`]**

| Item                                 | Price                                                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Healthcare Search                    | **$20.00 per 1,000 queries** ($18 / $16 with 1- / 3-year flexible savings plans)                                                                                 |
| General Agent Search, for comparison | $1.50 per 1,000 (Standard); Enterprise data retrieval $4.00 per 1,000; grounded generation on own data $2.50 per 1,000; grounding on Google Search $35 per 1,000 |
| Free allowance (general search)      | 10,000 queries/month **[SNIPPET]**                                                                                                                               |

Preview features of the healthcare edition (GenAI answers, streaming index updates) "may be priced differently" at GA **[PAGE]**.

### Gemini on Vertex AI **[PAGE, `cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing`, global endpoint, ≤ 200K input]**

| Model                                             | Input / 1M tokens                            | Output / 1M tokens             | Notes                                                     |
| ------------------------------------------------- | -------------------------------------------- | ------------------------------ | --------------------------------------------------------- |
| Gemini 3.1 Flash-Lite (ONIQ's current text model) | $0.25 (audio $0.50)                          | $1.50                          | non-global +10%                                           |
| Gemini 3.1 Pro Preview (ONIQ's heavy tier)        | $2.00 (> 200K: $4.00)                        | $12.00 (> 200K: $18.00)        |                                                           |
| Gemini 3.5 Flash-Lite                             | $0.30                                        | $2.50                          |                                                           |
| Gemini 3.5 Flash                                  | $1.50                                        | $9.00                          |                                                           |
| Gemini 3.6 / 3.7 / 3.8 Flash                      | $0.75 introductory to 2026-12-31, then $1.50 | $3.75 introductory, then $7.50 | the page states the standard rate applies from 2027-01-01 |
| Cached input                                      | 10% of input                                 |                                |                                                           |

### MedGemma hosting **[PAGE, Vertex prediction machine table on the same pricing site]**

MedGemma has no per-token price: it is an open-weight model you deploy to your own endpoint and pay for the machine.

| Machine (on-demand, 1 hour)      | Price                                 | Fits                                                                     |
| -------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `g2-standard-12` (1× L4, 24 GB)  | $1.15069                              | MedGemma 4B                                                              |
| `a2-highgpu-1g` (1× A100 40 GB)  | $4.2244949 ($3.38 with a 3-year plan) | MedGemma 27B (quantised or with tight limits) **[TRAINING for the fit]** |
| `a2-ultragpu-1g` (1× A100 80 GB) | $5.7818474                            | MedGemma 27B comfortably                                                 |

24 × 7 on one A100 40 GB is **≈ $3,081/month** before any user exists. Model facts: MedGemma comes as a 4B multimodal and a 27B text variant, built on Gemma 3 **[PAGE — README at `raw.githubusercontent.com/google-health/medgemma`]**; a "MedGemma 1.5" refresh in January 2026 kept 4B and 27B sizes **[SNIPPET]**; the Health AI Developer Foundations terms define "Clinical Use" as use in diagnosis or treatment and place evaluation, adaptation, and regulatory responsibility on the developer **[SNIPPET]**. It is a building block for evaluation, not a patient-facing chatbot.

### Data plane

| Item                                       | Price                                                                                                | Source     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------- |
| Cloud Storage, Mumbai, Standard at rest    | $0.000027397/GiB-hour (≈ $0.020/GiB-month)                                                           | **[PAGE]** |
| Cloud Storage operations                   | Class A $0.005 / 1,000; Class B $0.0004 / 1,000                                                      | **[PAGE]** |
| BigQuery on-demand analysis                | $6.25/TiB scanned; first 1 TiB/month free                                                            | **[PAGE]** |
| BigQuery storage                           | active logical $0.000031507/GiB-hour (≈ $0.023/GiB-month); long-term $0.000021918; first 10 GiB free | **[PAGE]** |
| Pub/Sub                                    | first 10 GiB/month free; $40/TiB; BigQuery/Storage subscriptions $50/TiB                             | **[PAGE]** |
| Sensitive Data Protection (DLP) inspection | $1.00/GiB (content methods; tiers to $0.60); storage inspection $3.00/GiB; transformation $2.00/GiB  | **[PAGE]** |

## 4. Standards

- **FHIR R4** is the interchange format ABDM mandates (with India-specific profiles from NRCeS) **[SNIPPET; TRAINING for NRCeS]**. ONIQ's domain model sits _above_ FHIR (see the architecture document): the app never edits FHIR JSON directly; an adapter maps `HealthRecord` → `Observation`/`Condition`/`MedicationStatement`/`AllergyIntolerance`/`Immunization`/`Procedure`/`DocumentReference` and back.
- **HL7v2** only enters if a hospital feed is ever connected. Not designed for now.
- **DICOM** enters with imaging in V3; the Healthcare API DICOM store handles storage classes, rendered frames and transcoding.
- **De-identification** is a Healthcare API operation over a FHIR or DICOM store; configure infoTypes explicitly and keep the minimum-10-infoType billing rule in mind.
- **Consent**: two layers. ONIQ's own table (authoritative, free, DPDP-shaped) and, only when records leave ONIQ through the FHIR store, Google's consent enforcement.

## 5. AI: grounding, safety, evaluation

Design rules (all enforced by tests once Phase 3 is built):

1. Every answer is assembled from labelled sources: **record-derived fact** (with the record id and provenance), **general information**, **AI interpretation**, **unknown**. The model is asked to emit these four classes explicitly; the UI renders them differently.
2. No diagnosis, no prescription, no dosage, no medication change. The refusal is in the system prompt _and_ in a post-filter that blocks output matching prescription patterns.
3. Health chat is a separate route, a separate function and a separate table; nothing from it enters `ting`, `study-*` or any other prompt, and nothing from those enters it.
4. Every health prompt goes through Vertex or the paid Gemini key; free-tier keys are refused by the code path.
5. An evaluation suite of synthetic records with expected answer classes runs in CI; a fabricated value (a number not present in the records) fails the suite.

MedGemma is for **offline evaluation** against that suite (and possibly document-image extraction) — not the production answer engine in V1/V2. Healthcare NLP is a candidate extractor but costs ~$0.10 per 1,000 characters against Gemini Flash-Lite at ~$0.25 per **million** input tokens; the cost model shows the gap.

## 6. Health Connect (Android)

- Explicit per-type permissions declared in the manifest and in the Play Console Health apps declaration; only types the feature needs; a documented justification per type; the January 2026 policy tightening added a medical-device labelling system and per-type justification for medical-record types **[SNIPPET]**.
- The app never assumes access: every read is preceded by a permission check, and revocation is handled as an empty result, not an error.
- Old Google Fit APIs are not used **[requirement]**.
- ONIQ has no Capacitor Health Connect plugin today; adding one is a Lovable dependency round trip and a Play release. Phase 5.

## 7. India: ABDM and DPDP

### ABDM (Ayushman Bharat Digital Mission)

Everything here is **[SNIPPET]**: `abdm.gov.in` and `sandbox.abdm.gov.in` are blocked from this container, so **no endpoint, header or flow below may be coded from this document**.

- Participants: ABHA (identity), HIP (provider sharing records), HIU (consumer of records), PHR apps / Health Lockers (consumer-side record holders), consent manager, gateway. A consumer app like ONIQ would be a **PHR application** and, if it stores records, needs NHA's PHR certification.
- Milestones as third parties describe them for HMIS: M1 (ABHA creation/verification), M2 (HIP: share FHIR R4 records on consent), M3 (HIU: fetch on consent). Gateway calls carry a bearer token, `REQUEST-ID`, `TIMESTAMP`, `X-CM-ID` (`sbx`/prod), `X-HIU-ID`. Certification: functional testing → WASA by a CERT-In empanelled auditor → NHA document review → production; 12–20 weeks quoted.
- Every cross-facility fetch needs a signed consent artefact; ONIQ must log grants and revocations and never fetch without one.

What ONIQ can do now without inventing anything: the domain model already has `abdm` as a provenance source and `consent` records that can hold an ABDM consent artefact id. The owner obtains sandbox credentials and the official API spec; the adapter is written against the spec, not against blogs.

### DPDP (Digital Personal Data Protection Act 2023 and Rules 2025)

**[SNIPPET unless marked]** — and every line is a **legal counsel item**, not a design fact:

- Rules notified 13 November 2025; phased enforcement, with obligations on data fiduciaries and penalties in force by **13 May 2027**.
- The Act has **no "sensitive personal data" category**; health data is personal data like any other under the statute. That lowers the statutory bar, not the ethical one; ONIQ treats health data as its most sensitive class regardless.
- Consent must be free, specific, informed, unconditional and unambiguous, given against an itemised notice, and **withdrawal must be as easy as giving it**. This is why the consent model is per purpose × data category × recipient, versioned, and revocable in one tap.
- Children (under 18): verifiable parental consent (Rule 10); ONIQ's signup gate and `parental_consent_requests` already implement the mechanism.
- Breach: notify the Data Protection Board **within 72 hours** and affected principals without delay. `docs/incident-response.md` should gain a health-specific runbook (counsel item).
- Cross-border transfers: negative-list model; no restricted country notified as of mid-2026. Significant Data Fiduciaries may be barred from moving specified categories offshore (Rule 13). Keeping health data in `asia-south1` removes the question.
- Data principal rights: access, correction, erasure, nomination, grievance. `dsr-handler` covers access/correction/erasure/portability; Health export/purge plug into it.
- Retention: purpose-bound; erase when the purpose is served or consent withdrawn, subject to law. Retention policy table with counsel-set periods.
- Consent Managers are registered third parties; not required for a first-party app.

**Counsel must decide** (recorded in `04-decisions-for-owner.md`): retention periods per category; whether ONIQ is a Significant Data Fiduciary; the notice text; the breach runbook; the age-gate wording for health specifically; whether a DPIA is required before AI on health data; the privacy-notice change that the AI phase needs.

## 8. Security requirements (checked into tests where possible)

| Requirement                                                                       | How it is met / enforced                                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No service-account key in the mobile app                                          | The app only holds the Supabase publishable key and the Firebase _web_ key (public by design). Google-privileged calls run in edge functions. `isolation.test.ts` fails if a Healthcare API host appears under `src/`. |
| No API keys for privileged Healthcare operations                                  | The adapter (Phase 4) authenticates with `googleAccessToken()` only; the test bans `?key=` on `healthcare.googleapis.com`.                                                                                             |
| Health data never in unrelated prompts, logs, analytics, telemetry, training sets | Module boundary test: only `src/health/**`, `app.health*` routes, `health-api` and `_shared/health/**` may name the health tables. Log helper whitelists keys. Vertex/paid-tier only.                                  |
| Least privilege                                                                   | Separate service account and per-store IAM roles (owner action).                                                                                                                                                       |
| Encryption                                                                        | Google-managed keys at rest by default; CMEK is an option if counsel asks.                                                                                                                                             |
| Audit                                                                             | `health_audit` hash chain for every access and mutation; Cloud Audit Logs data-access logging on the Healthcare API when it is enabled (owner action).                                                                 |
| Short-lived URLs                                                                  | Document reads are 60-second signed URLs minted per request and audited.                                                                                                                                               |
| Environment separation                                                            | A second GCP project for non-production datasets; synthetic data only outside production.                                                                                                                              |

## 9. Recommended architecture (summary; the full design is `02-architecture.md`)

```
Android/web client ──(Supabase JWT)──▶ health-api (Deno, service role)
                                          │  flag gate → auth → consent → ownership filter → audit
                                          ├─▶ Postgres: health_records, health_documents, health_consents,
                                          │             health_audit, health_retention_policies, health_config
                                          ├─▶ Supabase Storage: health-documents (private, signed URLs)
                                          └─▶ Google adapter (Phase 4+, flagged):
                                                FHIR store asia-south1 ── Pub/Sub ── BigQuery (de-identified)
                                                Vertex Gemini (grounded, consented)      Healthcare NLP (optional)
                                                Health Connect (native, Phase 5)          ABDM gateway (Phase 6)
```

## 10. Scope

- **V1 (Phases 1–3):** records, documents, consent, audit, retention, timeline, health chat grounded on the person's own records — all in Postgres and Supabase Storage, Gemini Flash-Lite via the paid key/Vertex, no Healthcare API. Ships behind flags.
- **V2 (Phases 4–5):** FHIR store mirror in `asia-south1` (the interoperable copy), Pub/Sub notifications to a worker, Health Connect read of steps/heart rate/sleep with explicit permissions.
- **V3 (Phases 6–9):** ABDM PHR (after certification), DICOM for imaging, MedGemma evaluation, de-identified BigQuery analytics.

## 11. Cost model

See `03-cost-model.md` for the 1K/10K/100K/1M-user tables and every assumption.

## 12. Risks and assumptions

- Healthcare API entitlement for `oniq-309bd` in `asia-south1` is unmeasured; one authenticated `GET …/locations` settles it (owner grants a role, or the Lovable agent runs it — a credit).
- Healthcare NLP and Agent Search for Healthcare are priced for hospitals, not consumer apps: at 100,000 users they are the two largest lines in the cost model by a wide margin.
- MedGemma is a fixed monthly cost with no scaling benefit at ONIQ's size; evaluation runs can use an endpoint for hours and delete it.
- ABDM certification is a months-long external process with audit fees **[UNKNOWN amount]**.
- The privacy notice's "never sent to any AI feature" sentence must change before Phase 3; that is a policy decision with a Play Data safety consequence. **Changed 2026-09-09 by owner directive — `04 D4`, `02 §16`.**
- Every third-party snippet above (ABDM, DPDP timelines, Health Connect policy) needs confirmation from the primary source before anyone builds against it.
