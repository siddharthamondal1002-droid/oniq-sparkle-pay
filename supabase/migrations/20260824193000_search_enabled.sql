-- SEARCH ON — the owner's enablement flip (directive, 2026-08-24: "enable
-- SEARCH").
--
-- UNLIKE `20260824190000_search_spend_ceilings.sql`, which deliberately omits
-- `enabled` so that re-running it can never switch spending on behind the
-- owner, this migration DOES set it — deliberately, because flipping the
-- capability on IS this migration's whole purpose, not a side effect of
-- configuring ceilings. Same shape as the 2026-08-13 movie-on/classic-off
-- flip that CLAUDE.md points at as the exemplar.
--
-- The two decisions stay two migrations. A future directive to turn SEARCH
-- back off is a NEW dated migration with a later timestamp, which therefore
-- runs after this one and wins — the lineage stays readable in file order.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES AND DOES NOT CHANGE.
--
-- It permits SEARCH to reserve against the ceilings the owner set on the same
-- day: $0.50 per request, $2.00 per job, $20.00 per day, three attempts.
--
-- It does NOT, by itself, start any spending. The four searching edge
-- functions RUNNING IN PRODUCTION predate the spend guard (it landed today in
-- `3a2419de`) and do not call `admit_provider_spend` at all, so until they are
-- deployed this flag changes no production behaviour. What it does is unblock
-- that deploy: with SEARCH enabled, deploying them makes searches admit
-- against the ceilings instead of being refused `capability-disabled`.
--
-- That ordering is the point. Deploying them while SEARCH was disabled would
-- have turned every production search into a fail-closed refusal — correct by
-- the ledger's rules and a user-visible outage all the same. See
-- ONIQ_AI_FINANCIAL_CONTROL §9.
-- ---------------------------------------------------------------------------
--
-- VIDEO IS NOT TOUCHED. It remains disabled, awaiting its own separate
-- decision, and the guard block below fails loudly if that stops being true.

-- Refuse to enable against ceilings that are not the ones the owner approved.
-- Turning spending on over a wrong, missing or unusable budget is the one
-- ordering mistake this flip could make, so it is checked BEFORE the update
-- rather than after it.
do $$
declare
  cfg public.provider_budget_config%rowtype;
begin
  select * into cfg from public.provider_budget_config where capability = 'SEARCH';

  if not found then
    raise exception 'refusing to enable SEARCH: no budget row — run 20260824190000 first';
  end if;
  if cfg.request_usd_cap <> 0.50 or cfg.job_usd_cap <> 2.00 or cfg.daily_usd_cap <> 20.00 then
    raise exception 'refusing to enable SEARCH: ceilings are %/%/%, expected 0.50/2.00/20.00',
      cfg.request_usd_cap, cfg.job_usd_cap, cfg.daily_usd_cap;
  end if;
  if not (public.is_spendable_usd(cfg.request_usd_cap)
          and public.is_spendable_usd(cfg.job_usd_cap)
          and public.is_spendable_usd(cfg.daily_usd_cap)
          and cfg.request_usd_cap <= cfg.job_usd_cap
          and cfg.job_usd_cap <= cfg.daily_usd_cap) then
    raise exception 'refusing to enable SEARCH: ceilings failed the spendable/ordering predicate';
  end if;
end $$;

update public.provider_budget_config
   set enabled = true,
       updated_at = now()
 where capability = 'SEARCH';

-- Prove the flip landed, and that it landed on SEARCH ALONE.
do $$
declare
  cfg public.provider_budget_config%rowtype;
begin
  select * into cfg from public.provider_budget_config where capability = 'SEARCH';
  if not found or not cfg.enabled then
    raise exception 'SEARCH did not end up enabled';
  end if;
  -- The ceilings must be untouched by the flip — this migration owns the
  -- enablement, never the money.
  if cfg.request_usd_cap <> 0.50 or cfg.job_usd_cap <> 2.00 or cfg.daily_usd_cap <> 20.00 then
    raise exception 'SEARCH ceilings moved during enablement: %/%/%',
      cfg.request_usd_cap, cfg.job_usd_cap, cfg.daily_usd_cap;
  end if;

  -- VIDEO is a separate owner decision and must not have been carried along.
  select * into cfg from public.provider_budget_config where capability = 'VIDEO';
  if found and cfg.enabled then
    raise exception 'VIDEO was enabled by the SEARCH flip — it has its own decision';
  end if;
  if found and (cfg.request_usd_cap <> 1.00 or cfg.job_usd_cap <> 5.00
                or cfg.daily_usd_cap <> 50.00 or cfg.max_attempts_per_job <> 3) then
    raise exception 'VIDEO ceilings changed to %/%/% attempts %, expected 1.00/5.00/50.00 attempts 3',
      cfg.request_usd_cap, cfg.job_usd_cap, cfg.daily_usd_cap, cfg.max_attempts_per_job;
  end if;

  -- No capability the owner never configured may be switched on by this.
  if exists (select 1 from public.provider_budget_config
              where capability not in ('SEARCH') and enabled) then
    raise exception 'a capability other than SEARCH is enabled after this migration';
  end if;
end $$;
