-- story_dispatch_tick: an IDLE tick is not a healthy tick.
--
-- THE OUTAGE THIS HID. GITHUB_DISPATCH_TOKEN died between 2026-09-05 14:24 and
-- 2026-09-09 14:50. Two user films sat `queued` for 43 hours. Nobody noticed,
-- because the one table this function's own caller tells you to read first --
-- "WHEN THE STORY QUEUE STOPS MOVING, READ story_dispatch_health FIRST",
-- story-dispatch/index.ts:129 -- reported perfect health throughout.
--
-- WHY, measured 2026-09-11 08:48Z, mid-outage:
--
--     consecutive_failures 0    last_status 200    last_detail null
--     last_ok_at 08:48:00       last_fail_at 08:43:00
--
-- story-dispatch stamps dispatched_at BEFORE its GitHub call and refuses to
-- re-pick a job for DISPATCH_BACKOFF_MS (10 minutes). So during an outage the
-- minute ticks look like this:
--
--     08:52  502  {"error":"github dispatch failed: 401"}   <- counted
--     08:53  502  {"error":"github dispatch failed: 401"}   <- counted
--     08:54  200  {"dispatched":false,"reason":"nothing queued"}  <- WIPED IT
--     ...    200  nine more idle ticks
--
-- Nine idle ticks per two real attempts. The old `ok` test was "2xx and the
-- body has no \"error\"", which an idle body passes, so every failure was
-- erased within a minute or two of being recorded. THE COUNTER COULD NEVER
-- EXCEED 2, and the hourly client_error_reports insert -- gated on the counter
-- incrementing -- fired 39 times in two days for an outage that was continuous.
--
-- THE FIX IS A THIRD STATE, NOT A BETTER PREDICATE. A tick that dispatched
-- nothing made no GitHub call, so it is evidence of neither health nor failure.
-- It clears request_id/sent_at (so the next tick may send) and touches no
-- counter and no timestamp. Only a tick that actually attempted a dispatch may
-- move last_ok_at, last_fail_at, last_status, last_detail or the counter.
--
-- CONSEQUENCE, STATED RATHER THAN DISCOVERED LATER: on a genuinely quiet queue
-- last_ok_at now ages. That is correct and is the point -- it means "no
-- dispatch has been attempted since", which is the true statement. The old
-- behaviour made it mean "this function ran", which nobody needed and which
-- cost two days.
--
-- Reporting only. The dispatch decision, the backoff, the reaper and the
-- vault lookup below are untouched.

create or replace function public.story_dispatch_tick()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  h           public.story_dispatch_health%rowtype;
  resp        record;
  service_key text;
  base_url    text;
  req         bigint;
  ok          boolean;
  idle        boolean;
  detail      text;
  resp_status integer;
begin
  select * into h from public.story_dispatch_health where id;
  if h.request_id is not null then
    select r.status_code, r.content, r.error_msg into resp
      from net._http_response r where r.id = h.request_id;

    if found then
      resp_status := resp.status_code;
      detail := left(coalesce(resp.error_msg, resp.content, ''), 500);
      ok := resp.error_msg is null
        and resp_status between 200 and 299
        and coalesce(resp.content, '') not like '%"error"%'
        and coalesce(resp.content, '') not like '%"configured":false%'
        and coalesce(resp.content, '') not like '%"configured": false%';
      -- A dispatcher that found nothing eligible never called GitHub. It is
      -- neither healthy nor failing, and must not overwrite either record.
      idle := ok and coalesce(resp.content, '') like '%"dispatched":false%';
    elsif h.sent_at is not null and h.sent_at < now() - interval '10 minutes' then
      ok := false;
      idle := false;
      resp_status := null;
      detail := 'no response row within 10 minutes — pg_net pruned it, or the request never completed';
    end if;

    if coalesce(idle, false) then
      update public.story_dispatch_health
         set request_id = null, sent_at = null
       where id;
    elsif ok is not null then
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

  update public.story_jobs
     set status = 'queued',
         dispatched_at = null,
         reaped_count = reaped_count + 1
   where status in ('generating','assembling')
     and updated_at < now() - interval '3 hours'
     and reaped_count < 2;

  update public.story_jobs
     set status = 'failed',
         error = 'reaped: generation died without a callback twice; '
                 || 'giving up rather than burning a runner every three hours'
   where status in ('generating','assembling')
     and updated_at < now() - interval '3 hours'
     and reaped_count >= 2;

  if not exists (select 1 from public.story_jobs where status = 'queued') then
    return;
  end if;

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
$function$;
