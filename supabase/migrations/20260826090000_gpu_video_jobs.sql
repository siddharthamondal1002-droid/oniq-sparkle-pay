-- gpu_video_jobs — the in-house GPU generation queue (owner directive
-- 2026-08-26: in-house video is ONIQ's PRIMARY video path).
--
-- A sibling of video_jobs (the Runway tool's table), not a reuse of it:
-- the columns are provider-shaped and the Runway ones (task ids, ratios,
-- credit estimates) do not describe a RunPod serverless job. Same
-- posture though — service-role writes only, admin-only reads, and no
-- credential-shaped column exists by construction.
--
-- Idempotency: (created_by, idempotency_key) is unique, so a double
-- click, refresh or network retry returns the existing job instead of
-- renting a second GPU.

create table if not exists public.gpu_video_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  idempotency_key text not null,
  workload text not null default 'video-generate',
  provider text not null default 'in_house',
  model text not null default 'LTX_VIDEO_2B',
  gpu_type text not null default 'NVIDIA GeForce RTX 3090',
  prompt text not null,
  -- Object references only, both server-generated: input from the staged
  -- registry, output media/video/<job_id>/... Never a URL, never a path
  -- a client typed.
  input_ref text not null,
  output_ref text not null,
  runpod_job_id text unique,
  status text not null default 'queued'
    check (status in (
      'queued', 'admitted', 'provisioning', 'running', 'uploading',
      'completed', 'failed', 'timed-out', 'cancelled', 'terminating',
      'orphaned'
    )),
  price_per_hour_usd numeric(10, 4),
  reservation_usd numeric(10, 4),
  billed_seconds numeric(10, 2),
  actual_cost_usd numeric(10, 4),
  output_bytes bigint,
  video_seconds numeric(6, 2),
  -- Custody copy in Supabase storage (video-gen bucket), played via
  -- signed URLs like every other generated clip. R2 stays worker-side.
  stored_path text,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists gpu_video_jobs_idem_idx
  on public.gpu_video_jobs (created_by, idempotency_key);
create index if not exists gpu_video_jobs_status_idx on public.gpu_video_jobs (status);
create index if not exists gpu_video_jobs_created_by_idx on public.gpu_video_jobs (created_by);

grant select on public.gpu_video_jobs to authenticated;
grant all on public.gpu_video_jobs to service_role;

alter table public.gpu_video_jobs enable row level security;

-- Reads are admin-only, like video_jobs: this is the generation tool's
-- ledger, and generation spend authority currently lives with is_admin.
-- There is deliberately NO insert/update policy for authenticated — all
-- writes go through the server functions with the service role.
create policy "gpu_video_jobs_admin_select" on public.gpu_video_jobs
  for select to authenticated
  using (public.is_admin(auth.uid()));

create or replace function public.gpu_video_jobs_touch_updated_at()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.gpu_video_jobs_touch_updated_at() from public, anon, authenticated;

create trigger update_gpu_video_jobs_updated_at
  before update on public.gpu_video_jobs
  for each row execute function public.gpu_video_jobs_touch_updated_at();
