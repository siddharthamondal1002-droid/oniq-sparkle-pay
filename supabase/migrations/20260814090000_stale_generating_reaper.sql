-- The stale-generating reaper: the row a dead runner leaves behind.
--
-- WHAT GOES WRONG WITHOUT THIS. claim moves a job to `generating`; every
-- caught error moves it to `failed`; but a runner that dies HARD — VM
-- reclaimed, workflow cancelled, the 150-minute timeout killing a wedged
-- Chromium — exits without a callback. The row sits in `generating` forever,
-- nothing works on it, the user paid seconds for it, and the dispatcher
-- ignores it because it only reads `queued`. The GitHub timeout bounds the
-- RUNNER; nothing bounded the ROW until this.
--
-- THE CLOCK IS updated_at, which the lifecycle trigger stamps on every
-- status write. During `generating` nothing touches the row (the callbacks
-- are claim, assembling, ready, failed), so updated_at holds the claim time
-- for the whole legitimate run. THREE HOURS beats the longest legitimate
-- anything: the workflow's own timeout is 150 minutes, so a row still
-- `generating` at 180 is dead by the runner's own definition of wedged —
-- reaping can never race live work.
--
-- TWO REVIVALS, THEN THE TRUTH. A poison job — one whose content crashes
-- the runner hard every time — would otherwise loop through the queue
-- forever, burning a runner boot every three hours. reaped_count gives a
-- job two fresh runners; the third strike marks it `failed` with an error
-- the admin report surfaces, which is the honest outcome for a job that
-- kills whatever touches it.
--
-- REAP BEFORE THE QUEUED CHECK. The tick's early return ("nothing queued,
-- nothing to do") fires exactly when a stuck row is the ONLY job in the
-- system — reaping after it would never run in the case it exists for.

alter table public.story_jobs
  add column if not exists reaped_count integer not null default 0;

-- The revival transitions. Everything else in the whitelist is unchanged —
-- this recreates the guard verbatim plus ('generating','queued') and
-- ('assembling','queued'), which only the reaper below ever performs.
create or replace function public.story_jobs_guard_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not exists (
    select 1 from (values
      ('queued','generating'),
      ('queued','failed'),
      ('queued','purged'),
      ('generating','assembling'),
      ('generating','failed'),
      ('generating','purged'),
      ('generating','queued'),
      ('assembling','ready'),
      ('assembling','failed'),
      ('assembling','purged'),
      ('assembling','queued'),
      ('ready','delivering'),
      ('ready','failed'),
      ('ready','purged'),
      ('delivering','delivered'),
      ('delivering','ready'),
      ('delivering','failed'),
      ('delivering','purged'),
      ('delivered','purged'),
      ('failed','purged')
    ) as t(from_status, to_status)
    where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'story lifecycle: cannot go % -> %', old.status, new.status;
  end if;
  return new;
end;
$$;

revoke all on function public.story_jobs_guard_transition() from public, anon, authenticated;

-- The tick, with the reap as its prologue. Body below the reap is the
-- shipped story_dispatch_tick unchanged.
create or replace function public.story_dispatch_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
  base_url    text;
begin
  -- THE REAP. Revive what a dead runner abandoned; dispatched_at is
  -- cleared so the revived job is offered on this same tick instead of
  -- waiting out the ten-minute dispatch backoff it already served.
  update public.story_jobs
     set status = 'queued',
         dispatched_at = null,
         reaped_count = reaped_count + 1
   where status in ('generating','assembling')
     and updated_at < now() - interval '3 hours'
     and reaped_count < 2;

  -- Third strike: the job has now killed two fresh runners on its own.
  update public.story_jobs
     set status = 'failed',
         error = 'reaped: generation died without a callback twice; '
                 || 'giving up rather than burning a runner every three hours'
   where status in ('generating','assembling')
     and updated_at < now() - interval '3 hours'
     and reaped_count >= 2;

  -- Nothing queued, nothing to do. This is the common case by a wide margin.
  if not exists (select 1 from public.story_jobs where status = 'queued') then
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
    raise warning 'story_dispatch_tick: no service-role key in vault; queue is not being dispatched';
    return;
  end if;

  perform net.http_post(
    url     := base_url || '/functions/v1/story-dispatch',
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body    := '{}'::jsonb
  );
end;
$$;

revoke all on function public.story_dispatch_tick() from public, anon, authenticated;

-- The reap's predicate, made as cheap as the tick that runs it every
-- minute: partial on the two in-flight statuses, which a healthy system
-- holds at most a handful of rows in.
create index if not exists story_jobs_inflight_idx
  on public.story_jobs (updated_at)
  where status in ('generating','assembling');
