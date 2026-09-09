-- ONIQ Health, Phase 3 (owner directive 2026-09-09): the real provider.
--
-- Three CHECKs named one provider and one notice version because Phase 2 had
-- one of each. Phase 3 registers "vertex" (Google Cloud Vertex AI, Gemini,
-- through the Firebase service account — supabase/functions/_shared/health/ai/vertex.ts)
-- and the notice version that DISCLOSES Google as a recipient. Nothing else
-- changes shape: no new table, no new column, no new audit action. The row's
-- provider, model and switches are set by audited UPDATE afterwards
-- (health_config_audit_ai_controls fires on every column), never here.
--
-- Widened, not replaced: 'synthetic' stays legal on every check so the
-- synthetic provider remains a rollback that needs no migration.
--
-- Pinned by src/health/__tests__/ai/migration3.test.ts: each list here equals
-- the code's own (PROVIDER_IDS, DISCLOSED_RECIPIENTS_BY_TERMS).

-- 1. The provider the row may name, and the provider a receipt may record.
alter table public.health_config drop constraint if exists health_config_ai_provider_check;
alter table public.health_config add constraint health_config_ai_provider_check
  check (ai_provider in ('synthetic', 'vertex'));

alter table public.health_ai_requests drop constraint if exists health_ai_requests_provider_check;
alter table public.health_ai_requests add constraint health_ai_requests_provider_check
  check (provider in ('synthetic', 'vertex'));

-- 2. The terms version that names Google. A consent row's recipient must be
--    one the notice it was granted under disclosed — the same rule
--    consentCovers() enforces in code, so an edited column cannot widen a
--    person's agreement.
alter table public.health_consents drop constraint if exists health_consents_terms_recipient_check;
alter table public.health_consents add constraint health_consents_terms_recipient_check
  check (
    (terms_version = 'health-terms-v1' and recipient in ('oniq')) or
    (terms_version = 'health-ai-terms-v1' and recipient in ('oniq')) or
    (terms_version = 'health-ai-terms-v2' and recipient in ('oniq', 'google_vertex')));

comment on column public.health_config.ai_provider is
  'Which registered provider answers health-ai: synthetic (in-process, admin verification only in production) or vertex (Google Cloud Vertex AI through the Firebase service account; owner directive 2026-09-09). Changed by audited UPDATE.';
