-- Creator Program v2 — real views, a real bar, and real money out.
--
-- OWNER DIRECTIVE (2026-08-11): no wallets — Razorpay pays the influencer
-- AND the subscribers directly, at the same moment; the qualification bar
-- rises to 10,000 subscribers and 50 videos; and views become a measured
-- mechanism, not a proxy.
--
-- A NEW FILE, not an edit: the v1 migration may already be applied by the
-- deploy job in flight, and editing an applied migration is how two
-- databases end up describing different histories with the same filename.
-- Everything here is CREATE OR REPLACE / ALTER over v1.
--
-- HOW MONEY LEAVES NOW. run_creator_payouts no longer touches wallets. It
-- writes payout_queue rows — creator leg and subscriber legs together, in
-- the same transaction, which is the "at the same point" of the directive —
-- and the dispatcher (an admin action on the razorpay-order function,
-- because the platform cannot add new edge functions to this project) sends
-- each row through RazorpayX's composite payout API to the recipient's
-- registered UPI ID. No payout method on file → the row waits in
-- 'no_method' where the recipient can see it; money never silently
-- disappears into a balance ONIQ invented.

-- ---------------------------------------------------------------------------
-- VIEWS. One row per viewer per video per day — a refresh is not a view,
-- but coming back tomorrow is. The primary key is the dedupe.
-- ---------------------------------------------------------------------------
create table if not exists public.content_views (
  message_id uuid not null references public.messages(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid not null references public.conversations(id) on delete cascade,
  viewed_on date not null default current_date,
  primary key (message_id, viewer_id, viewed_on)
);
create index if not exists content_views_channel_recent_idx
  on public.content_views (channel_id, viewed_on desc);
grant select on public.content_views to authenticated;
alter table public.content_views enable row level security;
drop policy if exists "views readable" on public.content_views;
create policy "views readable" on public.content_views
  for select to authenticated using (true);
-- Writes go through the RPC: it stamps viewer_id from auth and bounds the
-- batch, neither of which a raw insert policy can promise.

create or replace function public.record_channel_views(
  _channel_id uuid,
  _message_ids uuid[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  n int;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if _message_ids is null or array_length(_message_ids, 1) is null then return 0; end if;
  if array_length(_message_ids, 1) > 50 then
    _message_ids := _message_ids[1:50];
  end if;

  -- Only rows that really are VIDEO posts of THIS channel count — a forged
  -- id from another conversation inserts nothing.
  insert into content_views (message_id, viewer_id, channel_id)
  select m.id, me, _channel_id
    from messages m
   where m.id = any(_message_ids)
     and m.conversation_id = _channel_id
     and m.type = 'video'
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.record_channel_views(uuid, uuid[]) from public, anon;
grant execute on function public.record_channel_views(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- THE BAR RISES: 10,000 subscribers, 50 VIDEOS (not just posts).
-- ---------------------------------------------------------------------------
alter table public.channel_monetize_config
  add column if not exists min_videos int not null default 50 check (min_videos >= 0);
update public.channel_monetize_config
   set min_members = 10000, min_videos = 50, updated_at = now()
 where id = true;

create or replace function public.channel_monetize_status(_channel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg channel_monetize_config%rowtype;
  members int;
  videos int;
  views30 int;
  age_days int;
begin
  select * into cfg from channel_monetize_config where id = true;
  if not found then raise exception 'monetize config missing'; end if;

  select count(*)::int into members
    from conversation_members where conversation_id = _channel_id;
  select count(*)::int into videos
    from messages where conversation_id = _channel_id and type = 'video';
  select count(*)::int into views30
    from content_views
   where channel_id = _channel_id and viewed_on > current_date - 30;
  select greatest(0, extract(day from now() - c.created_at))::int into age_days
    from conversations c where c.id = _channel_id and c.type = 'channel';
  if age_days is null then
    return jsonb_build_object('ok', false, 'reason', 'no-such-channel');
  end if;

  return jsonb_build_object(
    'ok', true,
    'qualified', members >= cfg.min_members
             and videos >= cfg.min_videos
             and age_days >= cfg.min_channel_age_days,
    'members', members, 'minMembers', cfg.min_members,
    'videos', videos, 'minVideos', cfg.min_videos,
    'views30', views30,
    'ageDays', age_days, 'minAgeDays', cfg.min_channel_age_days
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- PAYOUT METHODS. A UPI ID per user — where Razorpay sends their money.
-- ---------------------------------------------------------------------------
create table if not exists public.payout_methods (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  vpa text not null,
  updated_at timestamptz not null default now()
);
grant select on public.payout_methods to authenticated;
alter table public.payout_methods enable row level security;
drop policy if exists "own payout method" on public.payout_methods;
create policy "own payout method" on public.payout_methods
  for select to authenticated using (user_id = auth.uid());

create or replace function public.set_payout_vpa(_vpa text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v text := lower(trim(coalesce(_vpa, '')));
begin
  if me is null then raise exception 'not authenticated'; end if;
  if v !~ '^[a-z0-9][a-z0-9._-]{1,255}@[a-z]{2,64}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad-vpa');
  end if;
  insert into payout_methods (user_id, vpa, updated_at)
  values (me, v, now())
  on conflict (user_id) do update set vpa = excluded.vpa, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_payout_vpa(text) from public, anon;
grant execute on function public.set_payout_vpa(text) to authenticated;

-- ---------------------------------------------------------------------------
-- THE QUEUE. One row per rupee-movement Razorpay must make. Receipts,
-- statuses, and the dispatcher's worklist in one table.
-- ---------------------------------------------------------------------------
create table if not exists public.payout_queue (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.creator_payout_runs(id) on delete cascade,
  channel_id uuid not null references public.conversations(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('creator', 'subscriber')),
  amount_paise int not null check (amount_paise > 0),
  status text not null default 'queued'
    check (status in ('queued', 'no_method', 'paid', 'failed')),
  provider_payout_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payout_queue_status_idx on public.payout_queue (status, created_at);
create index if not exists payout_queue_recipient_idx
  on public.payout_queue (recipient_id, created_at desc);
grant select on public.payout_queue to authenticated;
alter table public.payout_queue enable row level security;
drop policy if exists "own payouts visible" on public.payout_queue;
create policy "own payouts visible" on public.payout_queue
  for select to authenticated using (recipient_id = auth.uid());

-- Service-role: the dispatcher claims a batch (marks nothing paid — payment
-- state only changes on Razorpay's answer, recorded by mark_payout_result).
create or replace function public.claim_payout_batch(_limit int default 20)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', q.id, 'recipientId', q.recipient_id, 'amountPaise', q.amount_paise,
           'kind', q.kind, 'vpa', pm.vpa)
    from payout_queue q
    left join payout_methods pm on pm.user_id = q.recipient_id
   where q.status = 'queued'
   order by q.created_at
   limit greatest(1, least(_limit, 50));
$$;
revoke all on function public.claim_payout_batch(int) from public, anon, authenticated;

create or replace function public.mark_payout_result(
  _id uuid,
  _status text,
  _provider_payout_id text default null,
  _error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update payout_queue
     set status = case when _status in ('paid','failed','no_method') then _status else status end,
         provider_payout_id = coalesce(_provider_payout_id, provider_payout_id),
         error = left(coalesce(_error, error), 300),
         updated_at = now()
   where id = _id and status = 'queued';
$$;
revoke all on function public.mark_payout_result(uuid, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- THE RUN, v2: views-weighted, wallet-free. Engagement = views in the last
-- 30 days (the measured thing), with members as the tiebreaker weight so a
-- large silent channel is not worth zero. The subscriber leg is shared
-- equally among members who actually VIEWED in the window — rewarding the
-- audience that showed up, and keeping 10,000-member equal splits from
-- rounding everyone to nothing.
-- ---------------------------------------------------------------------------
create or replace function public.run_creator_payouts(_pool_paise int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg creator_program_config%rowtype;
  pool int;
  total_points bigint := 0;
  run_id uuid;
  distributed int := 0;
  chans int := 0;
  ch record;
  alloc int;
  creator_amt int;
  sub_total int;
  viewer_cnt int;
  per_viewer int;
  sub_paid int;
  oniq_amt int;
begin
  select * into cfg from creator_program_config where id = true;
  if not found or not cfg.enabled then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  pool := coalesce(_pool_paise, cfg.period_pool_paise);
  if pool <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'no-pool');
  end if;

  create temp table _qualified on commit drop as
  select c.id as channel_id,
         om.user_id as creator_id,
         (select count(*) from content_views v
           where v.channel_id = c.id and v.viewed_on > current_date - 30)::int as views30,
         (select count(*) from conversation_members m
           where m.conversation_id = c.id)::int as members
    from conversations c
    join conversation_members om
      on om.conversation_id = c.id and om.role = 'owner'
   where c.type = 'channel'
     and (channel_monetize_status(c.id)->>'qualified')::boolean;

  -- Views are worth 10x a member: watching is the engagement, membership is
  -- the reach. Both integers, so the weighting is auditable arithmetic.
  select coalesce(sum(views30::bigint * 10 + members), 0) into total_points from _qualified;
  if total_points = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no-qualified-channels');
  end if;

  insert into creator_payout_runs (pool_paise) values (pool) returning id into run_id;

  for ch in select * from _qualified loop
    alloc := ((pool::bigint * (ch.views30::bigint * 10 + ch.members)) / total_points)::int;
    if alloc <= 0 then continue; end if;

    creator_amt := (alloc * cfg.creator_pct) / 100;
    sub_total := (alloc * cfg.subscriber_pct) / 100;

    -- Creator leg and subscriber legs queue IN THE SAME TRANSACTION — the
    -- "at the same point" of the directive. Dispatch pays them together.
    if creator_amt > 0 then
      insert into payout_queue (run_id, channel_id, recipient_id, kind, amount_paise)
      values (run_id, ch.channel_id, ch.creator_id, 'creator', creator_amt);
    end if;

    select count(distinct v.viewer_id)::int into viewer_cnt
      from content_views v
     where v.channel_id = ch.channel_id
       and v.viewed_on > current_date - 30
       and v.viewer_id <> ch.creator_id;
    sub_paid := 0;
    if viewer_cnt > 0 and sub_total > 0 then
      per_viewer := sub_total / viewer_cnt;
      if per_viewer > 0 then
        insert into payout_queue (run_id, channel_id, recipient_id, kind, amount_paise)
        select run_id, ch.channel_id, v.viewer_id, 'subscriber', per_viewer
          from (select distinct viewer_id from content_views
                 where channel_id = ch.channel_id
                   and viewed_on > current_date - 30
                   and viewer_id <> ch.creator_id) v;
        sub_paid := per_viewer * viewer_cnt;
      end if;
    end if;

    oniq_amt := alloc - creator_amt - sub_paid;

    insert into creator_payouts
      (run_id, channel_id, creator_id, engagement_points, allocation_paise,
       creator_paise, subscriber_paise, subscriber_count, oniq_paise)
    values
      (run_id, ch.channel_id, ch.creator_id,
       (ch.views30::bigint * 10 + ch.members)::int, alloc,
       creator_amt, sub_paid, viewer_cnt, oniq_amt);

    distributed := distributed + alloc;
    chans := chans + 1;
  end loop;

  update creator_payout_runs
     set distributed_paise = distributed, channels = chans
   where id = run_id;

  return jsonb_build_object('ok', true, 'runId', run_id,
                            'channels', chans, 'distributedPaise', distributed,
                            'queued', true);
end;
$$;
revoke all on function public.run_creator_payouts(int) from public, anon, authenticated;
