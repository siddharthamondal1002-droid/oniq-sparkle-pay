# ONIQ Health — Phase 3 report: the Vertex provider, live

Owner directive, 2026-09-09: "ONIQ HEALTH — FULL AUTONOMOUS IMPLEMENTATION,
DEPLOYMENT AND ACTIVATION". Implement the Firebase → Vertex AI provider behind
the existing `HealthAIProvider` abstraction, remove Anthropic from the active
health path, keep the gateway order, disclose the recipient in three languages,
configure the approved model, test, red-team, mutation-test, build, deploy,
apply, publish, configure production with `ai_enabled = true`, run a controlled
live smoke test through the real user path with throwaway accounts only, verify
every safeguard on production, monitor cost, document, commit, and return one
consolidated report. This is the record; the chat report mirrors it.

Everything below marked **measured** was read from production — the database,
the deployed functions through `pg_net`, the served bundle through `pg_net` —
not from a deploy tool's success message. `05 §17` is the design as built.

## IMPLEMENTATION

- `supabase/functions/_shared/health/ai/vertex.ts` — `VertexHealthAIProvider`
  (`id: "vertex"`, `recipient: "google_vertex"`, `synthetic: false`): one
  `fetch`, one host (`aiplatform.googleapis.com`), `generateContent` on the
  `global` endpoint, `responseMimeType: application/json` with a closed
  `responseSchema`, 25 s timeout, 1024 output tokens, temperature 0.2. The
  provider is handed aliases (`r1…`) and never ids; its reply goes through the
  same `validateAiResponse` / `validateClassification` / `validateExtraction`
  contract every provider must pass, per segment first and then whole, and a
  non-compliant reply degrades to `{class: "unknown", text: NO_ANSWER}` with an
  `insufficient_context` refusal — never to raw model text. Provider failures
  are closed codes (`vertex_http_403_permission_denied`, `vertex_timeout`,
  `vertex_bad_json`, …): Google's STATUS token, never its sentence, so nothing
  from a health prompt can echo back through an error.
- Registry: `PROVIDER_REGISTRY.vertex = () => new VertexHealthAIProvider()`
  (zero-arity, as the guard requires); `PROVIDER_IDS = ["synthetic","vertex"]`;
  `RECIPIENT_FOR_PROVIDER.vertex = "google_vertex"`;
  `MODEL_ALLOWLIST.vertex = ["gemini-3.1-flash-lite"]`;
  `PROVIDER_CLASS_ALLOWLIST.vertex = [record_fact, general_info, ai_interpretation, unknown]`.
- Credential: `_shared/googleAuth.ts` (`googleAccessToken`, the Firebase
  service account already in production, Vertex AI User role granted
  2026-09-07). No new secret, key, dependency or provider account.
- Consent: `GRANTABLE_CONSENTS` gains `(ai_interpretation, google_vertex)`;
  `CONSENT_TERMS_VERSIONS.ai_interpretation = "health-ai-terms-v2"`;
  `DISCLOSED_RECIPIENTS_BY_TERMS["health-ai-terms-v2"] = [oniq, google_vertex]`
  (v1 unchanged, so a v1 grant can never be re-read as covering Google).
- `health-api`: `consents.grant` for `ai_interpretation` accepts only the
  REGISTERED provider's recipient (`recipient_not_offered` otherwise); `status`
  returns `aiRecipient`.
- Gateway (`gateway.ts`): unchanged order; the `ai.refused` audit row for a
  provider failure now carries the closed `code`.
- Migration `20260909100000_oniq_health_phase3_vertex.sql`: the three CHECKs
  widened to admit `vertex` / `google_vertex` / `health-ai-terms-v2`.
- Client: `src/health/flags.ts` — `health.enabled`, `health.ai.enabled`,
  `health.provider_sharing.enabled` true, the nine others false;
  `app.health.consent.tsx` grants the AI consent to `status.aiRecipient` and
  renders `health-consent-ai-recipient`; `src/config/privacy.ts` carries
  `HEALTH_AI_RECIPIENT_NAME` / `HEALTH_AI_RECIPIENT_SENTENCE`.
- No second pipeline, no UI or function bypass: every health screen still
  invokes only `health-api` and `health-ai`; the isolation guards
  (`src/health/__tests__/ai/isolation.test.ts`, `isolation.test.ts`) admit
  exactly one outside host, in exactly one file, reached by exactly one
  `fetch`, and `scripts/health-mutate-guards.sh` proves each of ten escapes red.

## PROVIDER

Google Cloud Vertex AI, through the Firebase project's service account
(`oniq-309bd`), Vertex AI `generateContent`, `global` location, `v1beta1`.

## MODEL

`gemini-3.1-flash-lite` — the owner's 2026-09-04 mapping and the B1
recommendation. **Verified by POST on production**, not by catalogue: the first
real call answered 200 with a grounded record fact (below). Price row
`PRICE_PER_1M["gemini-3.1-flash-lite"] = {input 0.25, output 1.5}` per 1M
tokens, `[PAGE]` labelled, read 2026-09-08.

## ANTHROPIC

Removed from the active health path. `supabase/functions/health-scan` is a 410
stub (`health_scan_retired`) with no key read, no body read and no `fetch`;
the Vitals `ReportsSection` is gone from `app.vitals.tsx`;
`src/health/__tests__/anthropicRetired.test.ts` fails if either returns.
**Measured on production 2026-09-09 06:5x Z:** `POST /functions/v1/health-scan`
→ `410 {"reason":"health_scan_retired"}`. No accidental fallback: the health
trees reach no `ANTHROPIC_API_KEY`, no `anthropic.com`, and `RECIPIENT_FOR_PROVIDER`
holds exactly `{synthetic: oniq, vertex: google_vertex}` (pinned).

## CONSENT

- `ai_interpretation` → `google_vertex` under `health-ai-terms-v2`, granted
  from the consent screen to whatever `status.aiRecipient` names, never to a
  recipient the client picks.
- English, Hindi and Bengali: `health.consent.ai.detail` names "Google Cloud
  Vertex AI (Gemini)"; `health.privacy.ai_recipient` is the recipient sentence
  (hi/bn are meaning-preserving counsel-review placeholders, labelled in source).
