-- Owner-actor conditioning is opt-in PER JOB, never global.
--
-- story-dispatch reads this flag and passes it into the GitHub dispatch
-- (client_payload.actor_refs), and the workflow turns STORY_ACTOR_REFS on only
-- for that job. Default false: every existing and future job renders exactly as
-- before, so production behaviour is byte-for-byte unchanged until a job is
-- explicitly flagged for the owner-actor regression.
alter table public.story_jobs
  add column if not exists actor_refs boolean not null default false;
