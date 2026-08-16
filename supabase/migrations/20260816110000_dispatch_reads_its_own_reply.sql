-- THE DISPATCHER NEVER LOOKED AT ITS OWN REPLY.
--
-- Diagnosed 2026-08-16 from a Story that died without ever being rendered:
-- job eb0d052f, queued 03:06 UTC on 08-15, `dispatched_at` still null when
-- story-sweep failed and refunded it 39 minutes later. There was no
-- story-worker run of ANY kind between 08-14 16:00 and 08-15 10:33, and the
-- cron fired all 90 times in the hour around it, every one reporting success.
--
-- Both facts were true because `story_dispatch_tick` ended with a bare
-- `perform net.http_post(...)`. pg_net is fire-and-forget: the perform returns
-- a request id the instant the row is queued, so the cron records success
-- whether the edge function answered 200, answered "configured: false", or
-- was never reached at all. A dispatcher that is misconfigured looked exactly
-- like a queue with nothing in it, and the only signal that reached the user
-- was a generic refund half an hour later. By the time anyone asked, pg_net
-- had pruned the response and the answer was gone for good.
--
-- WHAT THIS CHANGES. The tick now keeps the request id and reads the reply on
-- the NEXT tick — pg_net answers asynchronously, so there is nothing to read
-- in the same call. The outcome lands in story_dispatch_health, and a failure
-- also files a row in client_error_reports, which is the panel the owner
-- already reads. No new surface to remember to look at.
--
-- A 200 IS NOT SUCCESS HERE. story-dispatch answers 200 with
-- `{"configured": false, ...}` when it has no GitHub token and 200 with
-- `{"error": ...}` when the queue read fails — both are the dispatcher NOT
-- dispatching, and both were invisible. The body is inspected, not just the
-- status.

create table if not exists public.story_dispatch_health (
  -- One row, forever. `check (id)` makes the primary key admit only `true`.
  id                   boolean primary key default true check (id),
  -- The pg_net request awaiting reconciliation, and when it went out.
  request_id           bigint,
  sent_at              timestamptz,
  last_ok_at           timestamptz,
  last_fail_at         timestamptz,
  last_status          integer,
  last_detail          text,
  consecutive_failures integer not null default 0,
  -- Throttles the admin report; an outage must not file one row a minute.
  last_reported_at     timestamptz
);

insert into public.story_dispatch_health (id) values (true) on conflict (id) do nothing;

comment on table public.story_dispatch_health is
  'Whether the Story dispatcher is actually reaching GitHub. Written by story_dispatch_tick, which reconciles each pg_net POST against net._http_response on the following tick. Before 2026-08-16 nothing read the reply at all and a broken dispatcher was indistinguishable from an empty queue.';

-- Nobody reads this from a browser; the admin dashboard reads the error
-- reports it files. Service role and definer functions only.
revoke all on table public.story_dispatch_health from public, anon, authenticated;
alter table public.story_dispatch_health enable row level security;

create or replace function public.story_dispatch_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h           public.story_dispatch_health%rowtype;
  resp        record;
  service_key text;
  base_url    text;
  req         bigint;
  ok          boolean;
  detail      text;
  -- NOT `status`: that name is ambiguous against story_jobs.status inside the
  -- reap below, and plpgsql resolves it as the variable — which throws. Caught
  -- by running the function rather than by reading it.
  resp_status integer;