- **Measured on production, the deployed functions, throwaway account:**
  granted 200 (v1, terms v2, `IN`); absent → `403 ai_consent_required`
  (purpose/category/recipient named); revoked through `consents.revoke` →
  `403 ai_consent_required`; re-granted → v2 (`noticeLocale: hi`) → 200;
  expiry in the past → `403 ai_consent_required`; expiry cleared → 200.
  The schema refused an expiry before the start (`health_consents_check`)
  when the test first tried one.

## PRIVACY

- The approved statement stays verbatim (`HEALTH_AI_PRIVACY_STATEMENT`), and is
  followed by the recipient sentence: "When you use them, the records you ask
  about are sent to Google Cloud Vertex AI (Gemini), operated by Google, to
  produce the answer, and are not used to train Google's models." — in the
  public notice, beside the AI consent (en/hi/bn), and in the Play declaration
  (`protection`, the AI-processing `what`, a `THIRD_PARTY_REQUESTS` entry for
  `aiplatform.googleapis.com`).
- The retired absolute claim cannot return: `privacyDisclosure.test.ts` bans
  it (and "nothing is sent to Google") from every user-facing source, comments
  stripped, and ties the sentence's claims to `GRANTABLE_CONSENTS`,
  `DISCLOSED_RECIPIENTS_BY_TERMS` and `RECIPIENT_FOR_PROVIDER`.
- **Measured on the served bundle (below):** the recipient sentence is in the
  privacy chunk and the entry; the retired claim is in neither.

## CAPS

House cap 500 (B11 ceiling), per-task caps as B11, user rolling 24h per task,
0 = refuse. **Measured on production through the deployed `health-ai`**, each
config change audited by the row trigger (`config.changed`, seq in brackets):

| Config state                              | Call            | Result                                       | Audit |
| ----------------------------------------- | --------------- | -------------------------------------------- | ----- |
| answer_question cap 1, 2 used [24]        | answer_question | `429 quota_user`                             | 25    |
| cap 10 restored, house cap 1, 4 used [26] | answer_question | `429 quota_house`                            | 27    |
| house cap 0 [28]                          | answer_question | `503 caps_unset`; `status.aiAvailable false` | 29    |
| house 500, answer_question cap 0 [30]     | answer_question | `503 caps_unset`                             | 31    |
| all caps restored (B11, 500) [32]         | answer_question | `200`, Vertex answered                       | 33    |

The tighter of the two refuses first; zero is never unlimited; a refusal is
audited before the receipt and counts nothing against Google.

## KILL SWITCH

**Measured:** `ai_kill_switch = true` (seq 21) → `health-ai` `503 ai_disabled`,
`status` shows `health.ai.enabled false`, `health.provider_sharing.enabled
false`, `aiKillSwitch true`; `ai_kill_switch = false` (seq 22) → the same call
`200` with a Vertex answer (seq 23). It is back to `false`. A non-admin's
`admin.ai_kill` → `403 forbidden` with `config.ai_kill refused` (seq 15) and
the switch untouched; a non-admin's `admin.ai_caps` → `403 forbidden` (seq 17).

## SECURITY

- Identity → authorization → consent → purpose → category → minimum context →
  redaction → kill switch → AI enabled → house cap → operation cap → user
  rolling limit → Vertex → response validation → audit: unchanged, and the
  smoke test exercised every refusal on the deployed functions.
- Own data only: `explain_record` on the person's own record → 200; on
  another person's record id → `404 not_found` with an `ai.refused` row
  (seq 18). The Store closes over the JWT's user id; no method takes one.
- Age: no date of birth → `age_unverified`; under 18 → `minor_blocked`
  (policy, unit-tested); the smoke accounts carried adult dates.
- Region: `cf-ipcountry` AE → `region_blocked` (unit-tested).
- Provider input is aliases and closed fields (`kind, display, valueNum,
valueUnit, effectiveDay, dateLabel, source, question`), the manifest on the
  receipt says so; `redactions 0`, `injectionSuspected false` on every run.
- Provider errors reach the audit row as a closed code, never Google's text.
- Red team: the 212 Phase 2 attack tests still green; `vertex.test.ts` adds
  the provider-specific set (non-compliant reply → unknown, invented alias →
  dropped, over-limit → truncated by the contract, error shapes → codes,
  four consent shapes refused, synthetic still refused in production).
- Mutation: `scripts/health-mutate-guards.sh` — ten escapes, all red
  (M3b, M4b, M4c, M7, M8×3, M9 second host, M10 outside import, M11 host
  rewrite).

## REAL HEALTH DATA → VERTEX

Only under the pipeline above, only after an active `ai_interpretation →
google_vertex` consent under terms that disclose Google, only the fields the
manifest lists, only for adults outside blocked regions, only under the caps,
only while the kill switch is off. No real user's data was used to test:
two throwaway accounts (`phase3-smoke-alice-…`, `phase3-smoke-bob-…`,
`@example.com`), one synthetic lab value each, deleted in the same session.

## AI ENABLED

`health_config.ai_enabled = true` — **the actual production value**, read
back after the UPDATE (06:56:25Z, audit seq 8 `config.changed {ai_enabled:
true}`), and proven behaviourally: the unauthenticated `health-ai` probe
advanced from `503 ai_disabled` (id 3282) to `401 unauthorized` (id 3284)
across the flip, and the authenticated call then reached Vertex.

Production row at the end of the run (read 07:09Z):

    enabled true · ai_enabled true · ai_kill_switch false
    ai_admin_verification_enabled true · ai_daily_cap_house 500
    ai_daily_caps {answer_question 10, explain_record 5, summarize_timeline 3,
                   classify_document 10, extract_document 10}
    ai_provider vertex · ai_model gemini-3.1-flash-lite
    provider_sharing_enabled true · uploads_enabled false · environment production

## TESTS

tsc clean; `lint:ci` clean on every changed file; Prettier clean;
`deno check` green for `health-ai`, `health-api`, `health-scan`; health suite
48 files / 1,216 tests; full suite 344 files / 5,934 tests, all green.

