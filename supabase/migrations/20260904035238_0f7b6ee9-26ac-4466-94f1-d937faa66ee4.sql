alter table public.video_gen_config
  add column if not exists music_enabled boolean not null default false,
  add column if not exists music_daily_cap integer not null default 10,
  add column if not exists music_admin_only boolean not null default true;

comment on column public.video_gen_config.music_enabled is
  'Kill switch for song generation. Defaults OFF: it spends the metered Google key, and a flag is how that gets turned on without a deploy.';
comment on column public.video_gen_config.music_daily_cap is
  'Songs per day across all users. Checked BEFORE the billable call, never after.';
comment on column public.video_gen_config.music_admin_only is
  'While true only an admin may generate. The path is built for users; this is what opens it.';

create table if not exists public.music_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  model text not null,
  status text not null default 'done',
  stored_path text,
  mime text,
  bytes integer,
  error text,
  created_at timestamptz not null default now()
);

comment on table public.music_jobs is
  'One row per song generation attempt. The daily cap counts it, "your songs" lists it, and a failed attempt that cost money is still recorded rather than vanishing.';

create index if not exists music_jobs_user_created_idx
  on public.music_jobs (user_id, created_at desc);
create index if not exists music_jobs_created_idx
  on public.music_jobs (created_at desc);

alter table public.music_jobs enable row level security;

drop policy if exists music_jobs_select_own on public.music_jobs;
create policy music_jobs_select_own on public.music_jobs
  for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.music_jobs from authenticated;