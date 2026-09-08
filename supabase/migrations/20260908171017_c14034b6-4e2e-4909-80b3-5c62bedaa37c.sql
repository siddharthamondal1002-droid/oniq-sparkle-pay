-- ============================================================================
-- ONIQ HEALTH — PHASE 2 (dark).
-- ============================================================================

-- 1. FLAGS AND AI CONFIG ------------------------------------------------------
alter table public.health_config
  add column if not exists provider_sharing_enabled boolean not null default false,
  add column if not exists ai_provider text not null default 'synthetic',
  add column if not exists ai_model text not null default 'synthetic-v1',
  add column if not exists ai_daily_caps jsonb not null default
    '{"answer_question":10,"explain_record":5,"summarize_timeline":3,"classify_document":10,"extract_document":10}'::jsonb,
  add column if not exists ai_daily_cap_house integer not null default 0,
  add column if not exists ai_kill_switch boolean not null default false,
  add column if not exists ai_admin_verification_enabled boolean not null default false;
alter table public.health_config drop constraint if exists health_config_ai_provider_check;
alter table public.health_config add constraint health_config_ai_provider_check
  check (ai_provider in ('synthetic'));
alter table public.health_config drop constraint if exists health_config_ai_model_check;
alter table public.health_config add constraint health_config_ai_model_check
  check (length(ai_model) between 1 and 64);
alter table public.health_config drop constraint if exists health_config_ai_caps_check;
alter table public.health_config add constraint health_config_ai_caps_check
  check (ai_daily_cap_house >= 0 and jsonb_typeof(ai_daily_caps) = 'object');
comment on column public.health_config.ai_daily_caps is
  'Per person, per TASK, per rolling 24h, keyed by the task name. Owner directive 2026-09-08 (B11): ask 10, explain 5, summarise 3, document classify/extract 10. Change with an UPDATE, never a migration. A task with no key, or 0, is refused (caps_unset). The server is the authority; the client never is.';
comment on column public.health_config.ai_daily_cap_house is
  'Requests for the WHOLE app per rolling 24h, every task, every person. 0 = refuse (caps_unset). The owner sets it; it is a spend decision.';
comment on column public.health_config.ai_kill_switch is
  'EMERGENCY STOP for every Health AI path. true forces the ai and provider_sharing flags off whatever the other columns say; an admin flips it from /app/admin/health-ai (health-api admin.ai_kill, audited), in seconds, with no SQL and no deploy.';
comment on column public.health_config.ai_admin_verification_enabled is
  'Lets an is_admin account exercise the synthetic provider in production. Every such call is audited with method=admin_verification.';
comment on column public.health_config.environment is
  'Informational below production: the function resolves PRODUCTION from SUPABASE_URL naming the production project, whatever this says. Never set staging on the production row expecting it to open anything.';

-- 2. RECORDS: candidates ------------------------------------------------------
alter table public.health_records drop constraint if exists health_records_status_check;
alter table public.health_records add constraint health_records_status_check
  check (status in ('active','entered_in_error','deleted','candidate','rejected'));
alter table public.health_records add column if not exists confidence numeric;
alter table public.health_records drop constraint if exists health_records_confidence_check;
alter table public.health_records add constraint health_records_confidence_check
  check (confidence is null or (confidence >= 0 and confidence <= 1));
alter table public.health_records drop constraint if exists health_records_extraction_numeric_check;
alter table public.health_records add constraint health_records_extraction_numeric_check
  check (provenance->>'source' <> 'document_extraction' or value_text is null);
create index if not exists health_records_user_candidate_idx
  on public.health_records (user_id, created_at desc) where status = 'candidate';

-- 3. DOCUMENTS: classification hint and extraction state ------------------------
alter table public.health_documents
  add column if not exists classification jsonb,
  add column if not exists extraction_status text not null default 'none',
  add column if not exists text_chars integer;
alter table public.health_documents drop constraint if exists health_documents_extraction_status_check;
alter table public.health_documents add constraint health_documents_extraction_status_check
  check (extraction_status in ('none','candidates','empty','failed'));
alter table public.health_documents drop constraint if exists health_documents_text_chars_check;
alter table public.health_documents add constraint health_documents_text_chars_check
  check (text_chars is null or text_chars >= 0);

-- 4. CONSENTS: the terms must have disclosed the recipient --------------------------
alter table public.health_consents add column if not exists jurisdiction text not null default 'IN';
alter table public.health_consents drop constraint if exists health_consents_jurisdiction_check;
alter table public.health_consents add constraint health_consents_jurisdiction_check
  check (jurisdiction ~ '^[A-Z]{2}$');
alter table public.health_consents drop constraint if exists health_consents_terms_recipient_check;
alter table public.health_consents add constraint health_consents_terms_recipient_check
  check (
    (terms_version = 'health-terms-v1' and recipient in ('oniq')) or
    (terms_version = 'health-ai-terms-v1' and recipient in ('oniq')));

-- 5. AUDIT: the six new actions ----------------------------------------------------
alter table public.health_audit drop constraint if exists health_audit_action_check;
alter table public.health_audit add constraint health_audit_action_check
  check (action in (
    'records.create','records.delete','records.confirm','records.reject',
    'documents.register','documents.confirm','documents.read','documents.delete',
    'documents.classify','documents.extract',
    'consents.grant','consents.revoke','ai.request','ai.refused','export','purge',
    'config.ai_kill','config.ai_caps','config.changed'));
