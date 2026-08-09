-- Stories: user-generated video. Quota claimed atomically, bytes guaranteed to leave.
--
-- The arithmetic behind every default in story_config is derived in
-- src/lib/storyPlan.ts and must not be re-derived here. This file owns the two
-- things TypeScript cannot own:
--
--   1. ATOMICITY. checkStoryQuota() is a pure function over numbers someone
--      read a moment ago. Two taps a millisecond apart both read the same
--      remaining balance and both pass. claim_story_seconds() takes the row
--      locks, so the second one loses.
--   2. THE LIFECYCLE FLOOR. story_jobs_guard_transition() rejects an illegal
--      status move at the write. The product promise is that every path ends
--      in `purged`; a promise enforced only in application code is a promise
--      until someone writes a second worker.
--
-- MESSAGES ARE NOT HERE ON PURPOSE. The refusal RPCs return a reason and the
-- numbers; src/lib/storyPlan.ts turns those into the sentence a user reads.
-- Copy duplicated across a migration and a bundle drifts, and the drift is
-- only visible to the user.

-- ---------------------------------------------------------------------------
-- Configuration. One row, flippable without a deploy — the same shape as
-- video_gen_config, and for the same reason: the kill switch has to work at
-- 2am without a build.
-- ---------------------------------------------------------------------------
create table if not exists public.story_config (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  -- Defaults mirror DEFAULT_FREE_SECONDS / DEFAULT_DAILY_SECONDS /
  -- DEFAULT_GLOBAL_DAILY_SECONDS / MIN_STORY_SECONDS / MAX_STORY_SECONDS.
  free_seconds int not null default 300 check (free_seconds >= 0),
  daily_seconds int not null default 120 check (daily_seconds >= 0),
  global_daily_seconds int not null default 3600 check (global_daily_seconds >= 0),
  min_story_seconds int not null default 10 check (min_story_seconds > 0),
  max_story_seconds int not null default 600 check (max_story_seconds >= min_story_seconds),
  updated_at timestamptz not null default now()
);

