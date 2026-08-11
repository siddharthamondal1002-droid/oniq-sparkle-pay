-- Movie-grade pricing — the chart learns a second pipeline, without selling it.
--
-- THE NUMBER THAT FORCED THIS. A classic Story (stills + narration under Ken
-- Burns) costs roughly ₹35 of generation per finished minute — 8.7 stills at
-- ~$0.039 plus TTS. A MOVIE Story (one ~10s generated video clip per shot,
-- the Aladdin pipeline) adds sixty output-seconds of video per finished
-- minute at Veo list pricing of $0.15/s: about ₹790/minute of COGS, roughly
-- 10x classic, before margin. The ₹99/minute classic chart cannot carry that;
-- movie needs its own rows. src/lib/storyCostModel.ts holds this arithmetic
-- as code with a CI margin-floor test.
--
-- SOLD NOTHING YET, ON PURPOSE. The clip render stage does not exist, and a
-- price for an undeliverable product is a refund waiting to happen. The movie
-- rows land `active = false`; create_story_purchase already refuses inactive
-- tiers, so nothing is buyable until the stage ships and the rows are flipped
-- — an UPDATE, live immediately, no deploy, exactly why prices live in this
-- table.
--
-- GRADE JOINS THE KEY. `seconds` alone can no longer identify a tier when two
-- grades sell the same durations. The primary key becomes (seconds, grade);
-- create_story_purchase gains `_grade text default 'classic'`, so every
-- existing caller keeps working unchanged and a movie purchase is an explicit
-- opt-in. The purchase row records the grade for the same reason it records
-- the price: the receipt describes the product.

alter table public.story_price_tiers
  add column if not exists grade text not null default 'classic'
    check (grade in ('classic', 'movie'));

-- Rebuild the key around (seconds, grade). Postgres cannot alter a PK in
-- place; drop and re-add inside the one transaction this migration runs in.
alter table public.story_price_tiers drop constraint if exists story_price_tiers_pkey;
alter table public.story_price_tiers add primary key (seconds, grade);

-- The movie chart, priced from the cost model, INACTIVE until the clip stage
-- ships. Sort orders continue after the classic chart's 1-5.
insert into public.story_price_tiers (seconds, label, price_paise, sort_order, grade, active) values
  (30,  '30 seconds — movie', 99900,  6,  'movie', false),
  (60,  '1 minute — movie',   189900, 7,  'movie', false),
  (120, '2 minutes — movie',  349900, 8,  'movie', false),
  (180, '3 minutes — movie',  499900, 9,  'movie', false),
  (300, '5 minutes — movie',  799900, 10, 'movie', false)
on conflict (seconds, grade) do nothing;

-- The receipt records what was bought.
alter table public.story_purchases
  add column if not exists grade text not null default 'classic'
    check (grade in ('classic', 'movie'));

-- Extend the purchase entry point. Same body, one new defaulted parameter —
-- the (int, text) signature is replaced by (int, text, text) with a default,
-- which every existing call site satisfies unchanged.
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

  -- Unrecognised grades refuse rather than improvise, same rule as the tier
  -- lookup: a product nobody reviewed must not be sold.
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
