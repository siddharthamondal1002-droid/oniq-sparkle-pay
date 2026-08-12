-- ============================================================================
-- CLIENT ERROR REPORTS — detail for admins, a pretty line for everyone else.
-- ============================================================================
create table if not exists public.client_error_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
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
-- CHANNEL CREATION FIX — allow 'channel' in conversations_type_check.
-- ============================================================================
alter table public.conversations drop constraint if exists conversations_type_check;
alter table public.conversations add constraint conversations_type_check
  check (type in ('direct', 'group', 'channel'));
