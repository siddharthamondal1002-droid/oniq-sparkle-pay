-- gpu_video_jobs — the voice-over (audio_mux) extension, 2026-08-26.
--
-- One job, up to TWO paid provider runs: the proven video_generate step,
-- then an audio_mux step that speaks the narration in-house (piper on the
-- worker's own CPU — no new provider, no Google anywhere in this path)
-- and muxes it under the video. Each step records its own live quote and
-- its own bill; the shared $0.50 job cap covers their sum.
--
-- audio_error records the salvage rule: when the audio step fails after
-- the video succeeded, the job still completes WITH THE SILENT VIDEO and
-- this column says why the voice is missing. Silent failure is banned;
-- silent truncation of a narration is banned in the worker itself.

alter table public.gpu_video_jobs
  add column if not exists audio_mode text not null default 'off'
    check (audio_mode in ('off', 'narration')),
  add column if not exists narration_text text,
  add column if not exists audio_runpod_job_id text unique,
  add column if not exists audio_price_per_hour_usd numeric(10, 4),
  add column if not exists audio_billed_seconds numeric(10, 2),
  add column if not exists audio_cost_usd numeric(10, 4),
  add column if not exists narration_seconds numeric(6, 2),
  add column if not exists audio_error text;

-- The state machine gains audio_generating, between the video step's
-- completion and the voiced final's custody.
alter table public.gpu_video_jobs drop constraint if exists gpu_video_jobs_status_check;
alter table public.gpu_video_jobs add constraint gpu_video_jobs_status_check
  check (status in (
    'queued', 'admitted', 'provisioning', 'running', 'uploading',
    'audio_generating', 'completed', 'failed', 'timed-out', 'cancelled',
    'terminating', 'orphaned'
  ));

-- Production gate (Phase 21): voice-over ships DISABLED and is flipped on
-- by the owner only after the real canaries pass. The video kill switch
-- is untouched and still rules everything.
alter table public.video_gen_config
  add column if not exists audio_enabled boolean not null default false;
