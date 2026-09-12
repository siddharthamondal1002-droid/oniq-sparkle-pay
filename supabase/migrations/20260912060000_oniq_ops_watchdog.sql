-- ONIQ ops watchdog — the join between "something is wrong" and "someone knows".
--
-- WHY THIS EXISTS, measured rather than asserted. GITHUB_DISPATCH_TOKEN died
-- between 2026-09-05 14:24 and 2026-09-09 14:50. `story-dispatch-heartbeat` kept
-- firing every minute throughout. The failures were written to
-- `client_error_reports` the whole time. `send-push` was deployed and delivering
-- to 48 registered devices. NOTHING JOINED THEM, so the owner found out by
-- trying to make a film on 11 Sep. Every piece already existed; the join did not.
--
-- WHAT THE THRESHOLDS ARE NOT: VOLUME. Measured over 30 days of
-- `client_error_reports` on 2026-09-12:
--
--     surface           worst hour   30d total   hours with any
--     chat-viewport         19          116           31
--     send-push             16           56           22
--     share-video           11           45           17
--     story-dispatch         1           42           42    <- the total outage
--
-- The real outage NEVER EXCEEDED ONE REPORT PER HOUR, because
-- `story_dispatch_tick()` throttles its own self-report to once an hour via
-- `last_reported_at`. Any volume threshold high enough to ignore chat-viewport's
-- 19/hour would have slept through six days of video being completely dead —
-- which is the same inversion the §22 benchmark baseline makes when it ranks
-- `send-push` as the loudest surface. So NO SIGNAL HERE COUNTS ERROR REPORTS.
-- Each one reads a server-side fact where "dead" is unambiguous.
--
-- Persistence was measured too and rejected as a primary signal: the longest
-- unbroken run of hours-with-a-report is 13 for story-dispatch against 9 for
-- chat-viewport. A threshold in that gap is fitted to one incident, not derived.

-- ---------------------------------------------------------------------------
-- 1. THE LEDGER. One open row per signal; the row IS the dedup state.
-- ---------------------------------------------------------------------------
create table if not exists public.ops_alerts (
  id                   bigserial primary key,
  signal               text        not null,
  severity             smallint    not null check (severity in (1, 2)),
  summary              text        not null,
  detail               jsonb       not null default '{}'::jsonb,
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  notified_at          timestamptz,
  resolved_at          timestamptz,
  resolved_notified_at timestamptz
);

-- THE DEDUP IS AN INDEX, NOT A CONVENTION. A watchdog that inserts a row per
-- tick is a watchdog nobody reads: at */5 that is 288 rows a day per fault.
create unique index if not exists ops_alerts_one_open_per_signal
  on public.ops_alerts (signal) where resolved_at is null;

create index if not exists ops_alerts_open_first
  on public.ops_alerts (resolved_at nulls first, last_seen_at desc);

alter table public.ops_alerts enable row level security;

-- Admins may READ. Every write is the service role, because a client that could
-- insert here could manufacture an alert, and one that could update could mark
-- a live outage notified.
drop policy if exists ops_alerts_admin_select on public.ops_alerts;
create policy ops_alerts_admin_select on public.ops_alerts
  for select to authenticated using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. THE WATCHDOG'S OWN LIVENESS. Same singleton shape as
--    story_dispatch_health, deliberately: a watchdog that stops running is the
--    one fault it can never report, so its last run has to be readable from
--    outside. There is NO exception handler in the tick below — if it throws,
--    pg_cron records it in cron.job_run_details AND last_run_at stops
--    advancing, which is the detectable signal. Swallowing the error would
--    leave a watchdog that looks alive and sees nothing.
-- ---------------------------------------------------------------------------
create table if not exists public.ops_watch_health (
  id           boolean primary key default true check (id),
  last_run_at  timestamptz,
  last_open    integer not null default 0,
  last_notify_request_id bigint
);
insert into public.ops_watch_health (id) values (true) on conflict (id) do nothing;

alter table public.ops_watch_health enable row level security;
drop policy if exists ops_watch_health_admin_select on public.ops_watch_health;
create policy ops_watch_health_admin_select on public.ops_watch_health
  for select to authenticated using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 3a. THE KEY IS CHOSEN BY SHAPE, NOT BY NAME — and this is the defect the
