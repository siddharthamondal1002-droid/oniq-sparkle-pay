# ONIQ Health — Phase 2 completion report (§83F)

**Phase:** 2 — Health AI Safety Gateway + Document Intelligence
**Status:** BUILT DARK, tested, reviewed, documented, flagged. APPLIED, DEPLOYED and
PUBLISHED and CONFIGURED on 2026-09-08 (the deploy record and the production
verification below), NOT activated: `ai_enabled` is off, the kill switch is
off and the client constant is false; the master switch is on, the house cap is
500 and admin verification is on. Phase 3 is NOT AUTHORIZED and
nothing here activates it.

The one sentence the brief asked for: **Health → AI direct path = impossible**
is demonstrated by `src/health/__tests__/ai/isolation.test.ts` (registry keys
exactly `["synthetic"]`, every other id thrown; egress allowlists on both
trees; the provider input captured through the real gateway carrying no id, no
user, no path; every recipient `oniq`; the privacy sentence tied to that) and
by `src/health/__tests__/isolation.test.ts` (no other edge function names a
health table, the bucket or `"health-ai"`, or imports from `_shared/health`).
The production privacy promise was "Health data is never sent to any AI
feature" until 2026-09-09, when the owner replaced it with the
consent-conditioned statement (see Privacy checks); the new statement is
asserted in its place.

## Files changed

New, server (`supabase/functions/_shared/health/ai/`): `types.ts` (mirrored to
`src/health/ai/types.ts`), `scrub.ts`, `cost.ts`, `textSource.ts`,
`provider.ts`, `synthetic.ts`, `classify.ts`, `extract.ts`, `policy.ts`,
`context.ts`, `contract.ts`, `gateway.ts`. New function
`supabase/functions/health-ai/index.ts`. New migration
`supabase/migrations/20260908150000_oniq_health_phase2.sql`.

Changed, server: `_shared/health/{domain,consent,redact,flagNames,flags}.ts`
(the first four mirrored to `src/health/`), `supabase/functions/health-api/index.ts`
(candidates / confirm / reject, AI consent pair, receipts in export, purge marks
receipts + legal hold, `status.aiAvailable`).

