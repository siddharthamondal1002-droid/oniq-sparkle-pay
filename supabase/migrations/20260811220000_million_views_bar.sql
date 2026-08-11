-- ============================================================================
-- THE BAR RISES AGAIN — 1,000,000 total video views to monetize.
--
-- OWNER DIRECTIVE (2026-08-11): "1 million views total of videos". Alongside
-- 10,000 subscribers, 50 videos and 14 days of age, a channel must have
-- accumulated one million MEASURED views (content_views rows — one per
-- viewer per video per day, all time) before it earns from the pool.
--
-- Only channel_monetize_status needs to change: run_creator_payouts asks it
-- "qualified?" per channel, so the stricter answer flows into payout runs
-- without touching the run itself.
-- ============================================================================
alter table public.channel_monetize_config
  add column if not exists min_total_views bigint not null default 1000000
    check (min_total_views >= 0);
update public.channel_monetize_config
   set min_total_views = 1000000, updated_at = now()
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
  views_total bigint;
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
  select count(*)::bigint into views_total
    from content_views where channel_id = _channel_id;
  select greatest(0, extract(day from now() - c.created_at))::int into age_days
    from conversations c where c.id = _channel_id and c.type = 'channel';
  if age_days is null then
    return jsonb_build_object('ok', false, 'reason', 'no-such-channel');
  end if;

  return jsonb_build_object(
    'ok', true,
    'qualified', members >= cfg.min_members
             and videos >= cfg.min_videos
             and views_total >= cfg.min_total_views
             and age_days >= cfg.min_channel_age_days,
    'members', members, 'minMembers', cfg.min_members,
    'videos', videos, 'minVideos', cfg.min_videos,
    'views30', views30,
    'viewsTotal', views_total, 'minViewsTotal', cfg.min_total_views,
    'ageDays', age_days, 'minAgeDays', cfg.min_channel_age_days
  );
end;
$$;