begin
  -- ---------------------------------------------------------------- reconcile
  --
  -- Read the PREVIOUS tick's reply. It cannot be read in the tick that sent it
  -- — pg_net writes the response row asynchronously — which is exactly why the
  -- original code got away with never reading one.
  select * into h from public.story_dispatch_health where id;
  if h.request_id is not null then
    select r.status_code, r.content, r.error_msg into resp
      from net._http_response r where r.id = h.request_id;

    if found then
      resp_status := resp.status_code;
      detail := left(coalesce(resp.error_msg, resp.content, ''), 500);
      -- A 200 carrying `configured:false` or an `error` key is a dispatcher
      -- that did not dispatch. Status alone would call that healthy.
      -- Matched as literal text rather than parsed: `content` is not always
      -- JSON (a proxy or gateway answers HTML), and a cast that throws would
      -- take the whole tick down — including the reap above it.
      ok := resp.error_msg is null
        and resp_status between 200 and 299
        and coalesce(resp.content, '') not like '%"error"%'
        and coalesce(resp.content, '') not like '%"configured":false%'
        and coalesce(resp.content, '') not like '%"configured": false%';
    elsif h.sent_at is not null and h.sent_at < now() - interval '10 minutes' then
      -- pg_net prunes its response table, so a reply this old that we never
      -- saw is not "still in flight" — it is a reply we lost, which is itself
      -- worth recording rather than clearing silently.
      ok := false;
      resp_status := null;
      detail := 'no response row within 10 minutes — pg_net pruned it, or the request never completed';
    end if;

    if ok is not null then
      if ok then
        update public.story_dispatch_health
           set request_id = null, sent_at = null, last_ok_at = now(),
               last_status = resp_status, last_detail = null, consecutive_failures = 0
         where id;
      else
        update public.story_dispatch_health
           set request_id = null, sent_at = null, last_fail_at = now(),
               last_status = resp_status, last_detail = detail,
               consecutive_failures = h.consecutive_failures + 1
         where id
        returning * into h;

        raise warning 'story_dispatch_tick: dispatch failed (status %, %)', resp_status, detail;

        -- FILE IT WHERE SOMEBODY LOOKS — but at most hourly, so a day-long
        -- outage is one line a day rather than 1,440.
        if h.last_reported_at is null or h.last_reported_at < now() - interval '1 hour' then
          insert into public.client_error_reports (user_id, surface, message, detail)
          values (
            null,
            'story-dispatch',
            'the Story dispatcher is not reaching GitHub ('
              || h.consecutive_failures || ' in a row)',
            left(coalesce('status ' || resp_status || ' — ', '') || coalesce(detail, ''), 2000)
          );
          update public.story_dispatch_health set last_reported_at = now() where id;
        end if;
      end if;
    end if;
  end if;

  -- --------------------------------------------------------------- the reap
  -- Revive what a dead runner abandoned; dispatched_at is cleared so the
  -- revived job is offered on this same tick instead of waiting out the
  -- ten-minute dispatch backoff it already served.
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

  -- ------------------------------------------------------------- the dispatch
  -- Nothing queued, nothing to do. This is the common case by a wide margin.
  if not exists (select 1 from public.story_jobs where status = 'queued') then
    return;
  end if;

  -- One request in flight at a time. Sending another before the last one has
  -- been reconciled would lose the outcome we just built all this to keep.
  if exists (select 1 from public.story_dispatch_health where id and request_id is not null) then
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
    -- THE ONE FAILURE THAT NEVER REACHED pg_net AT ALL, and therefore has no
    -- reply to reconcile. It has to be recorded here or it stays exactly as
    -- invisible as it was before this migration.
    update public.story_dispatch_health
       set last_fail_at = now(), last_status = null,
           last_detail = 'no service-role key in vault',
           consecutive_failures = coalesce(consecutive_failures, 0) + 1
     where id
    returning * into h;
    raise warning 'story_dispatch_tick: no service-role key in vault; queue is not being dispatched';
    if h.last_reported_at is null or h.last_reported_at < now() - interval '1 hour' then
      insert into public.client_error_reports (user_id, surface, message, detail)
      values (null, 'story-dispatch',
              'the Story dispatcher has no service-role key; the queue is not moving',
              'story_dispatch_service_role_key and email_queue_service_role_key are both absent from the vault');
      update public.story_dispatch_health set last_reported_at = now() where id;
    end if;
    return;
  end if;

  select net.http_post(
    url     := base_url || '/functions/v1/story-dispatch',
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body    := '{}'::jsonb
  ) into req;

  update public.story_dispatch_health
     set request_id = req, sent_at = now()
   where id;
end;
$$;

revoke all on function public.story_dispatch_tick() from public, anon, authenticated;
