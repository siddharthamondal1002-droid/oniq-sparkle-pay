-- The cast library — a user's characters, recurring across their films.
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