insert into public.story_config (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Per-user allowance. One row per user, created lazily on first claim.
--
-- A counter row rather than a sum over story_jobs, because the claim has to
-- LOCK the balance it is about to spend and you cannot lock an aggregate.
-- ---------------------------------------------------------------------------
create table if not exists public.story_allowance (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- null means "use the configured default". A per-user override exists so a
  -- grant can be given to one person without moving everybody's tier.
  free_seconds int check (free_seconds is null or free_seconds >= 0),
  used_seconds int not null default 0 check (used_seconds >= 0),
  daily_used_seconds int not null default 0 check (daily_used_seconds >= 0),
  daily_day date not null default (now() at time zone 'utc')::date,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Product-wide daily spend. One row per UTC day.
--
-- The only layer that bounds ABSOLUTE cost: every per-user limit multiplies by
-- signups. Yes, this is a single hot row that every claim serialises on. At an
-- hour of finished video a day that is a few thousand short transactions, and
-- the alternative to serialising is not knowing what the day cost.
-- ---------------------------------------------------------------------------
create table if not exists public.story_global_usage (
  day date primary key,
  used_seconds int not null default 0 check (used_seconds >= 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The jobs themselves.
-- ---------------------------------------------------------------------------
create table if not exists public.story_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (
    status in ('queued','generating','assembling','ready','delivering','delivered','failed','purged')
  ),
  prompt text not null,
  requested_seconds int not null check (requested_seconds > 0),
  -- What the quota was actually debited, which is what a refund gives back.
  -- Separate from requested_seconds so a future partial charge cannot silently
  -- refund more than it took.
  seconds_charged int not null check (seconds_charged >= 0),
  refunded_at timestamptz,
  -- Filled by the worker from planStory(); deliberately NOT computed in SQL,
  -- because a second implementation of the shot planner would drift from the
  -- first one and nobody would notice until a bill arrived.
  shot_count int check (shot_count is null or shot_count > 0),
  render_target text check (render_target is null or render_target in ('edge','ci')),
  storage_path text,
  -- Whether any bytes exist in storage RIGHT NOW. The sweeper asks about this,
  -- not about status: a row marked purged whose delete failed still owes one.
  has_bytes boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists story_jobs_user_created_idx
  on public.story_jobs (user_id, created_at desc);
create index if not exists story_jobs_status_idx on public.story_jobs (status);
-- The sweeper's query: everything still holding bytes, oldest first.
create index if not exists story_jobs_bytes_idx
  on public.story_jobs (updated_at) where has_bytes;

-- ---------------------------------------------------------------------------
-- Row level security. Users read their own jobs and their own balance and
-- nothing else. Every write goes through an RPC or the service role.
-- ---------------------------------------------------------------------------
alter table public.story_config enable row level security;
alter table public.story_allowance enable row level security;
alter table public.story_global_usage enable row level security;
alter table public.story_jobs enable row level security;

grant select on public.story_jobs to authenticated;
grant select on public.story_allowance to authenticated;
grant all on public.story_config to service_role;
grant all on public.story_allowance to service_role;
grant all on public.story_global_usage to service_role;
grant all on public.story_jobs to service_role;

create policy "story_jobs_select_own" on public.story_jobs
  for select to authenticated
  using (user_id = auth.uid());

create policy "story_allowance_select_own" on public.story_allowance
  for select to authenticated
  using (user_id = auth.uid());

-- Config and global spend are operational numbers. A user needs their own
-- balance, which story_quota_status() gives them; they do not need the
-- product's daily ceiling or how much of it is gone.
create policy "story_config_admin_select" on public.story_config
  for select to authenticated
  using (public.is_admin(auth.uid()));

create policy "story_global_usage_admin_select" on public.story_global_usage
  for select to authenticated
  using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Lifecycle guard.
--
-- The pairs below are the same table as ALLOWED in src/lib/storyLifecycle.ts,
-- and storyJobsSchema.test.ts parses this function to prove the two agree. If
-- you add a state, add it in both places or that test fails.
-- ---------------------------------------------------------------------------
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
      ('assembling','ready'),
      ('assembling','failed'),
      ('assembling','purged'),
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

drop trigger if exists story_jobs_guard_transition_trg on public.story_jobs;
create trigger story_jobs_guard_transition_trg
  before update on public.story_jobs
  for each row execute function public.story_jobs_guard_transition();

-- ---------------------------------------------------------------------------
-- claim_story_seconds — the only way a Story is created.
--
-- Refusal order matches checkStoryQuota() exactly: kill switch, then the
-- product-wide ceiling, then the user's lifetime allowance, then their day,
-- then the size of this request. A kill switch checked second is not a kill
-- switch, and telling one user about their personal balance when the whole
-- day's budget is gone answers a question they did not ask.
--
-- LOCK ORDER, everywhere in this file: global day row, then user allowance
-- row. Two orders is how two functions deadlock under exactly the load that
-- made you write them.
-- ---------------------------------------------------------------------------
create or replace function public.claim_story_seconds(_requested_seconds int, _prompt text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.story_config%rowtype;
  today date := (now() at time zone 'utc')::date;
  prompt_clean text;
  wanted int;
  global_used int;
  a_free int;
  a_used int;
  a_daily_used int;
  a_daily_day date;
  free_cap int;
  remaining int;
  daily_left int;
  job_id uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;

  prompt_clean := trim(coalesce(_prompt, ''));
  if length(prompt_clean) = 0 then raise exception 'prompt required'; end if;
  if length(prompt_clean) > 2000 then raise exception 'prompt too long'; end if;

  select * into cfg from story_config where id = true;
  if not found then raise exception 'story config missing'; end if;

  -- Kill switch before any lock. It cannot race with anything and it is the
  -- cheapest refusal there is.
  if not cfg.enabled then
    return jsonb_build_object('ok', false, 'reason', 'disabled',
                              'remaining', 0, 'dailyLeft', 0, 'wanted', 0);
  end if;

  -- Clamp rather than reject, so the server and planStory() agree on what a
  -- silly number means. The client never gets to name the length that gets
  -- billed — this value does.
  wanted := greatest(cfg.min_story_seconds,
                     least(cfg.max_story_seconds, coalesce(_requested_seconds, 0)));

  insert into story_global_usage (day) values (today) on conflict (day) do nothing;
  select used_seconds into global_used from story_global_usage where day = today for update;

  insert into story_allowance (user_id) values (me) on conflict (user_id) do nothing;
  select free_seconds, used_seconds, daily_used_seconds, daily_day
    into a_free, a_used, a_daily_used, a_daily_day
    from story_allowance where user_id = me for update;

  -- A new UTC day resets the per-user counter. Done in memory here and written
  -- back below, so a user who does not return simply never rolls over.
  if a_daily_day <> today then
    a_daily_used := 0;
  end if;

  free_cap := coalesce(a_free, cfg.free_seconds);
  remaining := greatest(0, free_cap - a_used);
  daily_left := greatest(0, cfg.daily_seconds - a_daily_used);

  if global_used + wanted > cfg.global_daily_seconds then
    return jsonb_build_object('ok', false, 'reason', 'capacity',
                              'remaining', remaining, 'dailyLeft', daily_left, 'wanted', wanted);
  end if;
  if remaining <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'exhausted',
                              'remaining', 0, 'dailyLeft', daily_left, 'wanted', wanted);
  end if;
  if wanted > daily_left then
    return jsonb_build_object('ok', false, 'reason', 'daily',
                              'remaining', remaining, 'dailyLeft', daily_left, 'wanted', wanted);
  end if;
  if wanted > remaining then
    return jsonb_build_object('ok', false, 'reason', 'too-long',
                              'remaining', remaining, 'dailyLeft', daily_left, 'wanted', wanted);
  end if;

  update story_global_usage
     set used_seconds = used_seconds + wanted, updated_at = now()
   where day = today;

  update story_allowance
     set used_seconds = used_seconds + wanted,
         daily_used_seconds = a_daily_used + wanted,
         daily_day = today,
         updated_at = now()
   where user_id = me;

  insert into story_jobs (user_id, prompt, requested_seconds, seconds_charged)
  values (me, prompt_clean, wanted, wanted)
  returning id into job_id;

  return jsonb_build_object(
    'ok', true,
    'jobId', job_id,
    'seconds', wanted,
    'remaining', remaining - wanted,
    'dailyLeft', daily_left - wanted
  );
end;
$$;

revoke all on function public.claim_story_seconds(int, text) from public, anon;
grant execute on function public.claim_story_seconds(int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- refund_story_seconds — give back what a failed job took.
--
-- Counters only. It does NOT move the job's status, because the legal move
-- depends on where the job is and the trigger above owns that question; a
-- refund that also tried to set 'failed' would throw on an already-purged job
-- and the seconds would stay spent.
--
-- Idempotent via refunded_at. Refunds land on the day the job was CHARGED, so
-- a job that fails after midnight does not hand today's budget free capacity.
-- Service role only: nothing a user does should be able to credit an account.
-- ---------------------------------------------------------------------------
create or replace function public.refund_story_seconds(_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.story_jobs%rowtype;
  charged_day date;
begin
  select * into job from story_jobs where id = _job_id for update;
  if not found then raise exception 'story job not found'; end if;
  if job.refunded_at is not null then
    return jsonb_build_object('ok', true, 'refunded', 0);
  end if;
  if job.seconds_charged = 0 then
    update story_jobs set refunded_at = now() where id = _job_id;
    return jsonb_build_object('ok', true, 'refunded', 0);
  end if;

  charged_day := (job.created_at at time zone 'utc')::date;

  -- Same lock order as the claim: global first, then the user.
  update story_global_usage
     set used_seconds = greatest(0, used_seconds - job.seconds_charged), updated_at = now()
   where day = charged_day;

  update story_allowance
     set used_seconds = greatest(0, used_seconds - job.seconds_charged),
         -- Only credit the day counter if the user is still ON that day.
         -- Crediting a fresh day would hand them extra time they never spent.
         daily_used_seconds = case
           when daily_day = charged_day
             then greatest(0, daily_used_seconds - job.seconds_charged)
           else daily_used_seconds
         end,
         updated_at = now()
   where user_id = job.user_id;

  update story_jobs set refunded_at = now() where id = _job_id;

  return jsonb_build_object('ok', true, 'refunded', job.seconds_charged);
end;
$$;

revoke all on function public.refund_story_seconds(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- story_quota_status — what a screen may know before the user taps generate.
--
-- Their own numbers plus whether the feature is on. Deliberately NOT the
-- product-wide ceiling or how much of today is gone: a user cannot act on it,
-- and "busy today" is the honest thing to say when it runs out.
-- ---------------------------------------------------------------------------
create or replace function public.story_quota_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.story_config%rowtype;
  today date := (now() at time zone 'utc')::date;
  a_free int;
  a_used int;
  a_daily_used int;
  a_daily_day date;
  free_cap int;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into cfg from story_config where id = true;
  if not found then raise exception 'story config missing'; end if;

  select free_seconds, used_seconds, daily_used_seconds, daily_day
    into a_free, a_used, a_daily_used, a_daily_day
    from story_allowance where user_id = me;

  if not found then
    a_free := null; a_used := 0; a_daily_used := 0; a_daily_day := today;
  end if;
  if a_daily_day <> today then a_daily_used := 0; end if;

  free_cap := coalesce(a_free, cfg.free_seconds);

  return jsonb_build_object(
    'enabled', cfg.enabled,
    'freeSeconds', free_cap,
    'usedSeconds', a_used,
    'remaining', greatest(0, free_cap - a_used),
    'dailyLeft', greatest(0, cfg.daily_seconds - a_daily_used),
    'minSeconds', cfg.min_story_seconds,
    'maxSeconds', cfg.max_story_seconds
  );
end;
$$;

revoke all on function public.story_quota_status() from public, anon;
grant execute on function public.story_quota_status() to authenticated;
