-- OVER_CAP — an overrun must be recorded, never disguised.
--
-- WHY THIS EXISTS. On 2026-08-24 the first real SEARCH request ONIQ ever
-- admitted settled at $0.530683 against a $0.50 request ceiling. The ledger
-- recorded the true figure — that part was already right, and settlement
-- deliberately never clamps, because a clamped invoice is a fabricated one.
--
-- But the row looked EXACTLY LIKE A COMPLIANT ONE. Nothing distinguished a
-- settlement that honoured the ceiling from one that blew through it, so the
-- only way to notice was to re-derive the comparison by hand against a
-- capability's configured cap. An overrun nobody can see is an overrun nobody
-- fixes, and the whole point of this ledger is that inconvenient costs stay
-- visible.
--
-- So: mark it. `over_cap` is a FACT ABOUT THE SETTLEMENT, computed once at
-- settle time against the ceiling in force then. It is not a control — it
-- changes no admission decision, refuses nothing, and clamps nothing. Reading
-- it as enforcement would be the mistake; it is a receipt.
--
-- WHY NOT A GENERATED COLUMN. The ceiling can change. A generated column would
-- silently re-answer "was this over the cap?" against today's configuration
-- rather than the configuration the money was actually spent under, which
-- would rewrite history every time an owner adjusted a ceiling.

alter table public.provider_spend_ledger
  add column if not exists over_cap boolean not null default false;

comment on column public.provider_spend_ledger.over_cap is
  'True when the SETTLED actual exceeded the capability request_usd_cap in '
  'force at settlement time. A record of what happened, never a control: '
  'admission bounds reservations, settlement records invoices and never clamps.';

-- Also record WHAT the ceiling was, so the row is self-describing. Comparing a
-- historical settlement against a cap that has since moved is how an audit
-- reaches a confidently wrong conclusion.
alter table public.provider_spend_ledger
  add column if not exists request_cap_usd_at_settle numeric(10, 4);

comment on column public.provider_spend_ledger.request_cap_usd_at_settle is
  'The request_usd_cap in force when this row settled. Null for rows settled '
  'before 20260824200000, and for rows whose capability had no config row.';

create index if not exists provider_spend_ledger_over_cap_idx
  on public.provider_spend_ledger (day, capability) where over_cap;

create or replace function public.settle_provider_spend(
  _request_id  text,
  _actual_usd  numeric default null,
  _units_actual numeric default null,
  _outcome     text default null,
  _detail      jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  led    public.provider_spend_ledger%rowtype;
  charge numeric;
  cap    numeric;
  over   boolean := false;
begin
  select * into led from public.provider_spend_ledger
   where request_id = _request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown-request');
  end if;
  if led.state <> 'RESERVED' then
    return jsonb_build_object('ok', false, 'reason', 'already-' || lower(led.state));
  end if;

  charge := coalesce(_actual_usd, led.estimated_usd);

  -- The ceiling in force RIGHT NOW, for this capability. Null-safe: a
  -- capability with no config row cannot be over a cap that does not exist,
  -- and `is_spendable_usd` keeps NaN/Infinity out of the comparison — without
  -- it, `charge > 'NaN'` would be FALSE and an unusable ceiling would read as
  -- "not over cap", which is the friendliest possible lie.
  select request_usd_cap into cap
    from public.provider_budget_config where capability = led.capability;
  if cap is not null and public.is_spendable_usd(cap) then
    over := charge > cap;
  end if;

  update public.provider_spend_ledger
     set actual_usd   = _actual_usd,
         units_actual = _units_actual,
         outcome      = coalesce(_outcome, outcome),
         detail       = coalesce(_detail, detail),
         state        = 'SETTLED',
         settled_at   = now(),
         over_cap     = over,
         request_cap_usd_at_settle = cap
   where request_id = _request_id;

  update public.provider_spend_day
     set reserved_usd = greatest(reserved_usd - led.estimated_usd, 0),
         settled_usd  = settled_usd + charge
   where day = led.day and capability = led.capability;

  if led.job_id is not null then
    update public.provider_spend_job
       set reserved_usd = greatest(reserved_usd - led.estimated_usd, 0),
           settled_usd  = settled_usd + charge
     where job_id = led.job_id;
  end if;

  -- The verdict travels with the settlement so a caller can log or alert on it
  -- without a second round trip. `chargedUsd` is unchanged and still the true
  -- figure — nothing here reduces what is recorded.
  return jsonb_build_object('ok', true, 'reason', 'settled', 'chargedUsd', charge,
    'actualKnown', _actual_usd is not null,
    'overCap', over, 'requestCapUsd', cap);
end;
$$;

revoke all on function public.settle_provider_spend(text, numeric, numeric, text, jsonb)
  from anon, authenticated;

-- Read side: the overruns, newest first, with the gap spelled out.
create or replace view public.provider_spend_over_cap as
select l.day, l.capability, l.request_id, l.provider, l.model,
       l.estimated_usd, l.actual_usd, l.request_cap_usd_at_settle,
       round(l.actual_usd - l.request_cap_usd_at_settle, 6) as over_by_usd,
       l.detail, l.settled_at
  from public.provider_spend_ledger l
 where l.over_cap
 order by l.settled_at desc;

comment on view public.provider_spend_over_cap is
  'Settlements that exceeded the request ceiling in force at the time. '
  'Evidence for whether the cost model under-reserves, and by how much.';

-- Backfill the one row that predates this migration, so the first known
-- overrun is not invisible purely because it happened first. Judged against
-- the cap in force now, which for SEARCH has not changed since it settled.
update public.provider_spend_ledger l
   set request_cap_usd_at_settle = c.request_usd_cap,
       over_cap = l.actual_usd > c.request_usd_cap
  from public.provider_budget_config c
 where l.capability = c.capability
   and l.state = 'SETTLED'
   and l.actual_usd is not null
   and l.request_cap_usd_at_settle is null
   and public.is_spendable_usd(c.request_usd_cap);