--     end-to-end test caught, which reading could not have.
--
--     `story_dispatch_tick()` prefers `story_dispatch_service_role_key`, and on
--     this project that secret is NOT a JWT. `ops-alert` admits the cron by
--     reading the `role` claim, so that pairing answers 401. Measured
--     2026-09-12, both arms:
--
--       opaque key -> 401 {"error":"Unauthorized"}
--       JWT key    -> 200 {"caller":"cron","sent":0,"reason":"nothing pending"}
--
--     Copying the existing tick's key preference would therefore have produced
--     a watchdog that DETECTS FOR EVER AND ANNOUNCES NEVER — the exact failure
--     this whole file exists to prevent, inside the thing built to prevent it.
--     It was found by calling the endpoint, not by reading either side.
--
--     THE STATED LIMIT: this depends on a JWT-shaped service key existing in
--     the vault. If none does the tick raises a warning and `notified_at` stays
--     NULL, so the failure is visible and no alert is lost — but nothing is
--     delivered. Making `ops-alert` also accept the project's opaque service
--     key is the belt-and-braces fix and is deliberately NOT built here: the
--     path works today, and speculative hardening of a solved problem is how
--     unreachable code gets written.
-- ---------------------------------------------------------------------------
create or replace function public.ops_watch_pick_key()
returns text
language sql
security definer
set search_path to 'public'
as $function$
  select decrypted_secret from vault.decrypted_secrets
   where name in ('story_dispatch_service_role_key','email_queue_service_role_key')
     and starts_with(decrypted_secret, 'eyJ')
   order by case name when 'email_queue_service_role_key' then 0 else 1 end
   limit 1;
$function$;

revoke all on function public.ops_watch_pick_key() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE DETECTOR. Reads only; it may open, refresh and resolve alerts and it
--    may queue one notification. It never touches a story job, a wallet, a
--    config row or anything a person can see. $0 — no model call anywhere.
-- ---------------------------------------------------------------------------
create or replace function public.ops_watch_tick()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- THREE CONSTANTS, EACH DERIVED FROM SOMETHING MEASURED.
  --
  -- 3 consecutive failures: `story-dispatch-heartbeat` runs EVERY MINUTE, so
  -- three in a row is three minutes of continuous failure. It is read off the
  -- cron cadence, not chosen. During the September outage this counter ran into
  -- the hundreds.
  k_dispatch_fails constant integer  := 3;
  -- 3 hours: HALF of story-sweep's QUEUED_ABANDONED_TTL_MS (6h), which was
  -- itself set at 5.5x the measured worst real created_at -> dispatched_at wait
  -- of 65.1 minutes over 117 films. Alerting at half of it means the owner
  -- hears BEFORE ONIQ gives up on the film, not after.
  k_stalled        constant interval := interval '3 hours';
  -- 80% of a daily ceiling. The owner set $100/day for TEXT on 2026-09-11; the
  -- point of the alert is to arrive while there is still headroom to act.
  k_spend_fraction constant numeric  := 0.80;
  -- A still-open severity-1 alert is re-announced daily. Silence on day two of
  -- an outage reads identically to "it was fixed".
  k_renotify       constant interval := interval '24 hours';

  obs        jsonb := '[]'::jsonb;
  o          jsonb;
  sig        text;
  v_fails    integer;
  v_last_ok  timestamptz;
  v_detail   text;
  v_stuck    integer;
  v_oldest   timestamptz;
  r          record;
  opened     integer := 0;
  refreshed  integer := 0;
  resolved   integer := 0;
  pending    integer := 0;
  v_open     integer := 0;
  v_key      text;
  v_url      text;
  v_req      bigint;
