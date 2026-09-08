-- ============================================================================
-- ONIQ HEALTH — PHASE 1 (dark).
-- ============================================================================

-- 1. FLAGS -------------------------------------------------------------------
create table if not exists public.health_config (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  uploads_enabled boolean not null default false,
  ai_enabled boolean not null default false,
  health_connect_enabled boolean not null default false,
  abdm_enabled boolean not null default false,
  fhir_enabled boolean not null default false,
  dicom_enabled boolean not null default false,
  hl7_enabled boolean not null default false,
  medgemma_enabled boolean not null default false,
  healthcare_search_enabled boolean not null default false,
  research_enabled boolean not null default false,
  environment text not null default 'production'
    check (environment in ('production', 'staging', 'development')),
  updated_at timestamptz not null default now()
);
insert into public.health_config (id) values (true) on conflict (id) do nothing;
grant select on public.health_config to authenticated;
grant all on public.health_config to service_role;
alter table public.health_config enable row level security;
drop policy if exists "admins read health config" on public.health_config;
create policy "admins read health config" on public.health_config
  for select to authenticated using (public.is_admin(auth.uid()));
drop trigger if exists health_config_touch on public.health_config;
create trigger health_config_touch before update on public.health_config
  for each row execute function public.tg_touch_updated_at();
comment on table public.health_config is
  'ONIQ Health server flags, one row. Mirrors src/health/flagNames.ts. Missing row = everything off.';

-- 2. RETENTION POLICIES -------------------------------------------------------
create table if not exists public.health_retention_policies (
  category text primary key,
  retention_days integer not null check (retention_days > 0),
  basis text not null,
  updated_at timestamptz not null default now()
);
insert into public.health_retention_policies (category, retention_days, basis) values
  ('documents',      3650, 'PLACEHOLDER until counsel sets it — docs/health/04-decisions-for-owner.md D1'),
  ('vitals',         3650, 'PLACEHOLDER until counsel sets it'),
  ('labs',           3650, 'PLACEHOLDER until counsel sets it'),
  ('conditions',     3650, 'PLACEHOLDER until counsel sets it'),
  ('medications',    3650, 'PLACEHOLDER until counsel sets it'),
  ('allergies',      3650, 'PLACEHOLDER until counsel sets it'),
  ('immunizations',  3650, 'PLACEHOLDER until counsel sets it'),
  ('procedures',     3650, 'PLACEHOLDER until counsel sets it'),
  ('encounters',     3650, 'PLACEHOLDER until counsel sets it'),
  ('notes',          3650, 'PLACEHOLDER until counsel sets it'),
  ('device_metrics',  730, 'PLACEHOLDER until counsel sets it')
on conflict (category) do nothing;
grant select on public.health_retention_policies to authenticated;
grant all on public.health_retention_policies to service_role;
alter table public.health_retention_policies enable row level security;
drop policy if exists "retention policies are readable" on public.health_retention_policies;
create policy "retention policies are readable" on public.health_retention_policies
  for select to authenticated using (true);

-- 3. DOCUMENTS ----------------------------------------------------------------
create table if not exists public.health_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in (
    'lab_report','prescription','discharge_summary','imaging_report','vaccination','invoice','other')),
  title text not null check (length(title) between 1 and 120),
  mime text not null check (mime in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text unique,
  status text not null default 'pending_upload'
    check (status in ('pending_upload','stored','processing','ready','deleted')),
  captured_at timestamptz,
  provenance jsonb not null check (
    provenance ? 'source' and provenance->>'source' in (
      'user_entry','document_upload','document_extraction','health_connect','abdm',
      'clinician_import','ai_interpretation')),
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists health_documents_user_created_idx
  on public.health_documents (user_id, created_at desc) where status <> 'deleted';
grant select on public.health_documents to authenticated;
grant all on public.health_documents to service_role;
alter table public.health_documents enable row level security;
drop policy if exists "own health documents" on public.health_documents;
create policy "own health documents" on public.health_documents
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "no health writes for AE home" on public.health_documents;
create policy "no health writes for AE home" on public.health_documents
  as restrictive for all to authenticated
  using (true) with check (public.health_data_allowed(user_id));
drop trigger if exists health_documents_ae_guard on public.health_documents;
create trigger health_documents_ae_guard
  before insert or update on public.health_documents
  for each row execute function public.health_write_guard();
comment on table public.health_documents is
  'ONIQ Health document METADATA. Bytes live in the private health-documents bucket; storage_path is never returned to a client.';

-- 4. RECORDS -----------------------------------------------------------------
create table if not exists public.health_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in (
    'vital','lab','condition','medication','allergy','immunization','procedure','encounter','note')),
  code_system text check (code_system is null or code_system in ('LOINC','SNOMED','ICD10','ATC','ONIQ')),
  code text check (code is null or length(code) between 1 and 64),
  display text not null check (length(display) between 1 and 120),
  value_num numeric,
  value_unit text check (value_unit is null or length(value_unit) <= 24),
  value_text text check (value_text is null or length(value_text) <= 2000),
  effective_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active','entered_in_error','deleted')),
  provenance jsonb not null check (
    provenance ? 'source' and provenance->>'source' in (
      'user_entry','document_upload','document_extraction','health_connect','abdm',
      'clinician_import','ai_interpretation')),
  document_id uuid references public.health_documents(id) on delete set null,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (value_num is not null or value_text is not null)
);
create index if not exists health_records_user_effective_idx
  on public.health_records (user_id, effective_at desc) where status = 'active';
