-- Structured shot-level QC evidence from the worker's pre-assembly validator.
-- JSONB keeps the first slice additive while the schema settles.
alter table public.story_jobs
  add column if not exists qc_report jsonb;
