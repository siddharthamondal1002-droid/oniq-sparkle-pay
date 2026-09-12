-- PER-JOB IN-HOUSE MOTION, owner-authorized bounded internal test 2026-09-12.
--
-- WHY A COLUMN AND NOT A REPOSITORY VARIABLE. routeMotion reads IN_HOUSE_MOTION,
-- ONIQ_GPU_HEALTHY and ONIQ_WORKER_IMAGE, which the workflow supplies from
-- GLOBAL GitHub repository variables. Flipping those would change the engine for
-- every film every user renders, which is exactly the blast radius the owner
-- excluded. motion_mode is already the per-job renderer switch (actor_refs and
-- story_movie travel the same way), it has no client INSERT/UPDATE policy on
-- story_jobs, and it is therefore service-role-writable only — so this can never
-- become a user-reachable spend switch.
--
-- ADDITIVE ONLY: NULL (every production job) and 'select' behave exactly as
-- before, and an unset payload leaves the workflow reading the repository
-- variables it reads today.
alter table public.story_jobs drop constraint if exists story_jobs_motion_mode_check;
alter table public.story_jobs add constraint story_jobs_motion_mode_check
  check (motion_mode is null or motion_mode in ('select', 'in_house'));