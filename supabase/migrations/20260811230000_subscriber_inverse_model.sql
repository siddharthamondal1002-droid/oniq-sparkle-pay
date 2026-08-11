-- ============================================================================
-- THE INVERSE MODEL — subscribers qualify by watching, mirroring how
-- creators qualify by producing.
--
-- OWNER DIRECTIVE (2026-08-11): "Keep a inverse model for the subscribers
-- to qualify". The creator's bar counts what they PRODUCED (50 videos
-- posted, 10,000 subscribers, 1,000,000 views received, 14 days of channel
-- age). The subscriber's bar is the same shape pointed the other way — what
-- they CONSUMED: subscribed to the channel, 50 distinct videos of it
-- watched (all time, measured content_views), and 14 days of membership.
-- Casual drive-by viewers no longer collect the 10% share; the people who
-- actually sustain a channel do.
--
-- An unknown join date counts as "joined just now" — the conservative
-- reading, since tenure is an anti-abuse bar.
-- ============================================================================
alter table public.creator_program_config
  add column if not exists sub_min_watched_videos int not null default 50
    check (sub_min_watched_videos >= 0),
  add column if not exists sub_min_member_days int not null default 14
    check (sub_min_member_days >= 0);
update public.creator_program_config
   set sub_min_watched_videos = 50, sub_min_member_days = 14, updated_at = now()
 where id = true;

-- The member's own road-to-earning — the inverse of channel_monetize_status.
-- Auth-scoped: it answers only for the caller, about one channel.
create or replace function public.subscriber_earn_status(_channel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg creator_program_config%rowtype;
  joined timestamptz;
  found_member boolean := false;
  watched int := 0;
  member_days int := 0;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into cfg from creator_program_config where id = true;
  if not found then raise exception 'creator program config missing'; end if;

  select m.joined_at into joined
    from conversation_members m
   where m.conversation_id = _channel_id and m.user_id = me;
  found_member := found;

  if found_member then
    select count(distinct cv.message_id)::int into watched
      from content_views cv
     where cv.channel_id = _channel_id and cv.viewer_id = me;
    member_days := greatest(0, extract(day from now() - coalesce(joined, now())))::int;
  end if;

  return jsonb_build_object(
    'ok', true,
    'member', found_member,
    'qualified', found_member
             and watched >= cfg.sub_min_watched_videos
             and member_days >= cfg.sub_min_member_days,
    'watchedVideos', watched, 'minWatchedVideos', cfg.sub_min_watched_videos,
    'memberDays', member_days, 'minMemberDays', cfg.sub_min_member_days
  );
end;
$$;
revoke all on function public.subscriber_earn_status(uuid) from public, anon;
grant execute on function public.subscriber_earn_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- THE RUN, v3: identical to v2 except the subscriber legs go only to
-- viewers who pass the inverse bar. The share still splits equally among
-- eligible watchers; what changed is who counts as one.
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
  run_id uuid;
  total_points bigint := 0;
  distributed int := 0;
  chans int := 0;
  ch record;
  alloc int;
  creator_amt int;
  sub_total int;
  sub_paid int;
  viewer_cnt int;
  per_viewer int;
  oniq_amt int;
begin
  select * into cfg from creator_program_config where id = true;
  if not found then raise exception 'creator program config missing'; end if;
  if cfg.enabled is not true then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  pool := coalesce(_pool_paise, cfg.period_pool_paise);
  if pool is null or pool <= 0 then
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

    -- The INVERSE BAR: a subscriber leg requires (a) watched the channel in
    -- the last 30 days, (b) current member for >= sub_min_member_days
    -- (unknown join date = joined now), (c) >= sub_min_watched_videos
    -- distinct videos of this channel watched all-time. Both the count and
    -- the insert read the same snapshot, so the set cannot drift between.
    select count(*)::int into viewer_cnt
      from (select distinct v.viewer_id
              from content_views v
             where v.channel_id = ch.channel_id
               and v.viewed_on > current_date - 30
               and v.viewer_id <> ch.creator_id) q
      join conversation_members mm
        on mm.conversation_id = ch.channel_id and mm.user_id = q.viewer_id
     where coalesce(mm.joined_at, now())
             <= now() - make_interval(days => cfg.sub_min_member_days)
       and (select count(distinct cv.message_id) from content_views cv
             where cv.channel_id = ch.channel_id and cv.viewer_id = q.viewer_id)
           >= cfg.sub_min_watched_videos;
    sub_paid := 0;
    if viewer_cnt > 0 and sub_total > 0 then
      per_viewer := sub_total / viewer_cnt;
      if per_viewer > 0 then
        insert into payout_queue (run_id, channel_id, recipient_id, kind, amount_paise)
        select run_id, ch.channel_id, q.viewer_id, 'subscriber', per_viewer
          from (select distinct v.viewer_id
                  from content_views v
                 where v.channel_id = ch.channel_id
                   and v.viewed_on > current_date - 30
                   and v.viewer_id <> ch.creator_id) q
          join conversation_members mm
            on mm.conversation_id = ch.channel_id and mm.user_id = q.viewer_id
         where coalesce(mm.joined_at, now())
                 <= now() - make_interval(days => cfg.sub_min_member_days)
           and (select count(distinct cv.message_id) from content_views cv
                 where cv.channel_id = ch.channel_id and cv.viewer_id = q.viewer_id)
               >= cfg.sub_min_watched_videos;
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
