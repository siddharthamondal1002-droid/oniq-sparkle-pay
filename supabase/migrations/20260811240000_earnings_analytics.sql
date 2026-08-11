-- ============================================================================
-- EARNINGS ANALYTICS — the numbers behind both dashboards.
--
-- OWNER DIRECTIVE (2026-08-11): "Give dashboard to subscriber, influencer in
-- their model with analytics". Each side gets a per-day series drawn from
-- the same measured ledger the payouts run on (content_views), so what the
-- dashboard charts is exactly what the money follows.
--
-- channel_views_series: the INFLUENCER's chart — views/day for one channel.
--   content_views is already readable by any signed-in user (transparency is
--   the program's marketing); this only aggregates what a client could read
--   row-by-row, without shipping a million rows to a phone.
-- viewer_views_series: the SUBSCRIBER's chart — their own watching per day,
--   auth-scoped to the caller. Nobody can chart somebody else's habits.
-- ============================================================================
create or replace function public.channel_views_series(_channel_id uuid, _days int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with span as (
    select greatest(1, least(coalesce(_days, 30), 90)) as days
  )
  select coalesce(
           jsonb_agg(jsonb_build_object('day', d.day, 'views', coalesce(c.n, 0))
                     order by d.day),
           '[]'::jsonb)
    from span,
         generate_series(current_date - (span.days - 1), current_date,
                         interval '1 day') as d(day)
    left join (
      select viewed_on, count(*)::int as n
        from content_views, span
       where channel_id = _channel_id
         and viewed_on >= current_date - (span.days - 1)
       group by viewed_on
    ) c on c.viewed_on = d.day::date;
$$;
revoke all on function public.channel_views_series(uuid, int) from public, anon;
grant execute on function public.channel_views_series(uuid, int) to authenticated;

create or replace function public.viewer_views_series(_days int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with span as (
    select greatest(1, least(coalesce(_days, 30), 90)) as days
  )
  select coalesce(
           jsonb_agg(jsonb_build_object('day', d.day, 'views', coalesce(c.n, 0))
                     order by d.day),
           '[]'::jsonb)
    from span,
         generate_series(current_date - (span.days - 1), current_date,
                         interval '1 day') as d(day)
    left join (
      select viewed_on, count(*)::int as n
        from content_views, span
       where viewer_id = auth.uid()
         and viewed_on >= current_date - (span.days - 1)
       group by viewed_on
    ) c on c.viewed_on = d.day::date;
$$;
revoke all on function public.viewer_views_series(int) from public, anon;
grant execute on function public.viewer_views_series(int) to authenticated;
