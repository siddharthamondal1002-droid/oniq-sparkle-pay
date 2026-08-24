-- SEARCH PROVIDER SPEND CEILINGS — the owner's three numbers.
--
-- OWNER DIRECTIVE, 2026-08-24:
--
--     request_usd_cap = 0.50
--     job_usd_cap     = 2.00
--     daily_usd_cap   = 20.00
--
-- These are USD PROVIDER-SPEND CEILINGS on SEARCH — the web-search hops and
-- the LLM tokens spent reasoning over them. Their scopes:
--
--     request_usd_cap  the most one search request may spend
--     job_usd_cap      the most one job's search ladder may spend
--     daily_usd_cap    the most all SEARCH may spend in a day
--
-- ---------------------------------------------------------------------------
-- THESE NUMBERS COME FROM THE OWNER, NOT FROM THE SUPERSEDED TABLE.
--
-- `search_budget_config` (20260824050000) carried a request_usd_cap DEFAULT of
-- 0.50, and 20260824120000 dropped it. That coincidence is not the authority
-- here and must not be cited as one: a default written by an agent is not an
-- owner decision, and the day the two numbers agree is exactly the day the
-- distinction stops being visible. The authority is the directive above.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- THIS MIGRATION DOES NOT ENABLE SEARCH.
--
-- The owner authorised the three ceilings and NOTHING ELSE. Setting a budget
-- and permitting spend are two separate decisions. `enabled` is inserted FALSE
-- and, on a row that already exists, is deliberately NOT TOUCHED by the ON
-- CONFLICT clause: this migration owns the ceilings, never the enablement.
-- Re-running it can therefore neither switch SEARCH on nor switch it off
-- behind an owner who set it.
-- ---------------------------------------------------------------------------
--
-- `max_attempts_per_job` IS NOT SET HERE, and that is deliberate. The owner
-- supplied three ceilings and no attempt count, so this migration takes the
-- column default (3) rather than inventing a fourth number. The consequence is
-- worth stating out loud rather than leaving to be discovered:
--
--     effective job exposure = min(job_usd_cap, request_usd_cap x attempts)
--                            = min(2.00, 0.50 x 3) = 1.50
--
-- So the $2.00 job ceiling is deliberately ABOVE what the retry ladder can
-- actually reach — the same shape as VIDEO's $5.00 over $3.00, and for the
-- same reason (ONIQ_AI_FINANCIAL_CONTROL §2). Headroom in a ceiling is not a
-- target, and raising the attempt count to "use" the ceiling would be an agent
-- choosing to spend more of the owner's money. If the owner wants the ladder
-- to be able to reach $2.00, that is a separate directive.

insert into public.provider_budget_config
  (capability, request_usd_cap, job_usd_cap, daily_usd_cap, enabled)
values
  ('SEARCH', 0.50, 2.00, 20.00, false)
on conflict (capability) do update
  set request_usd_cap = excluded.request_usd_cap,
      job_usd_cap     = excluded.job_usd_cap,
      daily_usd_cap   = excluded.daily_usd_cap,
      updated_at      = now();
      -- enabled and max_attempts_per_job are INTENTIONALLY ABSENT.

-- Prove the owner's numbers actually landed, and that SEARCH is still off.
-- A silent no-op here would leave the ledger fail-closed rather than
-- overspending, but it would also mean the ceilings the owner set are not the
-- ceilings in force — so fail the migration loudly instead.
do $$
declare
  cfg public.provider_budget_config%rowtype;
begin
  select * into cfg from public.provider_budget_config where capability = 'SEARCH';

  if not found then
    raise exception 'SEARCH budget row missing after insert';
  end if;
  if cfg.request_usd_cap <> 0.50 or cfg.job_usd_cap <> 2.00 or cfg.daily_usd_cap <> 20.00 then
    raise exception 'SEARCH ceilings are %/%/%, expected 0.50/2.00/20.00',
      cfg.request_usd_cap, cfg.job_usd_cap, cfg.daily_usd_cap;
  end if;
  -- Belt and braces over the CHECK constraints: the same predicate admission
  -- uses, asserted on the row this migration just wrote.
  if not (public.is_spendable_usd(cfg.request_usd_cap)
          and public.is_spendable_usd(cfg.job_usd_cap)
          and public.is_spendable_usd(cfg.daily_usd_cap)
          and cfg.request_usd_cap <= cfg.job_usd_cap
          and cfg.job_usd_cap <= cfg.daily_usd_cap) then
    raise exception 'SEARCH ceilings failed the spendable/ordering predicate';
  end if;

  -- VIDEO is not this migration's business. Assert it was left alone, so a
  -- future edit that widens the insert into a multi-row statement cannot
  -- quietly restate — or misstate — ceilings the owner set separately.
  select * into cfg from public.provider_budget_config where capability = 'VIDEO';
  if found and (cfg.request_usd_cap <> 1.00 or cfg.job_usd_cap <> 5.00
                or cfg.daily_usd_cap <> 50.00 or cfg.max_attempts_per_job <> 3) then
    raise exception 'VIDEO ceilings changed to %/%/% attempts %, expected 1.00/5.00/50.00 attempts 3',
      cfg.request_usd_cap, cfg.job_usd_cap, cfg.daily_usd_cap, cfg.max_attempts_per_job;
  end if;
end $$;
