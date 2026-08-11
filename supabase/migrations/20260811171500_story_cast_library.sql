-- The cast library — a user's characters, recurring across their films.
--
-- WHY. Character consistency inside one film is solved by cast locks
-- (story-plot writes them, every still repeats them). ACROSS films there was
-- nothing: the same "brave girl with a red scarf" came back as a different
-- person in every new Story. The library closes that: the user keeps named
-- characters (client-side), attaches them to a job, and story-plot is told to
-- REUSE those locks verbatim instead of inventing new people.
--
-- WHY A DEDICATED RPC AND NOT A COLUMN GRANT. claim_story_seconds has been
-- redefined by successive migrations (free tier, paid seconds); forking its
-- CURRENT body here to add a parameter risks silently reverting whichever
-- version is live — the exact class of drift the pricing test exists to stop.
-- A separate, narrow writer touches nothing the billing path owns. The write
-- races the dispatch cron (a job is claimable the moment it exists), and
-- losing that race is graceful: the film renders, without reuse.
--
-- BOUNDED HARD. Six characters, short fields, or the cast block would crowd
-- the plan prompt out of its own token budget — the same reason story-plot
-- caps the user prompt at 2000 characters.

alter table public.story_jobs add column if not exists cast_json jsonb;

create or replace function public.set_story_cast(_job_id uuid, _cast jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  entry jsonb;
  n int;
  nm text;
  lk text;
  clean jsonb := '[]'::jsonb;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if _cast is null or jsonb_typeof(_cast) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'not-an-array');
  end if;
  n := jsonb_array_length(_cast);
  if n = 0 or n > 6 then
    return jsonb_build_object('ok', false, 'reason', 'bad-count');
  end if;

  for entry in select * from jsonb_array_elements(_cast) loop
    nm := left(trim(coalesce(entry->>'name', '')), 60);
    lk := left(trim(coalesce(entry->>'lock', '')), 400);
    if length(nm) = 0 or length(lk) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'bad-entry');
    end if;
    clean := clean || jsonb_build_array(jsonb_build_object('name', nm, 'lock', lk));
  end loop;

  -- Owner-only, and only while the job is still queued: once a runner claims
  -- it the plan may already be written, and a cast that arrives after that
  -- would silently not be in the film — better to refuse than to pretend.
  update story_jobs
     set cast_json = clean
   where id = _job_id and user_id = me and status = 'queued';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not-yours-or-started');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_story_cast(uuid, jsonb) from public, anon;
grant execute on function public.set_story_cast(uuid, jsonb) to authenticated;