alter table public.health_audit drop constraint if exists health_audit_object_type_check;
alter table public.health_audit add constraint health_audit_object_type_check
  check (object_type in ('record','document','consent','account','config'));

-- 5b. EVERY CHANGE TO THE AI CONTROLS IS AUDITED (owner directive 2026-09-08) ------
create or replace function public.health_config_audit_ai_controls()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ai_daily_cap_house is distinct from old.ai_daily_cap_house
     or new.ai_daily_caps is distinct from old.ai_daily_caps
     or new.ai_kill_switch is distinct from old.ai_kill_switch
     or new.ai_enabled is distinct from old.ai_enabled
     or new.ai_admin_verification_enabled is distinct from old.ai_admin_verification_enabled then
    perform public.health_append_audit(
      null::uuid, current_user::text, 'config.changed', 'config', null::uuid,
      null::text, null::uuid, gen_random_uuid(), 'ok',
      jsonb_build_object(
        'house', new.ai_daily_cap_house,
        'caps', new.ai_daily_caps,
        'switch', case when new.ai_kill_switch then 'on' else 'off' end,
        'ai_enabled', new.ai_enabled,
        'admin_verification', new.ai_admin_verification_enabled));
  end if;
  return new;
end $$;
revoke all on function public.health_config_audit_ai_controls() from public, anon, authenticated;
drop trigger if exists health_config_audit_ai_controls on public.health_config;
create trigger health_config_audit_ai_controls
  after update on public.health_config
  for each row execute function public.health_config_audit_ai_controls();

-- 6. RECEIPTS ---------------------------------------------------------------------
create table if not exists public.health_ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  request_id uuid not null,
  task text not null check (task in (
    'explain_record','summarize_timeline','answer_question','classify_document','extract_document')),
  purpose text not null check (purpose in ('ai_interpretation')),
  provider text not null check (provider in ('synthetic')),
  model text not null check (length(model) between 1 and 64),
  consent_id uuid,
  manifest jsonb not null default '{}'::jsonb,
  status text not null default 'started' check (status in ('started','ok','refused','error')),
  refusal_reason text check (refusal_reason is null or refusal_reason in (
    'ai_disabled','task_not_allowed','provider_not_allowed','model_not_allowed','unpriced_model',
    'caps_unset','region_blocked','age_unverified','minor_blocked','synthetic_in_production',
    'ai_consent_required','consent_required','question_rejected','not_found','no_text',
    'text_too_long','quota_user','quota_house','output_rejected','provider_error')),
  contract_code text check (contract_code is null or contract_code in (
    'not_an_object','schema_version','task_mismatch','provider_mismatch','model_mismatch',
    'language_unsupported','no_segments','too_many_segments','response_too_long','refusals_shape',
    'bad_refusal_code','usage_shape','cost_shape','segment_shape','segment_class','class_not_allowed',
    'segment_empty','segment_too_long','too_many_citations','forbidden_dose','forbidden_prescribe',
    'forbidden_med_change','forbidden_diagnosis','forbidden_impersonation','forbidden_care_avoidance',
    'forbidden_off_app','identifier_in_output','obfuscated_output','disclaimer_in_output',
    'citation_outside_manifest','fact_without_source','citation_mismatch','ungrounded_number',
    'general_info_cites','general_info_second_person','unknown_cites','unknown_has_number',
    'interpretation_without_source','confidence_range','fact_advises_reader',
    'classification_shape','extraction_shape','too_many_candidates','candidate_outside_table')),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cost_usd numeric check (cost_usd is null or cost_usd >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  purged_at timestamptz
);
create index if not exists health_ai_requests_created_idx
  on public.health_ai_requests (created_at desc);
create index if not exists health_ai_requests_user_created_idx
  on public.health_ai_requests (user_id, created_at desc);
grant select on public.health_ai_requests to authenticated;
grant all on public.health_ai_requests to service_role;
alter table public.health_ai_requests enable row level security;
drop policy if exists "own health ai requests" on public.health_ai_requests;
create policy "own health ai requests" on public.health_ai_requests
  for select to authenticated using (auth.uid() = user_id);
comment on table public.health_ai_requests is
  'ONIQ Health AI receipts: one row per request, written before the provider runs. Ids, counts and closed codes only. The daily-cap ledger; counts never filter on status.';

-- 7. RETENTION: receipts have a period too --------------------------------------------
insert into public.health_retention_policies (category, retention_days, basis) values
  ('ai_requests', 365, 'PLACEHOLDER until counsel sets it — docs/health/04-decisions-for-owner.md D1')
on conflict (category) do nothing;

create or replace function public.health_apply_retention()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer := 0; c integer; receipt_days integer;
begin
  update public.health_records set status = 'deleted', deleted_at = now()
    where expires_at is not null and expires_at <= now() and status <> 'deleted';
  get diagnostics c = row_count; n := n + c;
  update public.health_documents set status = 'deleted', deleted_at = now()
    where expires_at is not null and expires_at <= now() and status <> 'deleted';
  get diagnostics c = row_count; n := n + c;
  select retention_days into receipt_days from public.health_retention_policies
    where category = 'ai_requests';
  if receipt_days is not null then
    delete from public.health_ai_requests
      where created_at < now() - (receipt_days * interval '1 day');
    get diagnostics c = row_count; n := n + c;
  end if;
  return n;
end $$;
revoke all on function public.health_apply_retention() from public, anon, authenticated;
grant execute on function public.health_apply_retention() to service_role;