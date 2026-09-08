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

Phase 1 code: `src/health/`, `src/routes/_authenticated/app.health*.tsx`,
`supabase/functions/health-api/`, `supabase/functions/_shared/health/`,
`supabase/migrations/20260908120000_oniq_health_phase1.sql`.

Phase 2 code: `supabase/functions/_shared/health/ai/`, `supabase/functions/health-ai/`,
`src/health/ai/`, `src/routes/_authenticated/app.admin_.health-ai.tsx`,
`supabase/migrations/20260908150000_oniq_health_phase2.sql`, tests under
`src/health/__tests__/ai/`. All dark. Phase 3 is NOT AUTHORIZED.
