create table if not exists public.agi_research_write_requests (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  repository text not null,
  kind text not null check (kind = 'issue'),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'executing', 'completed', 'failed')),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  completed_at timestamptz,
  result_url text,
  created_at timestamptz not null default now()
);

alter table public.agi_research_write_requests enable row level security;
revoke all on table public.agi_research_write_requests from anon, authenticated;

create index if not exists agi_research_write_requests_expiry_idx
  on public.agi_research_write_requests (status, expires_at);

comment on table public.agi_research_write_requests is
  'One-time server-only confirmation records for ONIQ AGI Research Lab repository writes.';