## RED TEAM

212 Phase 2 attack tests green on the Vertex-registered tree, plus the
provider set in `vertex.test.ts` (above). No finding left open.

## MUTATION TESTS

`scripts/health-mutate-guards.sh`: baseline green, 10/10 mutations red.

## BUILD

`npm run build` green; `npx tsx scripts/health-bundle-markers.ts` PASS on the
local build (admin chunk `app.admin_.health-ai-BtUSJEzz.js`, privacy chunk
`privacy-DPbGHPtd.js` with the recipient fragment = 1, entry `index-D3MIuZxp.js`).

## DEPLOYMENT

- Commit `65715924` on `claude/check-56jtg5`, `main` fast-forwarded to it;
  Lovable `latest_commit_sha` read `65715924…` before the deploy message and
  again before `deploy_project` (oniq-ship).
- Migration: applied from here through the Lovable database connection
  (three statements, read back: the three CHECKs now admit
  `vertex` / `google_vertex` / `health-ai-terms-v2`), recorded in
  `supabase_migrations.schema_migrations` as `20260909100000
oniq_health_phase3_vertex`, `created_by = 'claude-code via Lovable
query_database'`.
- Functions: ONE Lovable message, landed 06:54:03Z, **0.5 credits**:
  "Successfully deployed edge functions: health-ai, health-api, health-scan".
- Configuration (audited): 06:55:52Z `ai_provider = vertex`, `ai_model =
gemini-3.1-flash-lite`, `provider_sharing_enabled = true` (seq 7);
  06:56:25Z `ai_enabled = true` (seq 8).
- Web: `deploy_project` → deployment `d46a0305-a2de-4ec7-9c6b-b4e8e3bd1cff`.

## PRODUCTION VERIFICATION

Functions, unauthenticated `pg_net` probes (a response proves deployment; the
reason proves which gate answered):

    3280  health-ai   before the deploy       503 ai_disabled
    3281  health-scan after the deploy        410 health_scan_retired   (was 400 attach a report)
    3282  health-ai   after the deploy        503 ai_disabled
    3283  health-api  after the deploy        401 unauthorized
    3284  health-ai   after ai_enabled=true   401 unauthorized          (advanced)

Served bundle, read from inside the database with `pg_net` (oniqhub.com is
proxy-blocked from the container):

    entry   index-D1pzt6IS.js            (was index-BHxCgVpx.js)   476,841 B
            "operated by Google" 2 · retired claim 0
    privacy-B5KFyQ0Q.js                  12,271 B   recipient sentence 1 · Vertex named 1 · retired 0
    app.health.consent-DgPIlsCq.js        6,848 B   health-consent-ai-recipient 1 · "operated by Google" 2
    app.admin_.health-ai-DL7_Le-O.js      6,559 B   health-ai-admin-caps-save 1 · health-ai-admin-kill 1
    app.health.index-DiTriFPE.js          9,059 B

The distribution matches the local build chunk for chunk (each marker in the
same file and no other), which is what oniq-ship says to compare.

