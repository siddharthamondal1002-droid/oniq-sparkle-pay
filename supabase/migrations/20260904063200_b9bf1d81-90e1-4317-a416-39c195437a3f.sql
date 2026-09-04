alter table public.video_gen_config
  add column if not exists voice_enabled boolean not null default false,
  add column if not exists voice_daily_cap integer not null default 200,
  add column if not exists voice_admin_only boolean not null default true,
  add column if not exists voice_per_user_daily_cap integer not null default 10;

comment on column public.video_gen_config.voice_enabled is
  'Kill switch for user voice generation. Defaults OFF: it spends Lovable credits, and a flag is how that gets turned on without a deploy.';
comment on column public.video_gen_config.voice_daily_cap is
  'Voice clips per day across all users. Checked BEFORE the billable call.';
comment on column public.video_gen_config.voice_admin_only is
  'While true only an admin may generate. The path is built for users; this is what opens it.';
comment on column public.video_gen_config.voice_per_user_daily_cap is
  'Voice clips per person per rolling 24h, so one account cannot take the whole day''s allowance. Checked BEFORE the billable call, alongside the house cap.';

create table if not exists public.voice_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  voice text not null,
  model text not null,
  status text not null default 'done',
  stored_path text,
  mime text,
  bytes integer,
  error text,
  created_at timestamptz not null default now()
);

comment on table public.voice_jobs is
  'One row per voice generation attempt. The caps count it, "my creations" lists it, and a failed attempt that cost money is still recorded rather than vanishing.';

create index if not exists voice_jobs_user_created_idx on public.voice_jobs (user_id, created_at desc);
create index if not exists voice_jobs_created_idx on public.voice_jobs (created_at desc);

alter table public.voice_jobs enable row level security;

drop policy if exists voice_jobs_select_own on public.voice_jobs;
create policy voice_jobs_select_own on public.voice_jobs
  for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.voice_jobs from authenticated;