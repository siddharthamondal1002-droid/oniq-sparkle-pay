-- Stop dispatching the same Story every sixty seconds.
--
-- WHAT HAPPENED. The heartbeat fires each minute and story-dispatch
-- deliberately does NOT claim the job — a dispatch that never lands on a runner
-- must leave the row available rather than stranding it in `generating`. That
-- is still right. What it missed is the case where dispatch lands every time
-- and the runner cannot claim: the first live Story produced EIGHT workflow
-- runs in eight minutes, all failing identically, burning a runner minute each.
--
-- The fix is a dispatch timestamp rather than a claim. The row stays `queued`,
-- so a lost dispatch is still retried — just after ten minutes instead of
-- sixty seconds. Ten is comfortably longer than the time a healthy runner needs
-- to boot and claim (about ninety seconds, most of it installing Chromium), so
-- a working system never re-dispatches at all.
alter table public.story_jobs
  add column if not exists dispatched_at timestamptz;

comment on column public.story_jobs.dispatched_at is
  'When a runner was last asked to take this job. Not a claim — the row stays '
  'queued until the runner actually claims it. Purely a backoff so a runner '
  'that cannot claim does not get re-summoned every minute.';

-- The dispatcher's query: queued, and not asked for recently.
create index if not exists story_jobs_dispatchable_idx
  on public.story_jobs (dispatched_at nulls first, created_at)
  where status = 'queued';

-- ---------------------------------------------------------------------------
-- The sweeper's guard was wrong, and wrong in the direction that hides a bug.
--
-- story_sweep_tick() returned early unless some job held bytes. That was right
-- when the sweeper only deleted files. It now also ages out jobs that never
-- started — which by definition hold NO bytes — so the old guard skipped the
-- exact case that needed it: a charged, stuck, un-refundable `queued` row.
--
-- The guard becomes "is there anything a sweep could act on", which is bytes OR
-- an unfinished job. Both halves are indexed.
-- ---------------------------------------------------------------------------
create or replace function public.story_sweep_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
  base_url    text;
begin
  if not exists (
    select 1 from public.story_jobs
    where has_bytes
       or status in ('queued','generating','assembling','delivering')
  ) then
    return;
  end if;

  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'story_dispatch_service_role_key'
  limit 1;

  if service_key is null then
    select decrypted_secret into service_key
    from vault.decrypted_secrets
    where name = 'email_queue_service_role_key'
    limit 1;
  end if;

  select decrypted_secret into base_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  if base_url is null then
    base_url := 'https://bqwttemnnoexadpwifcj.supabase.co';
  end if;

  if service_key is null then
    raise warning 'story_sweep_tick: no service-role key in vault; user video is NOT being purged';
    return;
  end if;

  perform net.http_post(
    url     := base_url || '/functions/v1/story-sweep',
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body    := '{}'::jsonb
  );
end;
$$;

revoke all on function public.story_sweep_tick() from public, anon, authenticated;

create index if not exists story_jobs_unfinished_idx
  on public.story_jobs (updated_at)
  where status in ('queued','generating','assembling','delivering');
