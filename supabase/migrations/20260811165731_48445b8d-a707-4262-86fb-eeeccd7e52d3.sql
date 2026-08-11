-- Movie-grade pricing — the chart learns a second pipeline, without selling it.
alter table public.story_price_tiers
  add column if not exists grade text not null default 'classic'
    check (grade in ('classic', 'movie'));

alter table public.story_price_tiers drop constraint if exists story_price_tiers_pkey;
alter table public.story_price_tiers add primary key (seconds, grade);

insert into public.story_price_tiers (seconds, label, price_paise, sort_order, grade, active) values
  (30,  '30 seconds — movie', 99900,  6,  'movie', false),
  (60,  '1 minute — movie',   189900, 7,  'movie', false),
  (120, '2 minutes — movie',  349900, 8,  'movie', false),
  (180, '3 minutes — movie',  499900, 9,  'movie', false),
  (300, '5 minutes — movie',  799900, 10, 'movie', false)
on conflict (seconds, grade) do nothing;

alter table public.story_purchases
  add column if not exists grade text not null default 'classic'
    check (grade in ('classic', 'movie'));

drop function if exists public.create_story_purchase(int, text);

create or replace function public.create_story_purchase(
  _seconds int,
  _origin text default 'web',
  _grade text default 'classic'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  tier public.story_price_tiers%rowtype;
  cfg public.story_purchase_config%rowtype;
  new_id uuid;
  origin_clean text;
  grade_clean text;
begin
  if me is null then raise exception 'not authenticated'; end if;

  select * into cfg from story_purchase_config where id = true;
  if not found or not cfg.enabled then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  grade_clean := case when _grade in ('classic', 'movie') then _grade else null end;
  if grade_clean is null then
    return jsonb_build_object('ok', false, 'reason', 'no-such-grade');
  end if;

  select * into tier
    from story_price_tiers
   where seconds = _seconds and grade = grade_clean and active;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no-such-tier');
  end if;

  origin_clean := case when _origin = 'native-handoff' then 'native-handoff' else 'web' end;

  insert into story_purchases (user_id, seconds, price_paise, currency, origin, grade)
  values (me, tier.seconds, tier.price_paise, tier.currency, origin_clean, grade_clean)
  returning id into new_id;

  return jsonb_build_object(
    'ok', true,
    'purchaseId', new_id,
    'seconds', tier.seconds,
    'label', tier.label,
    'amountMinor', tier.price_paise,
    'currency', tier.currency,
    'grade', grade_clean
  );
end;
$$;

revoke all on function public.create_story_purchase(int, text, text) from public, anon;
grant execute on function public.create_story_purchase(int, text, text) to authenticated;