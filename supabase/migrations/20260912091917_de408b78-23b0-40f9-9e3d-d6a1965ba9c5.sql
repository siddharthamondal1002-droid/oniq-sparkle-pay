-- GPU capability budget — owner-approved 2026-09-12, conservative TEST limits.
--
-- WHY THIS WAS BLOCKED. inHouseMotion.spendRequestFor() hard-codes
-- capability: 'GPU', and runBilledUnit() admits through admit_provider_spend
-- BEFORE generate(). provider_budget_config had no GPU row, so admission
-- answered 'no-budget-configured' and every in-house clip refused before a
-- single GPU second was spent. That is the ledger failing closed, correctly.
--
-- AND THE ROW COULD NOT HAVE BEEN INSERTED EITHER. The capability CHECK
-- constraint lists SEARCH/TEXT/IMAGE/VIDEO/VIDEO_AUDIO/TTS/MUSIC/OTHER and
-- has never carried GPU, while financialLedger.ts's Capability type has
-- carried it since it was written. Two blockers, one symptom.
--
-- THE NUMBERS ARE A TEST RESERVATION CEILING, NOT A BILLING BOUND. Measured:
-- the last successful in-house clip (gpu_video_jobs e010372d, 2026-08-27) cost
-- $0.0029 for 4.04s, so a nine-shot film reserves roughly $0.03. request
-- $0.10 is ~34x one measured clip; job $1.00 is ~34 films; daily $1.00 caps
-- the whole day at the same. These bound what ONIQ RESERVES through its own
-- ledger; they do not and cannot bound what RunPod bills for worker uptime.
-- VIDEO's ceilings are deliberately untouched.

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'provider_budget_config_capability_check'
  ) then
    alter table public.provider_budget_config
      drop constraint provider_budget_config_capability_check;
  end if;

  alter table public.provider_budget_config
    add constraint provider_budget_config_capability_check check (
      capability in ('SEARCH', 'TEXT', 'IMAGE', 'VIDEO', 'VIDEO_AUDIO',
                     'TTS', 'MUSIC', 'GPU', 'OTHER')
    );
end $$;

-- do nothing on conflict: if a GPU row was added concurrently by anyone else,
-- theirs stands. This migration never overwrites a ceiling it did not set.
insert into public.provider_budget_config
  (capability, daily_usd_cap, request_usd_cap, job_usd_cap, max_attempts_per_job, enabled)
values
  ('GPU', 1.00, 0.10, 1.00, 10, true)
on conflict (capability) do nothing;