grant select on public.health_records to authenticated;
grant all on public.health_records to service_role;
alter table public.health_records enable row level security;
drop policy if exists "own health records" on public.health_records;
create policy "own health records" on public.health_records
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "no health writes for AE home" on public.health_records;
create policy "no health writes for AE home" on public.health_records
  as restrictive for all to authenticated
  using (true) with check (public.health_data_allowed(user_id));
drop trigger if exists health_records_ae_guard on public.health_records;
create trigger health_records_ae_guard
  before insert or update on public.health_records
  for each row execute function public.health_write_guard();
comment on table public.health_records is
  'ONIQ Health records, above FHIR. Every row carries provenance; a status of deleted keeps the row as a receipt and hides it everywhere.';

-- 5. CONSENTS ----------------------------------------------------------------
create table if not exists public.health_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in (
    'store_records','ai_interpretation','share_with_clinician','health_connect_sync',
    'abdm_exchange','research_deidentified')),
  data_categories text[] not null check (
    cardinality(data_categories) > 0 and data_categories <@ array[
      'vitals','labs','conditions','medications','allergies','immunizations','procedures',
      'encounters','documents','notes','device_metrics']::text[]),
  source text not null check (length(source) between 1 and 64),
  recipient text not null check (recipient in ('oniq','google_vertex','clinician','abdm','research')),
  start_time timestamptz not null default now(),
  expiry_time timestamptz check (expiry_time is null or expiry_time > start_time),
  status text not null default 'active' check (status in ('active','revoked','expired')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  terms_version text not null,
  notice_locale text not null default 'en' check (notice_locale in ('en','hi','bn'))
);
create index if not exists health_consents_user_idx
  on public.health_consents (user_id, created_at desc);
create unique index if not exists health_consents_one_active_idx
  on public.health_consents (user_id, purpose, recipient) where status = 'active';
grant select on public.health_consents to authenticated;
grant all on public.health_consents to service_role;
alter table public.health_consents enable row level security;
drop policy if exists "own health consents" on public.health_consents;
create policy "own health consents" on public.health_consents
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "no health writes for AE home" on public.health_consents;
create policy "no health writes for AE home" on public.health_consents
  as restrictive for all to authenticated
  using (true) with check (public.health_data_allowed(user_id));
drop trigger if exists health_consents_ae_guard on public.health_consents;
create trigger health_consents_ae_guard
  before insert or update on public.health_consents
  for each row execute function public.health_write_guard();
comment on table public.health_consents is
  'ONIQ Health consents: purpose x data categories x recipient x window, versioned. Granting again supersedes; history is never edited. Each grant/revoke also lands in consent_records (the ISO 27560 ledger).';

