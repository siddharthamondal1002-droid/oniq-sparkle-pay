alter table public.video_gen_config
  add column if not exists music_per_user_daily_cap integer not null default 10;

comment on column public.video_gen_config.music_per_user_daily_cap is
  'Songs per person per rolling 24h. The house cap bounds the bill; this bounds who can spend it, so one account cannot take the whole day''s allowance. Checked BEFORE the billable call, alongside the house cap.';