New, client: `src/health/ai/client.ts`,
`src/routes/_authenticated/app.admin_.health-ai.tsx`. Changed:
`src/health/{api,flags,i18n}.ts`, `app.health.{index,records,consent}.tsx`,
`app.profile.tsx` (admin link), `src/config/playCompliance.ts` (three
`health_ai_output` surfaces), `src/components/safety/AiOutputReport.tsx` (the
union), `src/routeTree.gen.ts` (regenerated), `app.chat.index.tsx` (two
explicit event types; adding a route pushed TanStack's Link inference past
TypeScript's depth limit for those two handlers — no behaviour change).

Tests: 16 new files under `src/health/__tests__/ai/` (with four fixtures:
`fakeStore`, `inlineTextSource`, `misbehavingProvider`, `injectionCorpus`);
Phase 1 tests updated: `consent`, `flags`, `agreement`, `routes`, `wiring`,
`migration`, `isolation`. Second pass (the adversarial workflow's five
lenses): four attack files `ai/redteam{Injection,Authz,Spend,Exfil}.test.ts`
(212 tests, kept as regression tests), the two isolation guards rewritten and
mutation-checked by `scripts/health-mutate-guards.sh`, and every fix listed
in `05 §16`.

Docs: `docs/health/05-phase2-ai-gateway.md` (rewritten to the build, §14
review outcomes, §15 DoD), this report, `04` (§A-2, B11, B12, D3), `02`
(§10, §12a, §15, §16), `README`, `CLAUDE.md`.

B11/B12 pass (2026-09-08, the owner's decisions, Phase 2 safeguards only):
`_shared/health/ai/{policy,gateway}.ts` (`capForTask`, the person's count per
task), `_shared/health/flags.ts` (`aiKillSwitchFromRow`), `health-api`
(`admin.ai_kill`, `status.aiKillSwitch`), `health-ai` (per-task cap at the
call site), the migration (`ai_daily_caps` JSON, `ai_kill_switch`),
`_shared/health/{domain,redact}.ts` (+ mirrors: `config.ai_kill`, `switch`,
`forbidden`), `_shared/health/ai/types.ts` (+ mirror: `AI_DISCLAIMER_KEY` →
`health.ai.disclosure`), `src/health/labels.ts` (`HEALTH_AI_LABEL`,
`HEALTH_AI_DISCLOSURE`), `src/health/i18n.ts` (`health.ai.label`,
`health.ai.disclosure`, `health.reason.forbidden`), `src/health/api.ts`, the
three health AI screens (the label; the admin door's two-tap emergency stop),
`src/config/playCompliance.ts` (`AI_LABEL_OVERRIDES`) and
`src/data/__tests__/playCompliance.test.ts`; tests `flags`, `wiring`, `i18n`,
`ai/{policy,gateway,wiring,migration2,surfaces,redteamAuthz}`, `ai/fakeStore`.

House-cap pass (2026-09-08, later; the owner's 500 and its conditions):
`health-api` (`admin.ai_caps`, `capsOut`, `status.aiCaps`, config object type on
the kill switch's rows), the migration (`health_audit_object_type_check` +
`config`, actions `config.ai_caps` / `config.changed`, the
`health_config_audit_ai_controls` trigger), `_shared/health/{domain,redact}.ts`
(+ mirrors), `src/health/api.ts` (`AiCaps`, `status.aiCaps`), the admin screen
(Daily caps: house + per task, two taps), tests `wiring`,
`ai/{migration2,redteamAuthz,surfaces,gateway}`.

## Database changes

One new migration, applied AFTER Phase 1's, every constraint named:
`health_config` + `provider_sharing_enabled`, `ai_provider` (CHECK synthetic),
`ai_model`, `ai_daily_caps` (JSON per task, defaulting to the owner's B11
table) / `ai_daily_cap_house` (default **0 = refuse**), `ai_kill_switch`
(default false), `ai_admin_verification_enabled`; `health_records` statuses
`candidate`/`rejected`, `confidence`, `value_text IS NULL` for extracted rows,
candidate index; `health_documents` `classification`, `extraction_status`,
`text_chars`; `health_consents` `jurisdiction`, terms-discloses-recipient CHECK;
`health_audit` six new actions; **`health_ai_requests`** (receipts: `user_id →
auth.users ON DELETE SET NULL`, RLS select-only, closed-code CHECKs,
`purged_at`); retention row `ai_requests` (365-day PLACEHOLDER) and the sweep;
`health_audit` object type `config` and the actions `config.ai_kill`,
`config.ai_caps`, `config.changed`; a row trigger on `health_config`
(`health_config_audit_ai_controls`, SECURITY DEFINER) that appends
`config.changed` on any change to the five AI-control columns, whatever path
changed them. Nothing deletes user health data.

## External services

**None.** No new dependency, no new secret, no new host. The only provider is
`SyntheticHealthAIProvider`, in-process. `TEXT_SOURCE_REGISTRY = { null }`:
no OCR, no model reads a document. Verified by allowlist tests, not by absence
of a blocklist match.

## Feature flags

Twelve, all false on both halves: the eleven of the mapping plus
`health.provider_sharing.enabled` (§83C), which the policy engine consults for
any provider whose recipient is not ONIQ — none exists. Server half:
`health_config.ai_enabled` (false), `ai_kill_switch` (false; true forces both
AI flags off for every function on its next read — the emergency stop), the
house cap (0), `ai_admin_verification_enabled` (false). Client half: `HEALTH_FLAGS["health.ai.enabled"]` (false; stays false
in production for Phase 2). `status.aiAvailable` is computed server-side and is
what a screen reads before offering anything.

## Tests before / after

|                             | Files | Tests                                                                                    |
| --------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| Before (the brief's figure) | —     | 5,173                                                                                    |
| After, whole suite          | 336   | 5,805 (1 pre-existing timing flake outside Health: `arapStep11dDiagnosis`, passes alone) |
| Health suite (Phases 1 + 2) | 32    | 780 (of which 212 are the red team's attack tests)                                       |

Also green: `tsc`, `lint:ci` on every changed file, Prettier, `deno check` of
both functions against the real client types. The adversarial workflow's
red-team files are kept under `src/health/__tests__/ai/redteam*.test.ts`.

## Security checks

- Registry: one provider, zero-arity factory, every recipient `oniq`, `providerFor`
  throws for vertex/gemini/medgemma/google_vertex/openai/anthropic/"".
- Egress allowlist (server and client), `.rpc` closed list, no `__tests__` import.
- Store bound to the JWT user; two-user fixture answers `not_found` for foreign
  ids; the real Store read by effect (house count named as the one exception).
- Closed body (`parseAiRequest`): unknown keys, a text field, bad ids, a
  non-string task or language → 400.
- Contract: 44 closed codes, per-class rules, grounding (value and the digits
  of display/unit/note only — no date component, no citation count; number
  words and nineteen digit blocks read), masking of cited content AND an
  unmasked pass that tolerates only the person's own record, forbidden groups
  en/hi/bn on digitised, punctuation-opened text, advice-in-a-fact, modal care
  avoidance, second-person shorthand, joined pass, obfuscation, identifiers,
  home-made disclaimers. All three output kinds validated and rebuilt; the
  output kind must match the task; the wire is built from named fields.
- Injection: 50 positives / 37 benign corpus plus Tamil, Urdu, Gujarati,
  Marathi and Hinglish shapes; combining marks stripped off Latin; quarantine
  for models (display, note, unit), flag for rules; over-cap — measured on the
  scrubbed text — is a refusal.
- Isolation: named-sibling import allowlist, transitive reachability from each
  entrypoint, strings-kept egress scan; seven mutations red
  (`scripts/health-mutate-guards.sh`).
- `status.aiAvailable` is `checkGate` itself; purge fails closed on a hold
  rpc error; an audit failure after a settled receipt propagates.
- Regex safety: no unbounded gap, adversarial 20,000-char inputs timed.
- Production bound to the project ref; admin verification behind its own
  column and audited by method; no date of birth = refused; under 18 = refused.

## Privacy checks

- The privacy notice changed on 2026-09-09 by owner directive: the absolute
  sentence is replaced by the consent-conditioned statement
  (`src/config/privacy.ts`), rendered in the notice, beside the AI consent in
  en/hi/bn (translations are counsel-review placeholders) and mirrored in the
  Play declaration. `privacyDisclosure.test.ts` pins every copy, bans the
  retired claim from every user-facing source, and ties the statement to
  `RECIPIENT_FOR_PROVIDER` and the consent rules. The consent sentence (D3) is
  untouched.
- The manifest says what was SENT: an `excluded` entry means the field is absent
  from the provider input (classify drops injected text; extract flags it).
- The person's own `health_ai_output` rows in `public.reports` — the one trace
  of ONIQ Health outside the domain — are removed by the health purge, and the
  answer's report targets the receipt id, not a record's primary key.
- Receipt manifest through a whitelist; audit detail through `auditDetail`
  (+ task/provider/model/method/code only); one log line through `redactForLog`;
  `redaction.test.ts` runs content through every task and asserts none lands.
- Consent: purpose × category × recipient, PLUS the terms version must have
  disclosed the recipient; revocation refuses the next call; the read is
  consent-driven; extraction needs the storage consent for what it writes.
- Purge marks receipts (blank manifest, `purged_at`) and refuses under a legal
  hold; export includes receipts; account deletion keeps the cap ledger with
  `user_id` null.
- Every AI-derived row and every answer is labelled and reportable
  (`AI_SURFACES` × 3); no health kind reaches a notification.

## Cost impact

**$0.** The synthetic model's price row is 0/0; nothing is billed. The per-task
caps are the owner's B11 numbers (per person per day: ask 10, explain 5,
summarise 3, classify/extract 10); the house cap defaults to 0 and refuses
until the owner sets it (B11, still open). `unpriced_model` is refused
in the gate, so a future model without a price row cannot spend. Rate limit 10
per minute per person. Lovable credits spent on this phase: none (no deploy
message was sent).

## Owner actions — status 2026-09-08 (evening)

1. DONE — migration applied, `health-api` + `health-ai` deployed, published (04 §A-2 steps 1–3, one Lovable message).
2. DONE by the autonomous loop, by audited `UPDATE` through the Lovable database connection — `enabled = true` (seq 1), the house cap **500** (seq 2), `ai_admin_verification_enabled = true` (seq 3). The admin screen's Daily caps route remains available and would add a `config.ai_caps` row on top of the trigger's.
3. DONE except the admin's own taps — the kill switch was flipped on and off by SQL (seq 5, 6) and each position was read back through the deployed `health-api` by a throwaway non-admin account; that same account's `admin.ai_kill` was refused 403 and audited `refused` (seq 4). What only the owner can add: **Stop Health AI now** / **Allow Health AI again** on `/app/admin/health-ai` as an admin, which exercises the `is_admin = true` branch and leaves `config.ai_kill … ok` rows. Free; two taps each way.
4. `ai_enabled` stays OFF (owner directive 2026-09-08, later): the synthetic-answer verification waits with it, behind the Phase 3 authorization and legal gate. B12 is decided ("AI-assisted") and built.
5. Counsel, from the 2026-09-09 privacy change: the report scan's Anthropic processing (disclose or gate — `04 D4`), the Hindi and Bengali placeholder translations of the new statement, and the Play Data safety form to match it.

## Legal actions

- D3: the `ai_interpretation` consent sentence is a PLACEHOLDER
  (`health-ai-terms-v1`, recipient ONIQ only); counsel's wording replaces it.
- D1: `ai_requests` retention placeholder (365 days).
- D4 was decided on 2026-09-09 (the statement above); what remains under it
  is counsel's: the Vitals report scan (`health-scan`) is configured in
  production and sends an uploaded report to Anthropic with no consent step,
  which neither the old sentence nor the new one names (`02 §16`).
- D6 remains a Phase 3 gate and is untouched by Phase 2.

## Remaining risks

- Phase 2 produces **no candidates and no answers for any production user**:
  no text source is registered and the synthetic provider is refused to
  non-admins in production. This is by design and stated on every screen and
  document; it is also why the feature is unproven against real documents.
- The injection detector is a bounded heuristic (corpus-tested), not the
  boundary; the boundary is structured provider input plus the contract. Phase 3
  must keep that ordering.
- The extraction table is 28 analytes + BP; reports outside it yield nothing.
- `arapStep11dDiagnosis.test.ts` times out under full-suite load on this
  container (unrelated; passes alone).
- Two documented limits of the contract (05 §16): a fact citing two records
  may quote either record's value (grounding is token membership, not
  attribution), and a person's own record that IS a dose instruction is
  echoed back to them inside a fact citing it. Both are asserted as limits.
- A refusal before the receipt is audited, not receipted, so `no_text` in
  production leaves an `ai.refused` audit row and no receipt; the caps count
  receipts, so pre-provider refusals are bounded by the rate limiter alone.
- The house cap is 500 on the row (set 18:18Z, seq 2) and the per-task caps
  are the B11 table; both change from the admin screen or by `UPDATE`, and
  either path is audited. `scripts/health-production-check.sql` reports any
  drift from those values as `CONFIG_DRIFT`.
- Two of the owner's six B11 operations (report comparison, doctor-visit
  preparation) have no Phase 2 task; their caps are recorded, not enforced,
  because nothing exists to enforce them on.
- The emergency stop is read on every request and stops the NEXT one; it
  does not interrupt a request already past the gate (milliseconds).
- The audit chain broke on the throwaway account's deletion (`user_id` is a
  set-null FK and is hashed) — the defect real erasure would have caused for
  any person with health audit rows. Fixed the same evening in the verifier
  (`20260908190000_…survives_erasure.sql`: the committed id is recovered from
  `actor`, which every writer sets to the person's id — pinned by
  `auditChainSurvivesErasure.test.ts`), applied and re-verified: all six rows
  intact. Limit: a future writer with `actor ≠ userId` would need a stored
  commitment column instead. See `05 §9`.
- The `health_config_audit_ai_controls` trigger has fired six times on
  production (seq 1–6) and every row recomputes in the chain check. As shipped
  it watched five AI columns and would have missed `enabled`, the first value
  the go sequence sets; `20260908181500_…every_column.sql` made it diff the
  whole row before the sequence ran. No test runs SQL; the production check
  does, read-only.
- An API-driven config change leaves two audit rows (the action's, with the
  admin as actor; the trigger's, with the database role); a raw `UPDATE`
  leaves one. Both are in the hash chain.
- The repo carries each Phase migration twice: the documented originals and
  Lovable's applied copies (headers stripped; Phase 1's copy lacks the bucket
  insert, which the tool refused). That is this repo's convention, not an
  accident — production's `schema_migrations` records only the UUID-named
  copies, and the older `weather_cache` pair shows the same shape — so the
  copies stay, and `appliedCopies.test.ts` fails if either side drifts by one
  statement. A `supabase db push` from the repo would replay the originals over
  the copies — idempotent by construction, but not to be done casually. The
  every-column trigger migration is the exception: applied from the repo file
  itself and recorded under its own version, so a push skips it.
- The served bundle was not fetched from this container (`oniqhub.com` is
  proxy-blocked); Lovable reports the publish live at `84a8e4f2`, and the
  deployed FUNCTIONS were verified from inside the database instead (below).
  The bundle check is one command from any host that can reach the site —
  `npx tsx scripts/health-bundle-markers.ts --url https://oniqhub.com` — and
  the local build passes the same check. The admin screen showing "Daily caps"
  and "Emergency stop" remains the functional check.

## Deploy record (2026-09-08)

One Lovable message, sent after `get_project.latest_commit_sha` read the
merge (`8efeac54`); 6.6 credits. The agent's raw results:

```
pre-checks   health_config_audit_ai_controls: 5
             capForTask: supabase/functions/health-api/index.ts:3
                         supabase/functions/health-ai/index.ts:2
             admin.ai_caps: supabase/functions/health-api/index.ts:1
migrations   Phase 1 was NOT applied (only health_checkins and health_profiles
             existed) -> applied first, unchanged, then Phase 2.
             Both: "The migration completed successfully."
deviation    the migration tool rejects writes to storage.buckets; the agent ran
             everything else and created the bucket with the storage tool:
             "Successfully created private bucket "health-documents" with a
             10.00 MB file size limit." No storage.objects policy.
linter       146 issues before and after -- pre-existing
deploy       Successfully deployed edge functions: health-api, health-ai
publish      scheduled; no deployment id; is_published true at 84a8e4f2
untouched    health_config, privacy.tsx, every health file; no provider, model,
             key or dependency
```

Verified from the agent's own tool payloads: the Phase 2 SQL it sent matches
`20260908150000_oniq_health_phase2.sql` to its last statement; the Phase 1 SQL
matches `20260908120000_oniq_health_phase1.sql` up to and not including the
`storage.buckets` insert. Lovable then committed its applied copies to `main`
(`ab41e2d0`, `84a8e4f2`, by `gpt-engineer-app[bot]`) as
`supabase/migrations/20260908170834_d2e6b48b-….sql` and
`20260908171017_c14034b6-….sql`, plus a regenerated
`src/integrations/supabase/types.ts`; the branch was fast-forwarded onto them
and the full suite is green (336 files / 5,826 tests). Production therefore
holds: Phase 1 minus one insert, the bucket, Phase 2 in full; `health_config`
untouched (every switch off, house cap 0). Nothing is user-visible: the client
constants are false and `health-api` answers 503 to everyone until `enabled`
is set — the owner's step, `04 §A-2` step 4.

## Production verification (2026-09-08, 18:02–18:30Z, no Lovable message, no credits)

Everything below was measured through the Lovable database connection
(`query_database`) against production — identified first: 126 `auth.users`,
48 `device_tokens`, one `health_config` row — not taken from the deploy report.

```
schema        9 health tables (7 sealed + 2 pre-existing); RLS on all 9; every
              policy, index, trigger, constraint and function of both phases
              present; health_config_audit_ai_controls and
              health_apply_retention bodies IDENTICAL to the repo files;
              health_audit_action_check carries the 19 actions, object types
              carry `config`; ai_provider CHECK = synthetic only
bucket        health-documents  public=false  limit=10485760  no storage policy
retention     12 rows incl. ai_requests 365
history       20260908170834, 20260908171017 (Lovable's copies)  then
              20260908181500 (the every-column trigger, applied here)
grants        trigger fn + health_append_audit: postgres, service_role only
functions     from inside the DB with pg_net, no credential — three-way control:
                health-api  503 health_disabled   health-ai  503 health_disabled
                a function that does not exist    404 NOT_FOUND
              after enabled = true, the same calls ADVANCED:
                health-api  401 unauthorized      health-ai  503 ai_disabled
config        each: read → guarded UPDATE → read back → audit row read
                enabled                        false → true   18:16:13Z  seq 1
                ai_daily_cap_house             0 → 500        18:18:57Z  seq 2
                ai_admin_verification_enabled  false → true   18:22:30Z  seq 3
                ai_kill_switch                 false → true   18:26:58Z  seq 5
                ai_kill_switch                 true → false   18:28:31Z  seq 6
              ai_enabled untouched (false); uploads untouched (false)
authenticated one throwaway NON-admin, signed up through the project's own
              /auth/v1/signup from inside the DB (the smoke tests' pattern),
              its token never read out of net._http_response, deleted in the
              same run:
                status                 200  aiCaps.house 500, tasks = B11,
                                            aiKillSwitch false, aiAvailable
                                            false, health.ai.enabled false
                admin.ai_kill on:true  403  forbidden; seq 4 config.ai_kill
                                            refused, actor = that uid; the
                                            switch and updated_at unchanged
                status (switch on)     200  aiKillSwitch true, both AI flags
                                            forced off, house still 500
                status (switch off)    200  aiKillSwitch false
chain         seq 1–6 recomputed with health_verify_audit_chain's expression:
              intact — then BROKEN at seq 4 the moment the throwaway was
              deleted (its user_id set null by the FK, the hash computed
              with it); proven by recomputing seq 4 with the original id
              (match) and seq 5's link (still holds). Verifier replaced —
              20260908190000, the committed id recovered from actor —
              applied, read back, all six rows intact again
check         scripts/health-production-check.sql -> 4 rows before the
              sequence (exactly the three values it sets + the history row),
              0 rows after; 1 row (AUDIT_CHAIN_BROKEN seq 4) after the
              deletion; 0 rows after the verifier fix
```

What is NOT verified from here, stated as such: the served web bundle (proxy);
the admin branch of `admin.ai_kill` / `admin.ai_caps` (needs an admin JWT — the
owner's two taps); and everything behind `ai_enabled`, by directive.

## How to verify the publish (oniq-ship: learn the chunk from a local build first)

`npx tsx scripts/health-bundle-markers.ts` runs the recipe below against a local build, and `--url https://oniqhub.com` against the served one (exit 2 = unreachable, which is UNVERIFIED and never STALE). What follows is what it does.

`npm run build` here emits the markers in their ROUTE chunks and none in the
entry, so grep production for these files, not for `index-*.js`:

| Marker (a string literal the code emits) | Chunk                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `health-candidate-confirm`               | `app.health.records-*.js`                                                                                                                                          |
| `health-record-ai-label`                 | `app.health.index-*.js`                                                                                                                                            |
| `health-consent-ai-toggle`               | `app.health.consent-*.js`                                                                                                                                          |
| `health-ai-admin-result`                 | `app.admin_.health-ai-*.js` (the underscore IS the route id)                                                                                                       |
| `health-ai-refusal`                      | `app.health.index-*.js` — a literal that existed in NO earlier build, so a 1 cannot be left over from a previous deploy; the decisive marker for the red-team pass |
| `health-ai-admin-kill`                   | `app.admin_.health-ai-*.js` — the emergency stop; existed in no build before the B11/B12 pass                                                                      |
| `health-ai-admin-caps-save`              | `app.admin_.health-ai-*.js` — the caps control; existed in no build before the house-cap pass, so it is the decisive marker for THIS publish                       |

Re-measured after the red-team pass (2026-09-08, 429 chunks): every marker
still in its route chunk, none in the entry.

Re-measured after the B11/B12 pass (2026-09-08, `.output/public/assets`, 302
chunks): `health-ai-admin-kill` and `admin.ai_kill` → `app.admin_.health-ai-*.js`
(4,533 bytes), 0 in the entry; `health-ai-refusal` and `health-record-ai-label`
→ `app.health.index-*.js`. **`AI-assisted` is NOT a marker to verify a deploy
by**: it lands in `labels-*.js` AND in the entry (the i18n strings register at
start), so a grep for it says nothing about which build is served — use the
`data-testid` literals above.

Re-measured after the house-cap pass (2026-09-08, 302 chunks):
`app.admin_.health-ai-*.js` is 6,585 bytes (was 4,533) and carries
`health-ai-admin-caps-save`, `health-ai-admin-house-cap`, `health-ai-admin-kill`
and `admin.ai_caps`; the entry carries none of them.

`signInWithPhoneNumber` in the entry: 0 — the Firebase SDK stays in its own
chunk, unchanged by this phase. The functions are verified separately: a POST
to `/functions/v1/health-ai` with no JWT must answer `503 health_disabled`
while the row is off (flags are read before identity), and `401` once it is on.

## Next phase

Phase 3 (a real provider) is **NOT AUTHORIZED**. What it will need is listed
in `02 §15` and `05 §13`: a registry entry with a non-ONIQ recipient (refused
until `health.provider_sharing.enabled`), a dated price row, the consent pair
under a new terms version, a registered text source, the prompt adapter, the
privacy-notice change (`02 §16`), and the owner's and counsel's gate.
