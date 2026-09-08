# ONIQ Health

Owner brief, 2026-09-08: "ONIQ HEALTH — FULL GOOGLE HEALTHCARE INTEGRATION",
built as an isolated, feature-flagged health-data domain inside ONIQ.

| Document                                               | What it is                                                                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [00-audit.md](00-audit.md)                             | Phase 0 — what the repository already is (measured), and the one promise that constrains the AI phase                                                                      |
| [01-research.md](01-research.md)                       | Google healthcare products, current list prices with source labels, regions, auth, standards, AI, Health Connect, ABDM, DPDP, security, recommended architecture, V1/V2/V3 |
| [02-architecture.md](02-architecture.md)               | The domain model above FHIR, consent, provenance, audit, retention, isolation, flags, the request pipeline, phases 2–9, Definition of Done                                 |
| [03-cost-model.md](03-cost-model.md)                   | 1K / 10K / 100K / 1M users with every assumption labelled                                                                                                                  |
| [04-decisions-for-owner.md](04-decisions-for-owner.md) | The go sequence, every paid surface, console actions, legal-counsel flags, free checks                                                                                     |

Phase 1 code: `src/health/`, `src/routes/_authenticated/app.health*.tsx`,
`supabase/functions/health-api/`, `supabase/functions/_shared/health/`,
`supabase/migrations/20260908120000_oniq_health_phase1.sql`. All dark.
