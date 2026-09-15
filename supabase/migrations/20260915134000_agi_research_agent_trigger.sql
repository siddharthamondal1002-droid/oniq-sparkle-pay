alter table public.agi_research_write_requests
  drop constraint if exists agi_research_write_requests_kind_check;

alter table public.agi_research_write_requests
  add constraint agi_research_write_requests_kind_check
  check (kind in ('issue', 'agent_trigger'));

comment on table public.agi_research_write_requests is
  'One-time server-only confirmation records for ONIQ AGI Research Lab executions.';
