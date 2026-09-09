-- ONIQ Health — Phase 4 (owner directive 2026-09-09, "Autonomous Production
-- Hardening"): two things the code could not guarantee from outside the
-- database, and one belt.
--
-- 1. THE CAPS ARE RESERVED, NOT COUNTED. health_ai_reserve_request() counts
--    the rolling-24h window and inserts the STARTED receipt in one
--    transaction under an advisory lock, so two requests arriving together
--    can no longer both read "N-1", both pass, and both spend. The gateway
--    (_shared/health/ai/gateway.ts) used to count house, count person, then
--    insert — three statements, three round trips, one race. Measured on
--    2026-09-09 by the seq race in the audit chain: concurrent calls through
--    pg_net DO interleave on this project. The rules are unchanged and are
--    the ones the owner set on 2026-09-08 (B11): the HOUSE window first,
--    then the PERSON's window for THIS TASK, both windows rolling 24h, neither
--    count filtering on status (a refused request is a request), 0 on either
--    side refusing as caps_unset — zero means unavailable, never unlimited.
--    Only the service role may execute it; a person's client never reaches
--    the ledger with a write.
--
-- 2. THE AUDIT LOG IS APPEND-ONLY BY TRIGGER, NOT ONLY BY GRANT. The service
--    role has select+insert on health_audit and nothing else, which stops the
--    functions; it does not stop the table owner, a console, or a future
--    migration written at speed. health_audit_immutable() refuses every
--    UPDATE and DELETE — with ONE shaped exception: the FK on user_id is
--    `on delete set null`, so an account's erasure UPDATES user_id to null
--    and touches nothing else (migration 20260908190000 is what keeps the
--    hash valid through that). An update that nulls user_id and changes no
--    other column is allowed; anything else raises. A verifier can prove a
--    row was changed; it cannot prove a row was removed from the END of the
--    chain — nothing links to the last row yet — which is exactly why deletes
--    are refused at the table rather than detected afterwards.
--
-- 3. ONE RECEIPT PER REQUEST is a database fact. The gateway generates the
--    request id and writes at most one receipt for it (a provisional one for
--    a transcription is completed, never followed by a second); a UNIQUE
--    index on request_id turns that invariant from a code path into a
--    constraint a bug cannot cross twice.
--
-- APPLIED TO PRODUCTION through the Lovable database connection, one
-- statement per call, the state read BEFORE any retry (a 499 from that
-- connection is not a cancelled DDL — CLAUDE.md, 2026-09-09). Recorded in
-- supabase_migrations.schema_migrations under this version.
-- Pinned by src/health/__tests__/ai/reserve.test.ts and
-- src/health/__tests__/auditImmutable.test.ts.

-- 1. The reservation: count and insert under one lock.
create or replace function public.health_ai_reserve_request(
  _user_id uuid,
  _request_id uuid,
  _task text,
  _purpose text,
  _provider text,
  _model text,
  _consent_id uuid,
  _manifest jsonb,
  _cap_house integer,
  _cap_user integer,
  _since timestamptz
)
returns table(receipt_id uuid, refusal text)
language plpgsql
security definer
set search_path = public
as $$
declare house_n bigint; user_n bigint; new_id uuid;
begin
  -- Zero means unavailable, never unlimited — enforced here as well as in
  -- the gate, so no caller can turn a missing cap into an open one.
  if _cap_house is null or _cap_house <= 0 or _cap_user is null or _cap_user <= 0 then
    return query select null::uuid, 'caps_unset'::text; return;
  end if;
  -- ONE lock for the whole ledger: the house window is app-wide, so every
  -- reservation must see every other, and the count-then-insert below is
  -- atomic against any other caller holding this lock.
  perform pg_advisory_xact_lock(7700000000000030);
  -- THE HOUSE FIRST (owner directive B11: the ceiling), every task, every
  -- person, no status filter.
  select count(*) into house_n from public.health_ai_requests where created_at >= _since;
  if house_n >= _cap_house then
    return query select null::uuid, 'quota_house'::text; return;
  end if;
  -- THEN THE PERSON, for THIS task, no status filter.
  select count(*) into user_n from public.health_ai_requests
    where user_id = _user_id and task = _task and created_at >= _since;
  if user_n >= _cap_user then
    return query select null::uuid, 'quota_user'::text; return;
  end if;
  insert into public.health_ai_requests
    (user_id, request_id, task, purpose, provider, model, consent_id, manifest, status)
  values
    (_user_id, _request_id, _task, _purpose, _provider, _model, _consent_id,
     coalesce(_manifest, '{}'::jsonb), 'started')
  returning id into new_id;
  return query select new_id, null::text;
end $$;
revoke all on function public.health_ai_reserve_request(uuid, uuid, text, text, text, text, uuid, jsonb, integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.health_ai_reserve_request(uuid, uuid, text, text, text, text, uuid, jsonb, integer, integer, timestamptz)
  to service_role;
comment on function public.health_ai_reserve_request(uuid, uuid, text, text, text, text, uuid, jsonb, integer, integer, timestamptz) is
  'ONIQ Health AI: the caps checked and the started receipt written in one locked transaction (Phase 4). House window first, then the person''s window for the task; 24h rolling; no status filter; 0 = caps_unset. Service role only.';

-- 2. One receipt per request, as a constraint.
create unique index if not exists health_ai_requests_request_id_key
  on public.health_ai_requests (request_id);

-- 3. The audit log cannot be edited or trimmed, whoever holds the table.
create or replace function public.health_audit_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'health_audit is append-only: rows are never deleted (seq %)', old.seq
      using errcode = 'restrict_violation';
  end if;
  -- The one legitimate update: an account's erasure nulling user_id through
  -- the foreign key, with every other column byte-identical.
  if old.user_id is not null and new.user_id is null
     and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
    return new;
  end if;
  raise exception 'health_audit is append-only: rows are never edited (seq %)', old.seq
    using errcode = 'restrict_violation';
end $$;
revoke all on function public.health_audit_immutable() from public, anon, authenticated;
drop trigger if exists health_audit_immutable_before_change on public.health_audit;
create trigger health_audit_immutable_before_change
  before update or delete on public.health_audit
  for each row execute function public.health_audit_immutable();
comment on function public.health_audit_immutable() is
  'ONIQ Health: refuses every UPDATE and DELETE on health_audit except the FK set-null an account erasure performs (Phase 4). The chain can detect an edited row; only a refusal can stop a removed one.';
