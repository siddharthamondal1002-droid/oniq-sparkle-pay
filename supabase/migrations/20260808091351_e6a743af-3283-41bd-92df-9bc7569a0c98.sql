create table if not exists public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  runway_task_id text unique,
  status text not null default 'queued',
  scene_ref text,
  prompt_image_url text not null,
  prompt_text text not null,
  model text not null default 'gen4_turbo',
  ratio text not null default '720:1280',
  duration int not null default 5,
  seed bigint,
  output_url text,
  stored_path text,
  error text,
  credits_estimate int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists video_jobs_status_idx on public.video_jobs (status);
create index if not exists video_jobs_created_by_idx on public.video_jobs (created_by);

grant select on public.video_jobs to authenticated;
grant all on public.video_jobs to service_role;

alter table public.video_jobs enable row level security;

create policy "video_jobs_admin_select" on public.video_jobs
  for select to authenticated
  using (public.is_admin(auth.uid()));

create table if not exists public.video_gen_config (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  daily_cap int not null default 20,
  updated_at timestamptz not null default now()
);

grant select on public.video_gen_config to authenticated;
grant all on public.video_gen_config to service_role;

alter table public.video_gen_config enable row level security;

create policy "video_gen_config_admin_select" on public.video_gen_config
  for select to authenticated
  using (public.is_admin(auth.uid()));

insert into public.video_gen_config (id, enabled, daily_cap)
values (true, true, 20)
on conflict (id) do nothing;

create or replace function public.video_jobs_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.video_jobs_touch_updated_at() from public, anon, authenticated;

create trigger update_video_jobs_updated_at
  before update on public.video_jobs
  for each row execute function public.video_jobs_touch_updated_at();