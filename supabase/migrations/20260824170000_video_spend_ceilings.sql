-- VIDEO PROVIDER SPEND CEILINGS — the owner's three numbers.
--
-- OWNER DIRECTIVE, 2026-08-24:
--
--     request_usd_cap = 1.00
--     job_usd_cap     = 5.00
--     daily_usd_cap   = 50.00
--
-- These are USD PROVIDER-SPEND CEILINGS. They are not motion-quality
-- thresholds, not acceptance bars, and not benchmark scores. Their scopes:
--
--     request_usd_cap  the most one provider request may spend
--     job_usd_cap      the most one film / one shot's retry ladder may spend
--     daily_usd_cap    the most all VIDEO generation may spend in a day
--
-- `max_attempts_per_job` stays a SEPARATE, NON-MONETARY invariant. It is a
-- count, and it bounds retries no matter how cheap an individual attempt is —
-- a $0.001 model retried forever is still an outage.
--
-- WHY A MIGRATION OWNS THESE. This repository already records owner decisions
-- about money as a dated migration next to the code it governs — the
-- 2026-08-13 movie-on/classic-off flip is the exemplar CLAUDE.md points at,
-- and video_gen_config's cap is seeded exactly this way. So the authoritative
-- home for an owner-supplied ceiling is here, not an environment variable a
-- deploy could silently drop.
--
-- ---------------------------------------------------------------------------
-- THIS MIGRATION DOES NOT ENABLE VIDEO GENERATION.
--
-- The owner authorised the three ceilings and NOTHING ELSE. Setting a budget
-- and permitting spend are two separate decisions, and valid caps are not
-- permission to generate. `enabled` is inserted FALSE and, on a row that
-- already exists, is deliberately NOT TOUCHED by the ON CONFLICT clause: this
-- migration owns the ceilings, never the enablement. Re-running it can
-- therefore never turn generation on, and cannot turn it off either if the
-- owner has separately turned it on.
-- ---------------------------------------------------------------------------

insert into public.provider_budget_config
  (capability, request_usd_cap, job_usd_cap, daily_usd_cap, max_attempts_per_job, enabled)
values
  ('VIDEO', 1.00, 5.00, 50.00, 3, false)
on conflict (capability) do update
  set request_usd_cap = excluded.request_usd_cap,
      job_usd_cap     = excluded.job_usd_cap,
      daily_usd_cap   = excluded.daily_usd_cap,
      updated_at      = now();
      -- enabled is INTENTIONALLY ABSENT. See the block above.

-- Prove the owner's numbers actually landed, and that generation is still off.
-- A silent no-op here would leave the ledger fail-closed rather than
-- overspending, but it would also mean the ceilings the owner set are not the
-- ceilings in force — so fail the migration loudly instead.
do $$
declare
  cfg public.provider_budget_config%rowtype;
begin
  select * into cfg from public.provider_budget_config where capability = 'VIDEO';

  if not found then
    raise exception 'VIDEO budget row missing after insert';
  end if;
  if cfg.request_usd_cap <> 1.00 or cfg.job_usd_cap <> 5.00 or cfg.daily_usd_cap <> 50.00 then
    raise exception 'VIDEO ceilings are %/%/%, expected 1.00/5.00/50.00',
      cfg.request_usd_cap, cfg.job_usd_cap, cfg.daily_usd_cap;
  end if;
  -- Belt and braces over the CHECK constraints: the same predicate admission
  -- uses, asserted on the row this migration just wrote.
  if not (public.is_spendable_usd(cfg.request_usd_cap)
          and public.is_spendable_usd(cfg.job_usd_cap)
          and public.is_spendable_usd(cfg.daily_usd_cap)
          and cfg.request_usd_cap <= cfg.job_usd_cap
          and cfg.job_usd_cap <= cfg.daily_usd_cap) then
    raise exception 'VIDEO ceilings failed the spendable/ordering predicate';
  end if;
end $$;