-- 6. AUDIT (hash chain, no content) -------------------------------------------
create table if not exists public.health_audit (
  id uuid primary key default gen_random_uuid(),
  seq bigserial not null,
  user_id uuid references auth.users(id) on delete set null,
  actor text not null,
  action text not null check (action in (
    'records.create','records.delete','documents.register','documents.confirm','documents.read',
    'documents.delete','consents.grant','consents.revoke','export','purge')),
  object_type text not null check (object_type in ('record','document','consent','account')),
  object_id uuid,
  purpose text,
  consent_id uuid,
  request_id uuid not null,
  outcome text not null check (outcome in ('ok','refused','error')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  prev_hash text,
  record_hash text not null default ''
);
create index if not exists health_audit_user_seq_idx on public.health_audit (user_id, seq desc);
grant select on public.health_audit to authenticated;
grant select, insert on public.health_audit to service_role;
grant usage, select on sequence public.health_audit_seq_seq to service_role;
alter table public.health_audit enable row level security;
drop policy if exists "read own health audit or admin" on public.health_audit;
create policy "read own health audit or admin" on public.health_audit
  for select to authenticated using (auth.uid() = user_id or public.is_admin(auth.uid()));

create or replace function public.health_audit_chain()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare p text;
begin
  perform pg_advisory_xact_lock(7700000000000020);
  select record_hash into p from public.health_audit order by seq desc limit 1;
  new.created_at := now();
  new.prev_hash := p;
  new.record_hash := encode(extensions.digest(
    new.seq::text || '|' || new.id::text || '|' || coalesce(new.user_id::text,'') || '|' ||
    new.actor || '|' || new.action || '|' || new.object_type || '|' ||
    coalesce(new.object_id::text,'') || '|' || coalesce(new.purpose,'') || '|' ||
    coalesce(new.consent_id::text,'') || '|' || new.request_id::text || '|' || new.outcome || '|' ||
    new.detail::text || '|' ||
    to_char(new.created_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    coalesce(p,''), 'sha256'), 'hex');
  return new;
end $$;

drop trigger if exists health_audit_chain_before_insert on public.health_audit;
create trigger health_audit_chain_before_insert
  before insert on public.health_audit
  for each row execute function public.health_audit_chain();

create or replace function public.health_append_audit(
  _user_id uuid, _actor text, _action text, _object_type text, _object_id uuid,
  _purpose text, _consent_id uuid, _request_id uuid, _outcome text, _detail jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_id uuid;
begin
  insert into public.health_audit
    (user_id, actor, action, object_type, object_id, purpose, consent_id, request_id, outcome, detail)
  values
    (_user_id, _actor, _action, _object_type, _object_id, _purpose, _consent_id, _request_id, _outcome,
     coalesce(_detail, '{}'::jsonb))
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.health_append_audit(uuid, text, text, text, uuid, text, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.health_append_audit(uuid, text, text, text, uuid, text, uuid, uuid, text, jsonb)
  to service_role;

create or replace function public.health_verify_audit_chain()
returns table(ok boolean, rows_checked integer, first_bad uuid)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare r record; prev text := null; n integer := 0; bad uuid := null; calc text;
begin
  if not public.is_admin(auth.uid()) then raise exception 'admin only'; end if;
  for r in select * from public.health_audit order by seq asc loop
    n := n + 1;
    calc := encode(extensions.digest(
      r.seq::text || '|' || r.id::text || '|' || coalesce(r.user_id::text,'') || '|' ||
      r.actor || '|' || r.action || '|' || r.object_type || '|' ||
      coalesce(r.object_id::text,'') || '|' || coalesce(r.purpose,'') || '|' ||
      coalesce(r.consent_id::text,'') || '|' || r.request_id::text || '|' || r.outcome || '|' ||
      r.detail::text || '|' ||
      to_char(r.created_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
      coalesce(prev,''), 'sha256'), 'hex');
    if calc <> r.record_hash or r.prev_hash is distinct from prev then
      bad := r.id; exit;
    end if;
    prev := r.record_hash;
  end loop;
  return query select bad is null, n, bad;
end $$;
grant execute on function public.health_verify_audit_chain() to authenticated;

-- 7. RETENTION SWEEP -----------------------------------------------------------
create or replace function public.health_apply_retention()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer := 0; c integer;
begin
  update public.health_records set status = 'deleted', deleted_at = now()
    where expires_at is not null and expires_at <= now() and status <> 'deleted';
  get diagnostics c = row_count; n := n + c;
  update public.health_documents set status = 'deleted', deleted_at = now()
    where expires_at is not null and expires_at <= now() and status <> 'deleted';
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
revoke all on function public.health_apply_retention() from public, anon, authenticated;
grant execute on function public.health_apply_retention() to service_role;