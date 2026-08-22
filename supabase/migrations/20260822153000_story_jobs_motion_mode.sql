-- The clip-stage motion mode is opt-in PER JOB, never global (owner-authorized
-- Veo `select` character-motion validation, 2026-08-22).
--
-- story-dispatch reads this column and passes it into the GitHub dispatch
-- (client_payload.story_movie), and the workflow sets STORY_MOVIE only for
-- that job. The worker's motion-runtime contract (PR #78) then attempts a Veo
-- clip ONLY for shots whose own grammar calls for character motion and which
-- no measured rig already serves — every other shot stays on the free
-- still/parallax path.
--
-- Default NULL: every existing and future job renders exactly as before, so
-- production behaviour is byte-for-byte unchanged until a job is explicitly
-- flagged for a validation. Only 'select' is a legal value — the every-shot
-- 'on' experiment stays reachable ONLY by hand on the workflow, never from
-- data. Clients cannot set this: story_jobs carries no INSERT or UPDATE
-- policy (rows are created by the security-definer claim path), so the column
-- is writable by the service role alone and can never become a user-reachable
-- spend switch.
alter table public.story_jobs
  add column if not exists motion_mode text
  check (motion_mode is null or motion_mode = 'select');
