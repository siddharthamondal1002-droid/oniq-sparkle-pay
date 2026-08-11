create table if not exists public.channel_monetize_config (
  id boolean primary key default true check (id),
  min_members int not null default 50 check (min_members >= 0),
  min_channel_age_days int not null default 14 check (min_channel_age_days >= 0),
  min_posts int not null default 10 check (min_posts >= 0),
  updated_at timestamptz not null default now()
);
insert into public.channel_monetize_config (id) values (true) on conflict (id) do nothing;
grant select on public.channel_monetize_config to authenticated;
alter table public.channel_monetize_config enable row level security;
drop policy if exists "monetize config readable" on public.channel_monetize_config;
create policy "monetize config readable" on public.channel_monetize_config
  for select to authenticated using (true);

create table if not exists public.creator_program_config (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  creator_pct int not null default 70 check (creator_pct between 0 and 100),
  oniq_pct int not null default 20 check (oniq_pct between 0 and 100),
  subscriber_pct int not null default 10 check (subscriber_pct between 0 and 100),
  check (creator_pct + oniq_pct + subscriber_pct = 100),
  period_pool_paise int not null default 100000 check (period_pool_paise >= 0),
  updated_at timestamptz not null default now()
);
insert into public.creator_program_config (id) values (true) on conflict (id) do nothing;
grant select on public.creator_program_config to authenticated;
alter table public.creator_program_config enable row level security;
drop policy if exists "program config readable" on public.creator_program_config;
create policy "program config readable" on public.creator_program_config
  for select to authenticated using (true);

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
  posts int;
  age_days int;
begin
  select * into cfg from channel_monetize_config where id = true;
  if not found then raise exception 'monetize config missing'; end if;

  select count(*)::int into members
    from conversation_members where conversation_id = _channel_id;
  select count(*)::int into posts
    from messages where conversation_id = _channel_id and type <> 'system';
  select greatest(0, extract(day from now() - c.created_at))::int into age_days
    from conversations c where c.id = _channel_id and c.type = 'channel';
  if age_days is null then
    return jsonb_build_object('ok', false, 'reason', 'no-such-channel');
  end if;

  return jsonb_build_object(
    'ok', true,
    'qualified', members >= cfg.min_members
             and posts >= cfg.min_posts
             and age_days >= cfg.min_channel_age_days,
    'members', members, 'minMembers', cfg.min_members,
    'posts', posts, 'minPosts', cfg.min_posts,
    'ageDays', age_days, 'minAgeDays', cfg.min_channel_age_days
  );
end;
$$;
revoke all on function public.channel_monetize_status(uuid) from public, anon;
grant execute on function public.channel_monetize_status(uuid) to authenticated;

create table if not exists public.creator_payout_runs (
  id uuid primary key default gen_random_uuid(),
  pool_paise int not null,
  distributed_paise int not null default 0,
  channels int not null default 0,
  ran_at timestamptz not null default now()
);
grant select on public.creator_payout_runs to authenticated;
alter table public.creator_payout_runs enable row level security;
drop policy if exists "runs readable" on public.creator_payout_runs;
create policy "runs readable" on public.creator_payout_runs
  for select to authenticated using (true);

create table if not exists public.creator_payouts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.creator_payout_runs(id) on delete cascade,
  channel_id uuid not null references public.conversations(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  engagement_points int not null,
  allocation_paise int not null,
  creator_paise int not null,
  subscriber_paise int not null,
  subscriber_count int not null,
  oniq_paise int not null,
  created_at timestamptz not null default now()
);
create index if not exists creator_payouts_creator_idx
  on public.creator_payouts (creator_id, created_at desc);
create index if not exists creator_payouts_channel_idx
  on public.creator_payouts (channel_id, created_at desc);
grant select on public.creator_payouts to authenticated;
alter table public.creator_payouts enable row level security;
drop policy if exists "payouts readable by parties" on public.creator_payouts;
create policy "payouts readable by parties" on public.creator_payouts
  for select to authenticated
  using (
    creator_id = auth.uid()
    or exists (
      select 1 from conversation_members m
       where m.conversation_id = creator_payouts.channel_id and m.user_id = auth.uid()
    )
  );

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
  oniq_amt int;
  member_cnt int;
  per_member int;
  sub_paid int;
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
         (select count(*) from conversation_members m where m.conversation_id = c.id)::int
           as members,
         (select count(*) from messages msg
           where msg.conversation_id = c.id
             and msg.type <> 'system'
             and msg.created_at > now() - interval '30 days')::int
           as recent_msgs
    from conversations c
    join conversation_members om
      on om.conversation_id = c.id and om.role = 'owner'
   where c.type = 'channel'
     and (channel_monetize_status(c.id)->>'qualified')::boolean;

  select coalesce(sum(members + recent_msgs), 0) into total_points from _qualified;
  if total_points = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no-qualified-channels');
  end if;

  insert into creator_payout_runs (pool_paise) values (pool) returning id into run_id;

  for ch in select * from _qualified loop
    alloc := ((pool::bigint * (ch.members + ch.recent_msgs)) / total_points)::int;
    if alloc <= 0 then continue; end if;

    creator_amt := (alloc * cfg.creator_pct) / 100;
    sub_total := (alloc * cfg.subscriber_pct) / 100;

    update wallets set fiat_balance = fiat_balance + (creator_amt / 100.0), updated_at = now()
     where user_id = ch.creator_id;
    insert into transactions (recipient_id, amount, currency, type, status, note)
    values (ch.creator_id, creator_amt / 100.0, 'INR', 'reward', 'completed',
            'Creator Program payout');

    select count(*)::int into member_cnt
      from conversation_members m
     where m.conversation_id = ch.channel_id and m.user_id <> ch.creator_id;
    sub_paid := 0;
    if member_cnt > 0 and sub_total > 0 then
      per_member := sub_total / member_cnt;
      if per_member > 0 then
        update wallets w
           set fiat_balance = fiat_balance + (per_member / 100.0), updated_at = now()
          from conversation_members m
         where m.conversation_id = ch.channel_id
           and m.user_id <> ch.creator_id
           and w.user_id = m.user_id;
        insert into transactions (recipient_id, amount, currency, type, status, note)
        select m.user_id, per_member / 100.0, 'INR', 'reward', 'completed',
               'Subscriber reward — Creator Program'
          from conversation_members m
         where m.conversation_id = ch.channel_id and m.user_id <> ch.creator_id;
        sub_paid := per_member * member_cnt;
      end if;
    end if;

    oniq_amt := alloc - creator_amt - sub_paid;

    insert into creator_payouts
      (run_id, channel_id, creator_id, engagement_points, allocation_paise,
       creator_paise, subscriber_paise, subscriber_count, oniq_paise)
    values
      (run_id, ch.channel_id, ch.creator_id, ch.members + ch.recent_msgs, alloc,
       creator_amt, sub_paid, member_cnt, oniq_amt);

    distributed := distributed + alloc;
    chans := chans + 1;
  end loop;

  update creator_payout_runs
     set distributed_paise = distributed, channels = chans
   where id = run_id;

  return jsonb_build_object('ok', true, 'runId', run_id,
                            'channels', chans, 'distributedPaise', distributed);
end;
$$;
revoke all on function public.run_creator_payouts(int) from public, anon, authenticated;