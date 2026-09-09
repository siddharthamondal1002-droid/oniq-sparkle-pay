# ONIQ Health

Owner brief, 2026-09-08: "ONIQ HEALTH — FULL GOOGLE HEALTHCARE INTEGRATION",
built as an isolated, feature-flagged health-data domain inside ONIQ.

| Document                                               | What it is                                                                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [00-audit.md](00-audit.md)                             | Phase 0 — what the repository already is (measured), and the one promise that constrains the AI phase                                                                      |
| [01-research.md](01-research.md)                       | Google healthcare products, current list prices with source labels, regions, auth, standards, AI, Health Connect, ABDM, DPDP, security, recommended architecture, V1/V2/V3 |
| [02-architecture.md](02-architecture.md)               | The domain model above FHIR, consent, provenance, audit, retention, isolation, flags, the request pipeline, phases 2–9, Definition of Done                                 |
| [03-cost-model.md](03-cost-model.md)                   | 1K / 10K / 100K / 1M users with every assumption labelled                                                                                                                  |
| [04-decisions-for-owner.md](04-decisions-for-owner.md) | The go sequences (§A Phase 1, §A-2 Phase 2), every paid surface, console actions, legal-counsel flags, free checks                                                         |
| [05-phase2-ai-gateway.md](05-phase2-ai-gateway.md)     | Phase 2 — the Health AI safety gateway and document intelligence, synthetic provider only: design as built, the five-lens review outcomes, the Definition of Done          |
| [06-phase2-report.md](06-phase2-report.md)             | Phase 2 completion report in the brief's §83F format                                                                                                                       |
| [07-phase3-report.md](07-phase3-report.md)             | Phase 3 — the Vertex provider, activation, the live smoke test, the measured production state (owner directive 2026-09-09)                                                 |

Phase 1 code: `src/health/`, `src/routes/_authenticated/app.health*.tsx`,
`supabase/functions/health-api/`, `supabase/functions/_shared/health/`,
`supabase/migrations/20260908120000_oniq_health_phase1.sql`.

Phase 2 code: `supabase/functions/_shared/health/ai/`, `supabase/functions/health-ai/`,
`src/health/ai/`, `src/routes/_authenticated/app.admin_.health-ai.tsx`,
`supabase/migrations/20260908150000_oniq_health_phase2.sql`, tests under
`src/health/__tests__/ai/`.

Phase 3 code (owner directive 2026-09-09, LIVE): the provider
`supabase/functions/_shared/health/ai/vertex.ts` (Google Cloud Vertex AI,
Gemini, through the Firebase service account), the price row in `ai/cost.ts`,
the consent pair and terms version `health-ai-terms-v2` in `domain.ts` /
`consent.ts`, `supabase/migrations/20260909100000_oniq_health_phase3_vertex.sql`,
the recipient sentence in `src/config/privacy.ts`, the retired
`supabase/functions/health-scan` stub, `scripts/health-ai-cost-report.sql`,
and the tests `ai/vertex.test.ts`, `ai/migration3.test.ts`,
`anthropicRetired.test.ts`. Design as built: `05 §17`; report: `07`.

Phase 3b (owner directive 2026-09-09, later the same day, "A, B and C"):
uploads ON; the stored-document text source `_shared/health/ai/textSource.ts`,
the PDF reader `_shared/health/ai/pdfText.ts` (the one third-party module,
`npm:unpdf@1.8.1`, importable from that file only), `transcribe()` in
`vertex.ts`, the gateway's caps-then-receipt-then-transcribe step, and
`scripts/health-pdf-text-probe.ts` (the real reader on Deno). Design as built:
`05 §18`; record: `07`, "2026-09-09 (later)". Every other flag stays off.

## Verifying production

- `scripts/health-production-check.sql` — read-only against production; PASS = zero rows. Schema, RLS, triggers, the audit vocabulary, the provider lock, the bucket, retention, migration history, the config row against the owner's values, and the audit chain recomputed. Expectations pinned to their sources by `src/health/__tests__/productionCheck.test.ts`.
- `npx tsx scripts/health-bundle-markers.ts [--url https://oniqhub.com]` — the admin-screen markers in their route chunk and the privacy sentence in its chunk; exit 2 means unreachable, not stale.
- The deployed functions, from inside the database with `pg_net` (recipe at the bottom of the SQL file): a response proves deployment, its reason code proves which gate answered.
- `scripts/health-ai-cost-report.sql` — the Health AI ledger read from the receipts: requests, refusals and errors per day / task / provider / model, input and output tokens, estimated cost at the code's own price row; the rolling-24h counts the caps are enforced against; the closed provider-failure codes on the audit rows. No health content is in any column it reads.
