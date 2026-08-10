-- The Story heartbeat: Supabase reaches out, GitHub never reaches in.
--
-- WHY THIS EXISTS AT ALL. The obvious wiring has a GitHub Actions cron poll
-- this database every ten minutes, which means GitHub holds the service-role
-- key — the master key, bypassing every RLS policy, sitting in a repository
-- secret forever, to move one row through four states. That cron has been
-- deleted from the workflow. This is what replaced it: the database notices its
-- own queue and calls story-dispatch, which hands one runner one job and a
-- token scoped to it for an hour.
--
-- IT CHECKS BEFORE IT CALLS. An unconditional minute tick would fire 1,440
-- pointless HTTP requests a day at a feature that is off. The guard is a single
-- indexed lookup on a status the queue already has to maintain.
--
-- DOUBLE DISPATCH IS SAFE, which is why this can be simple. If a tick fires for
-- a job a runner is already claiming, `claim` in story-callback moves the row
-- with a `status=eq.queued` filter, the loser gets a 409, and the worker logs
-- "nothing to claim" and exits 0. Correctness lives in the claim, not in the
-- scheduler being clever.

create extension if not exists pg_net with schema extensions;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension pg_cron;
  end if;
end
$$;

-- The service-role key, in vault rather than in this file.
--
-- story-dispatch authenticates its caller by comparing the Authorization header
-- against the service key, because dispatching is an internal job and an
-- authenticated user calling it could push other people's Stories at a runner.
-- The key therefore has to be readable HERE, and vault is where this project
-- already keeps it for the email queue.
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
  -- Nothing queued, nothing to do. This is the common case by a wide margin.
  if not exists (select 1 from public.story_jobs where status = 'queued') then
    return;
  end if;

  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'story_dispatch_service_role_key'
  limit 1;

  -- Fall back to the key the email queue already stores, so this works without
  -- a second copy of the same secret if one is already present.
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

  -- No key means no dispatch, and saying so beats a silent no-op: a Story
  -- sitting at `queued` forever with nothing in the log is the failure mode
  -- this whole feature is most likely to have.
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

-- Every minute. A Story takes minutes to render, so a sub-minute scheduler
-- would buy nothing measurable and cost a tick every few seconds.
do $$
begin
  perform cron.unschedule('story-dispatch-heartbeat');
exception
  when others then null;
end
$$;

select cron.schedule(
  'story-dispatch-heartbeat',
  '* * * * *',
  $$select public.story_dispatch_tick();$$
);

-- The guard above is only cheap if the queue lookup is. Partial, because the
-- only status this ever asks about is `queued` and the finished rows are the
-- ones that accumulate.
create index if not exists story_jobs_queued_idx
  on public.story_jobs (created_at)
  where status = 'queued';

-- ---------------------------------------------------------------------------
-- The sweeper: the deletion that happens when nobody taps Save.
--
-- story-deliver purges on the tap, which covers the happy path. This covers
-- every other one — a Story generated and never opened, a job that failed after
-- buying nine stills, a runner that died mid-render, a delete that returned
-- 500. Without it, "your video is deleted from our servers" is true only for
-- the people who finish the flow.
--
-- FIFTEEN MINUTES, not one. Nothing here is urgent: the shortest TTL it acts on
-- is thirty minutes, so a faster tick would find the same empty set more often.
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
  -- Nothing is holding bytes, so there is nothing to delete. Backed by
  -- story_jobs_bytes_idx, which is partial on exactly this predicate.
  if not exists (select 1 from public.story_jobs where has_bytes) then
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

  -- Louder than the dispatch warning on purpose. A queue that stops moving is
  -- visible to the user; a sweeper that stops running is invisible, and what it
  -- leaves behind is other people's video.
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

do $$
begin
  perform cron.unschedule('story-sweep');
exception
  when others then null;
end
$$;

select cron.schedule(
  'story-sweep',
  '*/15 * * * *',
  $$select public.story_sweep_tick();$$
);
