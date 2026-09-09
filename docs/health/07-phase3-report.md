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
- Extraction still answers `no_text` for everyone (`TEXT_SOURCE_REGISTRY =
{null}`, uploads off): document intelligence waits on uploads and a text
  source, by design.
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
