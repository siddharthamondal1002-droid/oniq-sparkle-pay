-- A JOB THE DISPATCHER IS HOLDING IS NOT A JOB NOBODY WANTED.
--
-- The bug, measured 2026-08-15 on job eb0d052f. Two guards, each sensible
-- alone, that together guarantee a dead film:
--
--   story-dispatch  refuses to send a job the day's remaining voice budget
--                   cannot finish, and parks it: "job waits for the
--                   Pacific-midnight reset". Its own comment promises the
--                   cost of being wrong is "a job waiting a few extra hours,
--                   not a dead film".
--   story-sweep     fails any queued job whose updated_at is older than
--                   STALE_TTL_MS — thirty minutes — with "no renderer picked
--                   this up in time".
--
-- The reset was hours away. The sweep killed it in thirty minutes. The state
-- story-dispatch believes it is putting jobs into does not exist: every film
-- the remaining budget cannot cover is certain to die, and the user is told
-- the renderer ignored them, which is not what happened.
--
-- THE FIX IS A LEASE, NOT A DEADLINE. `held_until` is a short window the
-- dispatcher RENEWS on every tick while it is deliberately holding a job. The
-- sweep skips a job whose lease is live.
--
-- A lease rather than "hold until the Pacific rollover" for two reasons.
-- First, no timezone arithmetic in three places that must agree. Second and
-- more important, it FAILS SAFE: if the dispatcher stops running, stops
-- holding, or the job stops being held for any reason, the lease simply
-- lapses within minutes and ordinary staleness applies again. A deadline
-- written once by a process that then dies would protect a job forever, which
-- is the same class of bug in the other direction.

alter table public.story_jobs
  add column if not exists held_until timestamptz;

comment on column public.story_jobs.held_until is
  'Lease. While in the future, story-dispatch is DELIBERATELY holding this job (voice budget) and story-sweep must not reap it as abandoned. Renewed every dispatch tick; lapses on its own if the dispatcher stops, so a stuck job cannot hide behind it forever.';

-- The sweep reads by updated_at and now also by this; a queued job is a rare
-- row, so a partial index on the live leases is the whole cost.
create index if not exists story_jobs_held_until_idx
  on public.story_jobs (held_until)
  where held_until is not null;
