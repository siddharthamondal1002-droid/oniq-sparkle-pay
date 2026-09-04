-- MUSIC gets its own spend-ceiling row — owner-approved 2026-09-04.
--
-- music-generate has refused every single request since it shipped.
-- withSearchSpendGuard reserves via worstCaseUsd, which prices a MODEL_RATES
-- lookup PER TOKEN — and Lyria is deliberately absent from that table,
-- because it is not priced per token (music-generate's own comment already
-- says so for settlement; nobody noticed admission reads the same table).
-- An unpriced model always throws, so admission always refused
-- "unpriced-model", and every call died before Google was ever called.
--
-- The second, independent reason: provider_budget_config had no MUSIC row at
-- all, only SEARCH and VIDEO. Reusing SEARCH's bucket was rejected on
-- purpose — that table's own header warns "one capability's runaway drains
-- another's," and Lyria at $0.08/song would exhaust SEARCH's $20/day ceiling
-- in ~250 songs, silently capping music at a quarter of the already-approved
-- 1000/day.
--
-- Every number below is arithmetic on figures the owner already gave, not a
-- new decision: $0.08/song is MUSIC_BUDGET.maxEstimatedUsd in
-- music-generate/index.ts; $80/day is that times the existing
-- video_gen_config.music_daily_cap of 1000. One attempt per job because
-- music-generate already has no retry (a refused prompt refuses identically).

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
      capability in ('SEARCH', 'TEXT', 'IMAGE', 'VIDEO', 'VIDEO_AUDIO', 'TTS', 'MUSIC', 'OTHER')
    );
end $$;

insert into public.provider_budget_config
  (capability, daily_usd_cap, request_usd_cap, job_usd_cap, max_attempts_per_job, enabled)
values
  ('MUSIC', 80.00, 0.08, 0.08, 1, true)
on conflict (capability) do nothing;
