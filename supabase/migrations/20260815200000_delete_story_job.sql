-- LET PEOPLE DELETE THEIR OWN FILMS.
--
-- Your videos could delete a copy saved onto the phone and nothing else. A
-- film sitting on our servers, and a failed job's row, could only be removed
-- by waiting: thirty days for a finished film, and forever for the failure
-- notice. "Delete" that means "wait a month" is not a delete.
--
-- IT GOES THROUGH AN RPC BECAUSE story_jobs HAS ONE POLICY AND IT IS SELECT.
-- Every write to this table is a SECURITY DEFINER function; a DELETE policy
-- would be the first client-writable path into a table that carries what
-- somebody was charged.
--
-- IT MARKS `purged` AND LEAVES has_bytes ALONE, which is the whole design.
-- story-sweep asks about BYTES, not status: owesPurge() returns true for a row
-- marked purged that still holds bytes, exactly because that combination means
-- "a delete was recorded and the file is still there". So the row leaves the
-- user's list immediately (listStories filters purged out) and the sweep
-- removes the object within its next pass and clears the flag. Setting
-- has_bytes = false here would be the one mistake that matters: the sweep
-- would skip it and the file would sit in the bucket forever, unreferenced
-- and unbilled to anyone but us.
--
-- `purged` is reachable from every state in the lifecycle table
-- (src/lib/storyLifecycle.ts), so the trigger permits this from anywhere.
--
-- FINISHED FILMS ONLY. A job still queued or rendering raises a question this
-- migration is not allowed to answer — whether deleting it returns the
-- seconds — and refunds are the owner's call (CLAUDE.md). Those age out on
-- their own within the sweep's stale window and refund themselves. So this
-- refuses them and says so, rather than picking a refund policy by accident.

create or replace function public.delete_story_job(_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  j public.story_jobs%rowtype;
begin
  if me is null then raise exception 'not authenticated'; end if;

  -- Locked, and scoped to the caller in the same statement: ownership is not a
  -- second query that could race with the first.
  select * into j from story_jobs where id = _job_id and user_id = me for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not-found');
  end if;

  -- Idempotent. A double tap, or a retry after a dropped reply, must not read
  -- as a failure — the row is already where the caller wanted it.
  if j.status = 'purged' then
    return jsonb_build_object('ok', true, 'alreadyGone', true);
  end if;

  if j.status not in ('ready', 'delivered', 'failed') then
    return jsonb_build_object('ok', false, 'reason', 'still-working');
  end if;

  update story_jobs
     set status = 'purged',
         updated_at = now()
   where id = _job_id;

  -- bytesPending tells the caller the truth: the row is gone from their list
  -- now, the file goes on the sweep's next pass.
  return jsonb_build_object('ok', true, 'bytesPending', coalesce(j.has_bytes, false));
end;
$$;

revoke all on function public.delete_story_job(uuid) from public, anon;
grant execute on function public.delete_story_job(uuid) to authenticated;

comment on function public.delete_story_job(uuid) is
  'Owner-initiated delete of one Story. Marks purged and leaves has_bytes for story-sweep to clear, so the bytes are removed by the same path that handles every other deletion. Refuses jobs still in flight: whether deleting one returns its seconds is a refund policy, not an implementation detail.';