begin
  -- TWO TICKS MUST NOT INTERLEAVE. The dedup is a partial unique index, so a
  -- manual call landing beside a cron call would raise a unique violation and
  -- take the whole tick down — on exactly the busy minute an alert is opening.
  -- Serialise instead; the lock is released with the transaction.
  perform pg_advisory_xact_lock(hashtext('ops_watch_tick'));

  -- SIGNAL 1 — the dispatcher cannot reach GitHub. This is the September
  -- outage's own counter, and it is exact: the dispatcher itself decides
  -- whether a call succeeded, so there is no threshold to tune against noise.
  select coalesce(h.consecutive_failures, 0), h.last_ok_at, h.last_detail
    into v_fails, v_last_ok, v_detail
    from public.story_dispatch_health h where h.id;

  obs := obs || jsonb_build_object(
    'signal',   'dispatch_down',
    'severity', 1,
    'firing',   coalesce(v_fails, 0) >= k_dispatch_fails,
    'summary',  'Films are not reaching the renderer — the dispatcher has failed '
                || coalesce(v_fails, 0) || ' times in a row.',
    'detail',   jsonb_build_object(
                  'consecutive_failures', coalesce(v_fails, 0),
                  'last_ok_at',           v_last_ok,
                  'last_detail',          left(coalesce(v_detail, ''), 300))
  );

  -- SIGNAL 2 — films queued long past any real wait. Catches the case where
  -- dispatch reports success and no runner ever claims the row, which
  -- consecutive_failures cannot see.
  select count(*), min(j.created_at) into v_stuck, v_oldest
    from public.story_jobs j
   where j.status = 'queued' and j.created_at < now() - k_stalled;

  obs := obs || jsonb_build_object(
    'signal',   'render_stalled',
    'severity', 1,
    'firing',   coalesce(v_stuck, 0) > 0,
    'summary',  coalesce(v_stuck, 0) || ' film(s) have been queued for over '
                || extract(hour from k_stalled) || ' hours with nothing rendering them.',
    'detail',   jsonb_build_object('queued_beyond_window', coalesce(v_stuck, 0),
                                   'oldest_created_at',    v_oldest)
  );

  -- SIGNAL 3 — a provider ceiling about to refuse. One signal per capability,
  -- so TEXT running out cannot hide behind MUSIC being idle.
  for r in
    select c.capability,
           c.daily_usd_cap,
           coalesce(d.reserved_usd, 0) + coalesce(d.settled_usd, 0) as used
      from public.provider_budget_config c
      left join public.provider_spend_day d
        on d.capability = c.capability and d.day = (now() at time zone 'utc')::date
     where c.enabled and c.daily_usd_cap > 0
  loop
    obs := obs || jsonb_build_object(
      'signal',   'spend_ceiling:' || r.capability,
      'severity', 2,
      'firing',   r.used >= r.daily_usd_cap * k_spend_fraction,
      'summary',  r.capability || ' has used $' || round(r.used, 4)
                  || ' of its $' || round(r.daily_usd_cap, 2) || ' daily ceiling.',
      'detail',   jsonb_build_object('capability', r.capability,
                                     'used_usd',   round(r.used, 6),
                                     'cap_usd',    round(r.daily_usd_cap, 2))
    );
  end loop;

  -- APPLY. Open what is newly firing, refresh what still is, resolve what
  -- stopped. A signal that stops firing is resolved rather than deleted: the
  -- row is the record that it happened, and `resolved_notified_at` is what
  -- lets the owner be told it recovered.
  for o in select value from jsonb_array_elements(obs) loop
    sig := o->>'signal';

    if (o->>'firing')::boolean then
      if exists (select 1 from public.ops_alerts a
                  where a.signal = sig and a.resolved_at is null) then
        update public.ops_alerts
           set last_seen_at = now(), summary = o->>'summary', detail = o->'detail'
         where signal = sig and resolved_at is null;
        refreshed := refreshed + 1;
      else
        insert into public.ops_alerts (signal, severity, summary, detail)
        values (sig, (o->>'severity')::smallint, o->>'summary', o->'detail');
        opened := opened + 1;
      end if;
    else
      update public.ops_alerts set resolved_at = now()
       where signal = sig and resolved_at is null;
      if found then resolved := resolved + 1; end if;
    end if;
  end loop;

  select count(*) into v_open from public.ops_alerts where resolved_at is null;

  -- WHAT STILL NEEDS SAYING: anything open and never announced, any severity-1
  -- outage still open a day later, and any recovery not yet announced.
  select count(*) into pending
    from public.ops_alerts a
   where (a.resolved_at is null
          and (a.notified_at is null
               or (a.severity = 1 and a.notified_at < now() - k_renotify)))
      or (a.resolved_at is not null and a.notified_at is not null
          and a.resolved_notified_at is null);

  -- DELIVERY IS A SEPARATE CONCERN AND MAY FAIL WITHOUT LOSING THE ALERT.
  -- The row is already committed with notified_at NULL; if the key is absent or
  -- the post fails, the next tick tries again. The vault lookup is the same one
  -- story_dispatch_tick() uses — this function holds no credential of its own.
  if pending > 0 then
    -- BY SHAPE, NOT BY NAME. See ops_watch_pick_key() above.
    v_key := public.ops_watch_pick_key();
    select decrypted_secret into v_url from vault.decrypted_secrets
      where name = 'project_url' limit 1;
    v_url := coalesce(v_url, 'https://bqwttemnnoexadpwifcj.supabase.co');

    if v_key is not null then
      select net.http_post(
        url     := v_url || '/functions/v1/ops-alert',
        headers := jsonb_build_object('content-type', 'application/json',
                                      'Authorization', 'Bearer ' || v_key),
        body    := '{}'::jsonb
      ) into v_req;
    else
      raise warning 'ops_watch_tick: no verifiable service key in vault; % alert(s) undelivered', pending;
    end if;
  end if;

  update public.ops_watch_health
     set last_run_at = now(), last_open = v_open,
         last_notify_request_id = coalesce(v_req, last_notify_request_id)
   where id;

  return jsonb_build_object('observed', jsonb_array_length(obs), 'opened', opened,
                            'refreshed', refreshed, 'resolved', resolved,
                            'open_now', v_open, 'pending_notify', pending);
end;
$function$;

revoke all on function public.ops_watch_tick() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE SCHEDULE. Every five minutes, not every minute: the dispatch signal
--    needs three consecutive failures and the dispatcher runs once a minute,
--    so worst-case detection is ~8 minutes while the watchdog itself costs a
--    twelfth of the load. pg_cron already runs four jobs on this project;
--    this is the fifth and it is the only one that writes no user-facing row.
-- ---------------------------------------------------------------------------
select cron.schedule('ops-watchdog', '*/5 * * * *', 'select public.ops_watch_tick();');
