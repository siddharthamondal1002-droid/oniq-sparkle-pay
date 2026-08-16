-- DELETE EVERYWHERE, INCLUDING A FILM STILL BEING MADE.
--
-- 20260815200000 gave Your videos a delete on finished and failed rows and
-- deliberately refused anything mid-render, because deleting one raises what
-- happens to the seconds and refunds are the owner's call. Asked for the
-- option everywhere (2026-08-16), so here is the answer to that question and
-- the reasoning behind it.
--
-- THE SECONDS COME BACK, AND THAT IS NOT A NEW POLICY. It is the rule this
-- system already runs: story-sweep fails any queued/generating/assembling job
-- untouched for thirty minutes and calls refund_story_seconds on it — "no
-- renderer picked this up in time — your time has been returned". A job that
-- produces no film returns its seconds. Cancelling by hand produces no film,
-- so it returns them too. The only thing changing is WHO starts the clock: the
-- person waiting, instead of a thirty-minute timer.
--
-- The alternative — keeping the seconds because compute was spent — would be
-- the new policy, and a worse one: it would make Delete a trap on the one
-- screen where someone is already unhappy enough to press it.
--
-- refund_story_seconds is idempotent (it checks refunded_at under the row
-- lock), so a job cancelled here and then swept later gives its seconds back
-- exactly once.
--
-- ORDER MATTERS: failed first, then refund, then purged. `failed` is legal
-- from every pre-terminal state and is what the sweep would have written; the
-- refund reads seconds_charged and paid_seconds_charged off the row, which the
-- status change does not touch; and `purged` last is what removes it from the
-- list. Refunding before marking would leave a job that could still be picked
-- up by a renderer and charged nothing.

create or replace function public.delete_story_job(_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  j public.story_jobs%rowtype;
  refunded boolean := false;
begin
  if me is null then raise exception 'not authenticated'; end if;

  select * into j from story_jobs where id = _job_id and user_id = me for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not-found');
  end if;

  if j.status = 'purged' then
    return jsonb_build_object('ok', true, 'alreadyGone', true, 'refunded', false);
  end if;

  -- IN FLIGHT: stop it the way the sweep would, then give the time back.
  if j.status in ('queued', 'generating', 'assembling', 'delivering') then
    update story_jobs
       set status = 'failed',
           error = 'you deleted this before it finished — your time has been returned',
           updated_at = now()
     where id = _job_id;

    -- Idempotent by refunded_at, so a later sweep of the same job pays once.
    perform public.refund_story_seconds(_job_id);
    refunded := true;
  end if;

  update story_jobs
     set status = 'purged',
         updated_at = now()
   where id = _job_id;

  -- has_bytes is UNTOUCHED on purpose. story-sweep asks about bytes, so a
  -- purged row still holding them is exactly the case it retries and clears.
  -- Setting it false here would orphan the object: nothing else looks.
  return jsonb_build_object(
    'ok', true,
    'bytesPending', coalesce(j.has_bytes, false),
    'refunded', refunded
  );
end;
$$;

revoke all on function public.delete_story_job(uuid) from public, anon;
grant execute on function public.delete_story_job(uuid) to authenticated;

comment on function public.delete_story_job(uuid) is
  'Owner-initiated delete of one Story, at any stage. A job still in flight is failed and refunded first — the same treatment story-sweep gives a job that never rendered — then purged. Marks purged and leaves has_bytes for story-sweep to clear, so bytes go by the same path as every other deletion.';
