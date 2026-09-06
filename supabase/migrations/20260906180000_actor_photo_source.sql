-- A character can now come from the person's OWN PHOTO, not only from a draw.
--
-- Owner directive, 2026-09-06: "image not used in making video" — asked what a
-- picture should do, the owner chose "character reference — a face that
-- recurs". Until now a film took no picture at all: StoryWriter is a text box,
-- and the only image inputs in the whole app were on Music and Image.
--
-- THE COLUMN WAS ALREADY HERE, WAITING. `source` was added with the table on
-- 2026-08-27 defaulting to 'generated' and constrained to EXACTLY that one
-- value — someone saw this coming and left the shape without opening it. So
-- this widens a check rather than adding a concept.
--
-- WHY IT IS RECORDED AT ALL, and it is not bookkeeping: a drawn portrait is
-- AI-generated content and ONIQ must label it as such for Play; a photo the
-- person took is NOT, and labelling it "AI-generated" is a false claim in the
-- other direction. The screen reads this column to decide what to say, so the
-- label follows the origin rather than the surface.
alter table public.story_actor_assets
  drop constraint if exists story_actor_assets_source_check;

alter table public.story_actor_assets
  add constraint story_actor_assets_source_check
  check (source in ('generated', 'uploaded'));

comment on column public.story_actor_assets.source is
  'generated = drawn by the story-still engine (AI content, labelled as such); '
  'uploaded = a picture the person supplied (NOT AI-generated, and must not be '
  'labelled as if it were).';

-- The 5-argument version is DROPPED rather than left beside a 6-argument one.
-- Adding a defaulted parameter creates a distinct signature, and a 5-argument
-- call would then be ambiguous — Postgres refuses it at call time, which would
-- break the existing draw path in production rather than at deploy.
drop function if exists public.save_story_actor(text, text, text, text, text);

create or replace function public.save_story_actor(
  _name text,
  _lock text,
  _style text,
  _path text,
  _mime text,
  _source text default 'generated'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  nm text;
  lk text;
  st text;
  src text;
  n int;
  new_id uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;

  nm := left(trim(coalesce(_name, '')), 60);
  lk := left(trim(coalesce(_lock, '')), 400);
  st := nullif(left(trim(coalesce(_style, '')), 120), '');
  -- An ALLOWLIST, not a pass-through. Anything unrecognised becomes
  -- 'generated', which is the conservative direction: it over-labels as AI
  -- rather than under-labelling a real photo, and the check constraint would
  -- reject a typo as a hard error mid-save either way.
  src := case when _source = 'uploaded' then 'uploaded' else 'generated' end;

  if length(nm) = 0 or length(lk) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad-entry');
  end if;
  if _mime is null or _mime not in ('image/png', 'image/jpeg', 'image/webp') then
    return jsonb_build_object('ok', false, 'reason', 'bad-mime');
  end if;
  -- The path must sit in the caller's own folder of the actor bucket — the
  -- same rule storage RLS enforces on the bytes, repeated here so a row can
  -- never point at somebody else's object.
  if _path is null or _path not like (me::text || '/%') or length(_path) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'bad-path');
  end if;

  -- A library, not a database — same posture as the client cast library.
  select count(*) into n from story_actor_assets where user_id = me;
  if n >= 24 then
    return jsonb_build_object('ok', false, 'reason', 'library-full');
  end if;

  insert into story_actor_assets (user_id, name, lock, style, storage_path, mime, source)
  values (me, nm, lk, st, _path, _mime, src)
  returning id into new_id;

  return jsonb_build_object('ok', true, 'id', new_id, 'source', src);
end;
$$;

revoke all on function public.save_story_actor(text, text, text, text, text, text) from public, anon;
grant execute on function public.save_story_actor(text, text, text, text, text, text) to authenticated;
