-- ============================================================================
-- CLIENT ERROR REPORTS — detail for admins, a pretty line for everyone else.
--
-- OWNER DIRECTIVE (2026-08-12): "share detailed error reports only in admin,
-- for others just a pretty message". Until now a failure toast showed users
-- the raw error.message — Postgres constraint prose, RLS denials, whatever
-- the stack threw — which is noise to a user and a breadcrumb trail to an
-- attacker. Now the raw detail lands HERE, readable only by admins in the
-- dashboard's errors panel, and the user sees one friendly sentence.
--
-- Writes go through an RPC (house rule): it stamps the caller, caps lengths,
-- and rate-limits per user so a broken loop cannot flood the table.
-- ============================================================================
create table if not exists public.client_error_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  -- Where in the app it happened — a short slug like 'create-channel'.
  surface text not null,
  message text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists client_error_reports_recent_idx
  on public.client_error_reports (created_at desc);
grant select on public.client_error_reports to authenticated;
alter table public.client_error_reports enable row level security;
drop policy if exists "admins read error reports" on public.client_error_reports;
create policy "admins read error reports" on public.client_error_reports
  for select to authenticated
  using (public.is_admin(auth.uid()));

create or replace function public.report_client_error(
  _surface text,
  _message text,
  _detail text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  recent int;
begin
  if me is null then return; end if;
  -- A stuck retry loop reporting every failure would bury the signal; 20
  -- rows a minute per user is more than any honest failure produces.
  select count(*)::int into recent
    from client_error_reports
   where user_id = me and created_at > now() - interval '1 minute';
  if recent >= 20 then return; end if;
  insert into client_error_reports (user_id, surface, message, detail)
  values (
    me,
    left(trim(coalesce(_surface, 'unknown')), 60),
    left(coalesce(_message, 'unknown'), 500),
    left(_detail, 2000)
  );
end;
$$;
revoke all on function public.report_client_error(text, text, text) from public, anon;
grant execute on function public.report_client_error(text, text, text) to authenticated;

-- ============================================================================
-- CHANNEL CREATION FIX — the type CHECK never learned the word 'channel'.
--
-- Production diagnosis (2026-08-12, raw): conversations_type_check allows
-- only ('direct','group'), while create_channel inserts type='channel' —
-- so EVERY channel creation has failed on the constraint since the feature
-- shipped, and conversations_public_channels_select has been selecting from
-- a set that could never have a row. RLS was never the blocker; the
-- SECURITY DEFINER function sails past policies and dies on the CHECK.
-- ============================================================================
alter table public.conversations drop constraint if exists conversations_type_check;
alter table public.conversations add constraint conversations_type_check
  check (type in ('direct', 'group', 'channel'));
