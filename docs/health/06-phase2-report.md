# ONIQ Health — Phase 2 completion report (§83F)

**Phase:** 2 — Health AI Safety Gateway + Document Intelligence
**Status:** BUILT DARK, tested, reviewed, documented, flagged. NOT applied,
NOT deployed, NOT published, NOT activated. Phase 3 is NOT AUTHORIZED and
nothing here activates it.

The one sentence the brief asked for: **Health → AI direct path = impossible**
is demonstrated by `src/health/__tests__/ai/isolation.test.ts` (registry keys
exactly `["synthetic"]`, every other id thrown; egress allowlists on both
trees; the provider input captured through the real gateway carrying no id, no
user, no path; every recipient `oniq`; the privacy sentence tied to that) and
by `src/health/__tests__/isolation.test.ts` (no other edge function names a
health table, the bucket or `"health-ai"`, or imports from `_shared/health`).
The production privacy promise — "Health data is never sent to any AI
feature" — is unchanged and still asserted.

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

- The privacy notice is unchanged and its test still passes; the sentence is
  now tied to `RECIPIENT_FOR_PROVIDER`.
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

## Owner actions (none needed to merge; all needed to verify)

1. Apply the migration; deploy `health-api` + `health-ai` in one message; publish (04 §A-2, steps 1–3).
2. Set `enabled = true` on the row (the master switch; nothing user-visible changes while the client constant is false), then the house cap **500** from `/app/admin/health-ai` → Daily caps (two taps, audited), then `ai_admin_verification_enabled = true`.
3. Verify the kill switch both ways (two taps each), a non-admin's refusal (403 `forbidden`, audited), and the `config.*` audit rows.
4. `ai_enabled` stays OFF (owner directive 2026-09-08, later): the synthetic-answer verification waits with it, behind the Phase 3 authorization and legal gate. B12 is decided ("AI-assisted") and built.

## Legal actions

- D3: the `ai_interpretation` consent sentence is a PLACEHOLDER
  (`health-ai-terms-v1`, recipient ONIQ only); counsel's wording replaces it.
- D1: `ai_requests` retention placeholder (365 days).
- D6/D4 remain Phase 3 gates and are untouched by Phase 2.

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
- The generated Supabase client types (`src/integrations/supabase/types.ts`)
  do not yet name the Phase 1/2 tables; they regenerate after the migrations
  apply, and `isolation.test.ts` exempts that file until then.
- Two documented limits of the contract (05 §16): a fact citing two records
  may quote either record's value (grounding is token membership, not
  attribution), and a person's own record that IS a dose instruction is
  echoed back to them inside a fact citing it. Both are asserted as limits.
- A refusal before the receipt is audited, not receipted, so `no_text` in
  production leaves an `ai.refused` audit row and no receipt; the caps count
  receipts, so pre-provider refusals are bounded by the rate limiter alone.
- The house cap has no owner value yet: `ai_daily_cap_house` stays 0 and every
  call refuses `caps_unset` until it is set (04 §A-2 step 4, B11).
- Two of the owner's six B11 operations (report comparison, doctor-visit
  preparation) have no Phase 2 task; their caps are recorded, not enforced,
  because nothing exists to enforce them on.
- The emergency stop is read on every request and stops the NEXT one; it
  does not interrupt a request already past the gate (milliseconds).
- The `health_config_audit_ai_controls` trigger is read from source by its
  test; no test runs SQL. Its first real fire is the owner's first cap change
  after the migration applies — read `health_audit` for `config.changed` then.
- An API-driven config change leaves two audit rows (the action's, with the
  admin as actor; the trigger's, with the database role); a raw `UPDATE`
  leaves one. Both are in the hash chain.

## How to verify the publish (oniq-ship: learn the chunk from a local build first)

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