The live smoke test, through the DEPLOYED functions, tokens used only by
subquery from `net._http_response` (never selected, never in the transcript):

    06:56:55Z  Alice + Bob signed up through /auth/v1/signup (public key)
    07:01:47Z  Alice: store_records→oniq 200 · ai_interpretation→google_vertex 200
               Bob:   store_records→oniq 200
    07:02:xxZ  Alice: lab HbA1c 5.4 % (2026-09-01) · Bob: vital heart rate 72 bpm
    07:02:58Z  THE FIRST REAL POST TO VERTEX — health-ai answer_question
               "What was my most recent HbA1c result?"
               → 200  provider vertex · model gemini-3.1-flash-lite
                 segment record_fact "The most recent HbA1c result recorded is
                 5.4% on 1 Sep 2026." sourceRecordIds [Alice's record]
                 usage 844 in / 83 out · costUsd 0.000335
                 receipt cdb7f660… status ok · manifest fields
                 [kind, display, valueNum, valueUnit, effectiveDay, dateLabel,
                  source, question] · redactions 0 · injectionSuspected false
                 audit seq 14 ai.request ok
    then       explain_record (own)   200  841/213  $0.00053   3 segments, all cited   seq 20
               summarize_timeline     200  839/80   $0.00033                            seq 19
               explain_record (Bob's) 404 not_found                                     seq 18
               Bob answer_question    403 ai_consent_required                           seq 16
               admin.ai_kill (non-admin) 403 · admin.ai_caps (non-admin) 403          seq 15, 17
               status  aiAvailable true · aiRecipient google_vertex · aiKillSwitch false
               kill ON → 503 ai_disabled · kill OFF → 200                              seq 21–23
               caps matrix (above)                                                      seq 24–33
               consent revoke → 403 · re-grant v2 (hi) → expiry past → 403 →
               cleared → 200 in Hindi: "1 Sep 2026 को HbA1c का परिणाम 5.4% दर्ज
               किया गया था।"                                                            seq 34–38
    07:09Z     both accounts deleted: 0 throwaways, 126 users, 0 health_records,
               0 health_consents, 0 health_documents; 6 receipts kept with
               user_id null; 23 audit rows with user_id null and actor kept

`scripts/health-production-check.sql` after the run, at the final state: **zero rows (PASS)** — config row as decided, schema, RLS, triggers, the widened CHECKs, the bucket, retention rows, the five migration versions in history, the audit chain recomputed over all 38 rows, no unaudited config change.

## AUDIT

38 rows, chain intact under the erasure-proof verifier. Every refusal above has
its `ai.refused` row with the reason; every config change its `config.changed`
row with the columns that differed; every consent change its row; every
provider call its `ai.request` row with task/model/provider/count. No audit row
carries a health value: `detail` is closed names and counts.

## COST MONITORING

`scripts/health-ai-cost-report.sql` (committed): per day / task / provider /
model — requests, ok/refused/error, input tokens, output tokens, estimated cost
at the code's price row; the rolling-24h counts against the caps; refusal and
contract codes; the provider-failure codes on the audit rows; month to date.
It reads only numeric and closed columns — no health content is telemetry.

Measured after the run (month to date): **6 requests, 5,056 input tokens,
625 output tokens, $0.0022**; rolling-24h house 6 / 500; per task 4 / 10
answer_question, 1 / 5 explain_record, 1 / 3 summarize_timeline; no refused
receipts, no provider-failure codes. One call is roughly 840 input tokens
(the system instruction and schema dominate) and 80–210 output tokens:
$0.0003–0.0005 at list — inside the cost model's assumption.

## DOCUMENTATION

This file; `05 §17` (design as built); `02 §16` (the recipient); `04` B1
decided, D4 addendum, §A-3 (the Phase 3 sequence as done, and the rollback);
`03` the measured per-request line; `06 §Next phase` → here; `README`;
`CLAUDE.md` (owner directive 2026-09-09, Phase 3).

## COMMIT

`65715924` (the implementation) and the follow-up commit carrying this report
and the cost script, both on `claude/check-56jtg5` with `main` fast-forwarded.

## BLOCKED

Nothing. Still counsel's, not blocking (`04 D3/D4/D6`): the Hindi/Bengali
placeholder wordings; the "not used to train Google's models" clause against
Google Cloud's current terms; the Play Data safety FORM in the console; the
DPIA question now that AI runs on health data.

## Remaining risks

- The Vertex credential is the Firebase project's service account, not the
  separate Health account B1 recommended. Same project, same IAM; a separate
  principal is a later hardening that changes nothing in code but
  `FIREBASE_SERVICE_ACCOUNT`'s reader.
- Extraction reads a PDF's own text on ONIQ's side and sends a photo, a scan
  or a text-less PDF to Vertex as the file itself, after the caps and on a
  receipt (Phase 3b, below); an unsupported mime or a file over 10 MB is
  refused at register, and a blank transcription is receipted `no_text` with
  its cost.
- `health-scan` is a deployed 410 stub rather than a deleted function; the
  deletion is a control-plane action the Lovable agent's guard refuses
  (2026-09-06), so it is the owner's from the Supabase dashboard. The stub
  reads nothing and sends nothing.
- Receipts survive erasure with `user_id` null (by FK design, so the ledger
  and the house count stay honest); records, consents and documents cascade
  with the profile. A person's audit rows keep their id in `actor` — the
  2026-09-08 erasure fix — which is what the chain hashes.

## Rollback

`ai_kill_switch = true` from `/app/admin/health-ai` (two taps, audited) stops
every Vertex call within seconds; `ai_enabled = false` on the row does the
same by the other column; `health.ai.enabled = false` in `src/health/flags.ts`
removes the sections on the next publish. Setting `ai_provider = synthetic`
would refuse everyone in production (`synthetic_in_production`) — it is not a
rollback, it is a different outage. Receipts and audit rows stay; nothing is
deleted by any of it.

## 2026-09-09 (later) — Phase 3b: uploads on, a PDF read by its own text, a photo read through Vertex

Owner directive: _"i want A, B and C all done"_ — A attach and keep, B the AI
reads PDFs, C the AI reads photos and scans. Design as built: `05 §18`; the go
sequence: `04 §A-4`. Everything below is MEASURED on production, the throwaway
accounts' tokens used only by subquery from `net._http_response`.

THE ROW AND THE CODE

    08:53:35Z  uploads_enabled false -> true   guarded UPDATE; audit seq 41
               config.changed {uploads_enabled: true}
    1be09ae4   the code, pushed, main fast-forwarded; Lovable latest_commit_sha
               read f6487a91 seconds after the push and 1be09ae4 a minute later —
               the sha rule held

THE THROWAWAY AND ITS DOCUMENTS — before the deploy, because register and
confirm are Phase 1 code the deploy does not change:

    08:54:02Z  consents.grant store_records -> oniq 200 · ai_interpretation ->
               google_vertex 200                                     seq 42, 43
    08:54:20Z  documents.register x2 -> 200: a 716-byte PDF and a 3,170-byte
               PNG, both lab_report, both SYNTHETIC ("Sample Diagnostics -
               Blood report": HbA1c 5.4 %, Haemoglobin 13.2 g/dL, Fasting
               glucose 92 mg/dL)                                     seq 44, 45

THE ONE LOVABLE MESSAGE, 08:56:26Z, **2.1 credits**, verbatim where it matters:

    pre-checks   StoredDocumentSource in health-ai/index.ts: 2 · transcribe in
                 ai/vertex.ts: 3
    deploy       "Successfully deployed edge functions: health-ai, health-api"
    upload       both base64 blobs decoded, sizes and sha256 verified, put at
                 the two registered paths with supabase--storage_upload; the
                 listing verbatim:
                   0b67269d-….png   3170   image/png
                   501dbc84-….pdf    716   application/pdf

`pg_net` has no PUT, so the bytes could not travel from the database; the
message carried them — 5,184 base64 characters. A free verb probe had settled
it first: a POST at the signed-upload path answers `400 headers must have
required property 'authorization'` — that is the create-signed-URL endpoint,
not an upload; the upload itself is PUT only.

THE PUBLISH — `deploy_project` after the sha check; the served bundle read from
inside the database:

    entry    index-D1pzt6IS.js -> index-BU9dwD0N.js   478,220 B
             widened recipient sentence 1 (the constant is shared) · retired claim 0
    records  app.health.records-VFnLwS46.js   9,321 B
             health-doc-input 1 · health-doc-extract 1 ·
             "was sent to Google Cloud Vertex AI (Gemini) to be read" 1
    privacy  privacy-CfKHYktg.js             12,348 B
             "or the photo or PDF itself" 1 · retired claim 0
             (privacy-sCfVPIfa.js, 547 B, carries neither)
    consent  app.health.consent-877s9SFG.js   6,848 B   health-consent-ai-recipient 1

The local build puts the same markers in the same chunks (9,344 B for the
records chunk here — Lovable's build, different bytes, same distribution).

THE FIRST LIVE DOCUMENT READS, through the DEPLOYED `health-ai`:

    09:00:22Z  documents.confirm x2 -> 200 stored (bytes declared = bytes
               arrived, the size check passed)                        seq 46, 47
    09:00:39Z  extract_document (PDF) -> 403 age_unverified; the PNG the same
               seq 48, 49 — count 0, nothing spent: the throwaway had no date
               of birth. One set (its own profiles_private row), then:
    09:01:43Z  extract_document PDF  -> 200  candidates 3 · textChars 106 ·
               readMethod pdf_text · documentSent FALSE
               receipt d0671b50: 485 in / 165 out · $0.000369 · manifest
               fields [documentKind, title, mime, sizeBytes, capturedDay,
               text] · pages 1 · transcription null · redactions 0 ·
               injectionSuspected false                                 seq 50
    09:02:03Z  extract_document PNG  -> 200  candidates 3 · textChars 106 ·
               readMethod vertex_transcription · documentSent TRUE
               receipt e02cdee9: 1,774 in / 220 out · $0.000774 ·
               transcription {inputTokens 1289, outputTokens 47, truncated
               false} — ONE receipt for both calls (the extraction itself
               was 485 in / 173 out) · pages null                       seq 51
    candidates 6, three per document: HbA1c 5.4 %, Haemoglobin 13.2 g/dL,
               Fasting glucose 92 mg/dL, effectiveAt 2026-09-01, provenance
               document_extraction with sourceRef = the document. The two
               read paths produced IDENTICAL values.
    09:02:50Z  classify_document (PDF) -> 200 lab_report, confidence 1 ·
               receipt 7d5c7f65 226 in / 22 out $0.00009 · readMethod
               pdf_text                                                 seq 52
    09:03:16Z  records.confirm on the PNG-derived HbA1c -> 200 active,
               provenance verifiedBy user                               seq 53
    a SECOND throwaway (consents seq 54, 55; date of birth set):
               extract_document on the first one's PDF -> 404 not_found
               seq 56 ai.refused not_found, count 0 — the loader's ownership
               filter, on production, nothing spent
    09:04:35Z  purge -> 200 {records 6, documents 2}: the bucket EMPTY, both
               document rows deleted with storage_path null, the three
               receipts kept with purged_at set and manifest {}        seq 57
    09:05:11Z  both auth users deleted: 126 users, 0 throwaways, 0
               health_records, 0 health_documents, 0 objects; 9 receipts in
               the ledger, every one with user_id null

Phase 3b spend: 3 receipts, 2,485 input / 407 output tokens, **$0.001233**.
Month to date (all of it today, all of it throwaways): 9 requests, 7,541 /
1,032 tokens, $0.003433. The one thing NOT measured, stated as such: a real
handset choosing a file on the Records screen — the client path from the file
picker to `documents.register` and the signed PUT is Phase 1 code, and the
server half of it ran live above. (Corrected 2026-09-09, Phase 4 §1: this
paragraph first said "the Playwright suite exercises" that path. No Playwright
suite exists in this repository — no config, no spec, no `@playwright/test`;
`routes.test.ts` reads the screen's SOURCE. The client path had never been run
by anything but a person. Phase 4 §11 adds a mocked-backend browser walk,
`scripts/health-records-browser-walk.mjs`, and `docs/health/08` records the
boundary a real device still owns.)

WHAT THE CHECK THEN FOUND, and what it cost to make it pass honestly.
`scripts/health-production-check.sql` at the final state returned:

    AUDIT_CHAIN_BROKEN  seq 44        AUDIT_CHAIN_BROKEN  seq 45

Both rows' CONTENT hashes verified; their LINKS were crossed — 44.prev =
hash(45), 45.prev = hash(43), 46.prev = hash(45), so row 44 was referenced by
nothing. Cause, measured from the trigger's own text: `seq` came from the
column default (`nextval`) BEFORE the trigger took the chain lock, and two
concurrent registers drew 44 and 45 in one order and hashed in the other.
Under the old trigger row 44 could have been DELETED without breaking the
chain. Migration `20260909130000` (applied from here, recorded in history):
the trigger assigns seq inside the lock from the same read as prev_hash; a
UNIQUE index on seq; and ADOPTION — a chained `chain.adopt` row (seq 58, actor
`system:chain-repair`, prev = hash 57) names row 44's record_hash, and the
verifier and the check content-verify an adopted row, leave it out of the
linking, and refuse an adopt row that names a hash with no earlier row behind
it. No hash was rewritten. The check at the final state: **zero rows**. The two
crossed rows also carry IDENTICAL created_at values to the microsecond
(08:54:20.985808), which is recorded as an observation and not explained.

---

## 2026-09-10 — "show it, don't store it": the sixth task, LIVE and measured

Owner directive, asked what ONIQ should do with a radiology report after
reporting _"no result came up on an xray report"_: **"Show it, don't store
it."** Design as built: `05 §20`. Go sequence: `04 §A-5`. Everything below is
measured on production.

### It works, and it stores nothing

A throwaway account, a synthetic one-page chest X-ray PDF generated here (906
bytes, sha256 `5110cbfd…`, the words "SYNTHETIC TEST REPORT - NOT A REAL
PATIENT" on its first line), through the DEPLOYED `health-ai`:

    03:59Z  describe_document  ->  200
      provider vertex   model gemini-3.1-flash-lite   1,084 in / 238 out   $0.000628
      document_fact "The report states that the lung fields are clear, with no
                     focal consolidation and no pleural effusion."
      document_fact "The report states that the bony thorax is intact and the
                     costophrenic angles are clear."
      document_fact "The report states an impression of a normal chest radiograph."
      receipt 4f7b1a3d-…   audit seq 79  ai.request / document / 03ab2f72-… / ok

    health_records for that account            0      <- the whole point
    health_documents.extraction_status         none   <- the row was not patched
    receipt row  describe_document / vertex / gemini-3.1-flash-lite / ok

**Every sentence is attributed to the report and none addresses the reader** —
which is what the task line asks for and what keeps the contract's diagnosis
and advice guards from firing on a radiologist's own words.

### The free probe that settled the deploy before a byte was uploaded

Before the upload, the same account called `describe_document` with a document
id that does not exist:

    404 {"ok":false,"reason":"not_found"}

That single answer rules out four different failures at once, for zero credits
and zero spend: `task_not_allowed` (the deployed function knows the sixth
task), `caps_unset` (the migration's cap resolved — the gate reads caps FIRST,
so a missing key would have answered 503 before the lookup),
`ai_consent_required`, and a `needsDocument` that had not been widened.
**Reach for this shape first whenever a new task is deployed.**

### The rest of the sequence

    migration 20260910120000  applied from here, statement by statement:
      ai_daily_caps default + row (audit seq 75 config.changed, caps 6 tasks)
      health_ai_requests_task_check            widened to six tasks
      health_ai_requests_refusal_reason_check  widened with document_rejected
      recorded in supabase_migrations.schema_migrations
    deploy   ONE Lovable message, 0.4 credits, self-check reported (2 and 1)
             "Successfully deployed edge_functions: health-ai, health-api"
    publish  deploy_project after latest_commit_sha == HEAD (37870eab)
    upload   ONE Lovable message (pg_net has no PUT), the PDF byte-exact at the
             registered path — confirmed by storage.objects, 906 bytes,
             application/pdf, NOT by the queue accepting

    served bundle, read from inside the database with pg_net:
      entry  index-BN7TlFab.js -> index-CEXQNSUq.js
      AddReport-qq5ndT9r.js        6,726 B  health-doc-describe      2
                                            health-doc-description   1
                                            health-doc-describe-note 1
                                            health-doc-input         1
                                            health-doc-analyse       0
      app.health.records-CiNbUU9Z.js 3,683 B  every describe marker  0
                                              health-doc-analyse     2

**The cross-pattern is the evidence.** The describe markers are in the SHARED
component chunk and in no other; the records chunk keeps its own control and
carries none of them. Greping `app.health.records-*.js` for the describe
markers would report ABSENT on this perfectly healthy publish — the chunk was
learned from a local build first, exactly as `oniq-ship` and the 2026-09-09
AddReport split say to.

### Cleanup, and the check

`purge` removed the document and its bytes (`{"records":0,"documents":1}`,
zero objects left under that prefix); the auth user was deleted. Final state:
**126 users** (baseline), no smoke account, **0 `health_records` anywhere**,
the describe receipt kept as an anonymous ledger line with `user_id` null, and
the owner's own two documents and two consents untouched. The production check
returns **zero rows**, chain intact under the erasure-proof verifier.

Total spend for the whole proof: **$0.000628** on the metered key, **0.4 + one
upload message** in Lovable credits.

### Two 499s, both of which had LANDED

`alter table … drop constraint` and `alter table … add constraint` each came
back `499 request_cancelled` from the Lovable API while still RUNNING on the
backend, queued behind two `idle in transaction` schema-dump sessions —
`pg_stat_activity` showed my own DDL as the active query in both cases. Neither
was resent; both committed on their own within a minute. **The 2026-09-09 rule
held exactly as written: read the state, never resend DDL on a 499.** Worth
noting that the drop landing while the add had not left the table briefly with
no `task` CHECK at all, which is the argument for doing drop+add as adjacent
statements and reading between them rather than walking away.

### What is NOT proven live, stated as unproven

- **A document whose text reads as an instruction → 422 `document_rejected`.**
  Proven only by `describeDocument.test.ts` against the real gateway and the
  real context builder. Proving it live needs a second poisoned file in the
  bucket, i.e. a second Lovable upload message, and the refusal happens before
  the provider so it would cost nothing but a credit.
- **Another person's document → 404.** Proven by `gateway`/`describeDocument`
  tests with two users in the store, and live only for a document id that does
  not exist. It was NOT run against the owner's real documents on purpose: if
  the ownership filter were broken, that experiment would describe a real
  person's medical record, which is precisely what must not happen.
- **A handset.** Nothing here tapped the button. The gate is the owner opening
  a scan report and reading what it says.

## 2026-09-10 (later) — "make it automatic": the description runs itself on the zero case

Owner directive, verbatim: _"make it automatic using google health and med gamma
api"_. Two halves, and only the first is buildable today.

### The automatic half — B14, answered

`04 §B14` was the decision this session put to the owner: whether a description
should run on its own when a read files nothing, given that it is a SECOND paid
read of the same document. They answered it. It now fires by itself, and only in
the zero case:

    upload path        a read filed 0 readings  ->  describes automatically
    Analyse on a row   the read filed 0         ->  describes automatically
    either one         the read DID file values ->  the button, as before

A read that filed readings has already answered the person; describing it as
well would be a second charge for a question nobody asked. The zero case is
exactly the one the owner reported (_"no result came up on an xray report"_) and
the one where they are otherwise told nothing.

**Spend, unchanged in shape from what was costed in B14.** At most a second
describe leg on a document that yielded no lab values — ~$0.0006 measured, on
top of the extraction's ~$0.0004 — bounded by the per-task cap of 10/person/day
and the house cap of 500. Nothing about the caps, the consent, the kill switch,
the gateway order or the provider moved.

**It fires from an EFFECT behind a ref, never from render.** React StrictMode
double-invokes effects in development, and a second invocation here is a second
billed call on the metered Google key. The ref holds the DOCUMENT ID rather than
a boolean: a boolean would let the same document describe twice across a
remount, or block a different document from describing at all. The effect's
dependency list is the id alone, deliberately — `describe` closes over the
language, and re-running on a language change would bill a re-read of a report
already described. The hook sits above every early return
(`react-hooks/rules-of-hooks` is a release blocker here).

The button stays and relabels to **"Read it again"** once an answer is on
screen, so a genuine re-read is still a deliberate act rather than something the
screen does on its own.

Four new mutations, all RED: **D16** every document row reading itself on mount
(an unguarded `auto`), **D17** Analyse describing even when it DID file
readings, **D18** the upload path no longer reading itself, **D19** the
once-per-document ref removed. D11 and D12 first reported `NOTAPPLIED` because
the `auto` edit moved their python anchors — repaired, and both RED again. **A
mutation that did not apply is not a verdict**, for the second time in two days.

### The provider half — MEASURED, NOT BUILT

The directive names two Google surfaces. Neither is a drop-in for
`gemini-3.1-flash-lite`, and the reason is not preference:

**MedGemma is not an API.** It is OPEN WEIGHTS — Gemma 3 variants published on
Hugging Face and Vertex Model Garden, per Google's own model card. There is no
per-token endpoint to point `vertex.ts` at. Using it means DEPLOYING it: a
Vertex endpoint held up continuously, because a health question arriving at
11pm cannot wait for a cold model to load. From `01-research.md`'s **[PAGE]**
-labelled Vertex machine prices, that is roughly **$840/month** for the 4B on an
L4 and **$3,081/month** for the 27B on an A100 — against **$0.000628** for the
X-ray description that is already live. Three orders of magnitude, for a model
whose card describes it as a research/developer starting point requiring
validation before clinical use.

**Healthcare NLP is real, and is a different shape.** The live discovery
document carries `POST v1/{+nlpService}:analyzeEntities` — it is ENTITY
EXTRACTION (medical concepts, relations, FHIR-ish output), not prose that says
what a report states. At the **[PAGE]** price of $0.10 per 1,000 characters, the
owner's own 14,780-character report would cost about **$1.48** to run once, ~2,400×
what today's read costs. It is a candidate for a future structured-extraction
path, not for "what does this report say".

Neither is enabled on `oniq-309bd` today, and turning either on is console work
plus a standing bill — a provider-and-payment choice, and the owner's under
CLAUDE.md's first rule. Recorded in `04` as a costed option; nothing was built
against it, and no probe was run that would spend.

### Gates

tsc clean; `lint:ci` clean on the changed files; Prettier clean on them (the
repo-wide 372-file report is the pre-existing state this repo carries); health
suite 52 files / 1,111 tests; full suite 356 files / 6,138 tests (the one known
`arapStep11dDiagnosis` timing flake under load, green on a re-run); `deno check`
green on both functions; the build green and `health-bundle-markers` PASS on
every marker; 19/19 describe mutations RED.

**Web-only.** No migration, no edge function, no Lovable deploy message, no
credits. The server already knows `describe_document`; what changed is who asks
it and when.

## 2026-09-10 (later still) — DICOM in: B of "B and C", shipped and measured

Asked what ONIQ needs so Health AI can also read an X-ray or a CT scan, the
owner answered **"B and C"**. This section is B: ONIQ takes the file a hospital
actually hands over, parses its header, renders its pixels, files it, and
**interprets nothing**. C is not built — MedGemma is open weights, so it means
a standing endpoint at ~$840–3,081/month plus a medical-device question for
counsel (`04 §A-7`, `04 §B15`).

Design as built: `05 §21`. Go sequence: `04 §A-6`.

### What shipped

    supabase/functions/_shared/health/dicom.ts        parser, ~330 lines, 0 deps
    supabase/functions/_shared/health/dicomRender.ts  JPEG passthrough / windowed PNG
    health-api documents.preview                      render on demand, DICOM-only
    health-api documents.confirm                      titles a scan from its header
    src/health/ScanPreview.tsx                        the viewer, NOT an AI surface
    src/health/domain.ts (+ mirror)                   DOCUMENT_MIMES, TEXT_READABLE_MIMES,
                                                      EXT_FOR_MIME, MIME_HEAD_BYTES,
                                                      sniffDocumentMime (DICOM first)
    migration 20260910160000                          health_documents_mime_check widened

### The order, and why it is forced

1. **Migration first.** `health_documents.mime` is a closed CHECK. A client that
   can pick a `.dcm` before the CHECK admits it registers a row Postgres
   refuses — and that reaches the person as "something went wrong" AFTER they
   have chosen their file.
2. **`health-api` second.** `documents.preview` is a new action; an old deployed
   function answers `bad_input` to it, which is a refusal rather than a spend.
   `health-ai` is deliberately NOT redeployed: a DICOM never reaches the AI
   pipeline, so nothing in that function changed.
3. **Publish last.**

### Applied, from here, through the Lovable database connection

    before  health_documents_mime_check
              CHECK (mime = ANY (ARRAY['application/pdf','image/jpeg',
                                       'image/png','image/webp']))
    drop constraint if exists            -> ok
    add constraint (in-list on one line) -> ok
    read back  convalidated = true, 'application/dicom' present
    recorded   supabase_migrations.schema_migrations 20260910160000,
               created_by 'claude-code via Lovable query_database'

The drop and the add were adjacent with a read between them, per the 2026-09-10
note: the drop landing while the add has not leaves the table with NO mime
check at all, which is a worse state than either end. Neither returned a 499
this time.

### Deployed

ONE Lovable message naming the STATE, never a commit sha
(`latest_commit_sha` read `d0eeee58` == HEAD here before sending), carrying its
own self-check. The agent ran it and reported before deploying:

    grep -c parseDicom               3   (expected 3)
    grep -c "documents.preview"      1   (expected 1)
    supabase--deploy_edge_functions ["health-api"]
      -> Successfully deployed edge functions: health-api
    cost_credits 0.4

The 60-second client timeout fired on the send, as `oniq-ship` records. The
message was queued and polled, never resent.

### Measured live, through the DEPLOYED function

Free probes first, before anything was uploaded or spent:

    documents.preview, no JWT              401 unauthorized     the function is up and gating
    documents.preview, id that does not
      exist, authenticated                 404 not_found        the action is KNOWN to the
                                                                deployed function
    documents.preview on a DICOM row
      still pending_upload                 404 not_found        the status filter holds
    documents.register mime application/
      dicom                                200                  the CHECK and validateDocumentInput
                                                                both admit it; path ends .dcm

`documents.register` returning 200 is the one that proves the migration: the
same call would have been a constraint violation an hour earlier.

### The evidence set, and what each line is for

| Claim                                      | How it was measured                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| The mime CHECK admits DICOM                | `documents.register` 200 with `mime: application/dicom`, on production                                                            |
| The action exists on the deployed function | `documents.preview` on a nonexistent id answers `404 not_found`, not `bad_input`                                                  |
| Ownership and status filters hold          | a `pending_upload` row answers `404`; an unauthenticated call answers `401`                                                       |
| The parser and PNG encoder run in DENO     | the render smoke test below (a real object, a real download, a real re-encode)                                                    |
| The viewer is on the screen                | the served `app.health.records-*.js` carries `health-scan-view`, `health-scan-image`, `health-scan-not-read`                      |
| The viewer is not an AI surface            | `scanPreview.test.ts` asserts `HEALTH_AI_LABEL` and `AiOutputReport` are ABSENT from `ScanPreview.tsx`                            |
| A DICOM cannot reach the AI                | `TEXT_READABLE_MIMES` excludes it; no `ai/` module imports either DICOM module; no `AI_TASKS` entry matches scan/image/dicom/xray |

The middle row is the one that needed production. `deno check` typechecks the
function but never runs it; vitest runs the parser in NODE. Nothing before the
smoke test had exercised `CompressionStream`, the storage download, or the
byte-level parse inside the Deno runtime — and this repo has recorded "built
and unit-tested is not reachable" four times.

### The render: proven under Deno HERE, not through storage on production

The upload message was **accepted at 07:57:47Z** and the agent's turn finished
at 07:59:48Z. **No object ever appeared in the bucket** — checked five times
over twenty minutes, and `storage.objects` under that prefix stayed at zero. So
the two synthetic files were never placed, and `documents.preview` was never
exercised against real bytes on production.

Rather than spend a second Lovable turn re-asking, the question that upload was
meant to answer — _does the parser and the PNG encoder actually RUN in Deno?_ —
was answered here for free, because **Deno 2.9.6 is installed in this
container**:

    deno run --allow-read /tmp/dc/deno-render.ts   (the real dicom.ts + dicomRender.ts)
      summary        X-ray chest — CHEST PA SYNTHETIC (2026-09-01)
      transferSyntax Explicit VR Little Endian
      dims           64x64 16-bit MONOCHROME2
      method         windowed_png  image/png  64x64
      pngBytes       187
      pngSignature   137,80,78,71,13,10,26,10      (\x89PNG\r\n\x1a\n)

and the emitted PNG was then validated byte by byte: every chunk CRC recomputed
(IHDR 13, IDAT 130, IEND 0), the IDAT inflated to exactly `h*(w+1)` = 4,160
bytes, every scanline filter byte 0, and the image CONTENT checked — row 0 rises
0 → 96 left to right (the gradient) and row 30 jumps 15 → 239 (the bright
block). So it is a real PNG carrying the real fixture, produced by the Deno
runtime.

**AND THE TWO RUNTIMES DO NOT AGREE, WHICH IS THE POINT.** The identical bytes
through the identical code give a **175-byte** PNG under node/vitest and a
**187-byte** PNG under Deno. Both are valid — `CompressionStream("deflate")` is
free to choose its own encoding — but it means a node-only test was never
evidence about the deflate stream production emits. That difference is exactly
the class of thing `deno check` cannot see and vitest cannot reach.

`scripts/make-synthetic-dicom.mjs` regenerates the fixture (8,634 bytes,
sha256 `03eb61f8…`); its header states what it does not prove.

### What the deployed function WAS measured to do, and what it was not

    PROVEN on production, through the deployed health-api:
      documents.preview, no JWT                 401 unauthorized
      documents.preview, nonexistent id         404 not_found
      documents.preview, DICOM row pending      404 not_found  (status filter)
      documents.register mime application/dicom 200, path ends .dcm
      consents.grant store_records              200

    PROVEN here, under Deno, against the real modules:
      parseDicom + renderDicom + imageToBase64  a valid 64x64 PNG

    NOT PROVEN, and stated as not proven:
      documents.preview end to end against a real stored object
      the JPEG-passthrough branch on production
      anything at all on a handset, or on a real scanner's output

The gap is one storage round trip. It is worth ONE Lovable upload message on the
next turn that needs the agent anyway; it is not worth a turn of its own, since
the runtime question it was bought to answer is now closed.

### `pg_net` has GET, POST and DELETE — enumerated, not recalled

The "no PUT" note this file has carried since 2026-09-09 was a recollection.
Measured from `pg_proc`:

    net.http_get     (url, params, headers, timeout_milliseconds)
    net.http_post    (url, body jsonb, params, headers, timeout_milliseconds)
    net.http_delete  (url, params, headers, timeout_milliseconds)

No PUT, and `http_post`'s body is `jsonb`, so it could not carry raw bytes even
if the verb were right. Both halves of the blocker, from the catalogue rather
than from memory.

### Cleanup, and the chain through an erasure

The throwaway account was deleted for real — `delete from auth.users`, the same
operation `purgeUserData.ts` step 4 performs — and verified in a SEPARATE
statement (the data-modifying-CTE lesson):

    before   127 users   3 throwaway documents   1 throwaway consent
    after    126 users   0                       0
    bucket   2 objects, both the OWNER's own; nothing under the throwaway prefix
    health_records   0 anywhere

Then the audit chain was recomputed over every row with the erasure-proof
verifier: **zero violations**. That is `20260908190000` doing its job on
precisely the operation that broke the chain before it existed — a real account
deletion rewriting `user_id` to null on rows the hash covers.

### Served bundle, verified

    entry   index-CEXQNSUq.js  ->  index-Dmr45U67.js   482,124 B

    app.health.records-DCnqFogE.js   5,794 B
      health-scan-view 1 · health-scan-image 1 · health-scan-not-read 1
      health-doc-analyse 2 · health-doc-input 0
    AddReport-CbCYn0GU.js            7,015 B
      health-doc-input 1 · all three scan markers 0
    entry                              health-scan-view 0

The cross-pattern, not any single line: the viewer's markers are in the records
chunk and in no other, the picker's are in the shared chunk and in no other, and
the entry carries neither. Exactly the distribution the local build predicted.

Spend for the whole of B: **0.4 Lovable credits** (one deploy message), **$0**
on the metered Google key — nothing in B calls a model — and one upload message
that was accepted and never ran.
