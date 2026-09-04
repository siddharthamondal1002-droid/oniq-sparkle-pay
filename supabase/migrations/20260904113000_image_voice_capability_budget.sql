-- IMAGE and TTS get their own spend-ceiling rows — same bug as MUSIC,
-- caught before it shipped live instead of after (owner-approved 2026-09-04).
--
-- image-generate and voice-generate both reserve through withSearchSpendGuard,
-- which prices a call via a MODEL_RATES lookup — per token. Neither
-- IMAGE_MODEL nor VOICE_MODEL has an entry there (both files' own comments
-- already say so, for settlement's sake), so admission throws on every call
-- and refuses "unpriced-model" before the gateway is ever reached. Exactly
-- the music-generate bug (20260904110000), just still dormant: both features
-- ship with image_enabled/voice_enabled = false, so nobody has hit it yet —
-- but the moment either gets turned on, every request breaks the same way
-- music's did.
--
-- provider_budget_config had no IMAGE or TTS row either — 'IMAGE' and 'TTS'
-- were already permitted capability values, just never given a budget.
--
-- Every number is arithmetic on figures already on record, not a new
-- decision: $0.067/image and $0.16/voice-clip are each model's own
-- maxEstimatedUsd, already in image-generate/voice-generate's code; the daily
-- ceilings are those times the existing image_daily_cap and voice_daily_cap
-- of 200 each. One attempt per job — neither path retries.

insert into public.provider_budget_config
  (capability, daily_usd_cap, request_usd_cap, job_usd_cap, max_attempts_per_job, enabled)
values
  ('IMAGE', 13.40, 0.067, 0.067, 1, true),
  ('TTS', 32.00, 0.16, 0.16, 1, true)
on conflict (capability) do nothing;
