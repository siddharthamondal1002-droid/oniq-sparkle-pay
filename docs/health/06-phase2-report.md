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

## Database changes

One new migration, applied AFTER Phase 1's, every constraint named:
`health_config` + `provider_sharing_enabled`, `ai_provider` (CHECK synthetic),
`ai_model`, `ai_daily_cap_per_user` / `ai_daily_cap_house` (default **0 =
refuse**), `ai_admin_verification_enabled`; `health_records` statuses
`candidate`/`rejected`, `confidence`, `value_text IS NULL` for extracted rows,
candidate index; `health_documents` `classification`, `extraction_status`,
`text_chars`; `health_consents` `jurisdiction`, terms-discloses-recipient CHECK;
`health_audit` six new actions; **`health_ai_requests`** (receipts: `user_id →
auth.users ON DELETE SET NULL`, RLS select-only, closed-code CHECKs,
`purged_at`); retention row `ai_requests` (365-day PLACEHOLDER) and the sweep.
Nothing deletes user health data.

## External services

**None.** No new dependency, no new secret, no new host. The only provider is
`SyntheticHealthAIProvider`, in-process. `TEXT_SOURCE_REGISTRY = { null }`:
no OCR, no model reads a document. Verified by allowlist tests, not by absence
of a blocklist match.

## Feature flags

Twelve, all false on both halves: the eleven of the mapping plus
`health.provider_sharing.enabled` (§83C), which the policy engine consults for
any provider whose recipient is not ONIQ — none exists. Server half:
`health_config.ai_enabled` (false), caps (0), `ai_admin_verification_enabled`
(false). Client half: `HEALTH_FLAGS["health.ai.enabled"]` (false; stays false
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

**$0.** The synthetic model's price row is 0/0; nothing is billed. Caps default
to 0 and refuse until the owner sets them (B11). `unpriced_model` is refused
in the gate, so a future model without a price row cannot spend. Rate limit 10
per minute per person. Lovable credits spent on this phase: none (no deploy
message was sent).

## Owner actions (none needed to merge; all needed to verify)

1. Apply the migration; deploy `health-api` + `health-ai` in one message; publish (04 §A-2, steps 1–3).
2. Set the two caps (B11), then `ai_admin_verification_enabled`, then `ai_enabled`.
3. Grant the AI consent on the Health tab as the admin; tap through `/app/admin/health-ai`.
4. Decide the AI label wording question (B12) — optional.

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

Re-measured after the red-team pass (2026-09-08, 429 chunks): every marker
still in its route chunk, none in the entry.

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
