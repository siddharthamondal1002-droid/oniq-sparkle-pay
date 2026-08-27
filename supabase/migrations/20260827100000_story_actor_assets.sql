-- ============================================================================
-- STORY ACTOR ASSETS — a user's built characters, kept between films.
--
-- Mega loop, 2026-08-27. The cast library (castLibrary.ts) keeps a character
-- as NAME + LOCK TEXT, client-side, because the lock text is what the
-- pipeline consumes. This adds the other half the loop asked for: an
-- explicit "draw this character" produces ONE image through story-still
-- (the existing owner-directed Lovable-gateway engine — no new provider, no
-- new credential), and the result persists here as a REUSABLE actor asset.
--
-- WHAT AN ASSET IS: a visual reference for a description the USER wrote.
-- The table stores exactly what was supplied — name, lock, optional style —
-- and imposes nothing: no ethnicity, gender, occupation, age, region or any
-- other identity field exists in this schema, so the same architecture
-- carries a Jamaican fishmonger, a London detective, or a fantasy creature
-- with equal ease. The lock text is free prose and remains the character.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   * It does not render films. Nothing here creates a story_jobs row,
--     touches claim_story_seconds, or dispatches a worker. Building a
--     character stops at the character (loop invariant: no implicit
--     cascade).
--   * It does not condition film stills on these images. Films consume the
--     LOCK TEXT via set_story_cast exactly as before; wiring user images
--     into still generation is a separate decision (the story-plate
--     migration records that likeness questions are the owner's).
--   * It does not accept user-photo uploads as identities. `source` admits
--     only 'generated' — the image was drawn by ONIQ from the user's own
--     words. See the same likeness note.
--
-- Bytes live in a dedicated private bucket, story-plates-shaped: the first
-- path segment IS the owner, and that layout is the access control. Assets
-- are NOT part of the story purge lifecycle — a library persists; films are
-- the thing that ends purged.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('story-actors', 'story-actors', false)
on conflict (id) do nothing;

drop policy if exists "actor images are written by their owner" on storage.objects;
create policy "actor images are written by their owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'story-actors'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "actor images are read by their owner" on storage.objects;
create policy "actor images are read by their owner" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'story-actors'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "actor images are deleted by their owner" on storage.objects;
create policy "actor images are deleted by their owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'story-actors'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- The asset rows. Bounds mirror the cast library exactly (60/400), because a
-- lock longer than set_story_cast accepts could never ride into a film.
create table if not exists public.story_actor_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  -- The canonical visual description — the user's words, verbatim.
  lock text not null check (char_length(lock) between 1 and 400),
  -- Optional visual-style note the build was asked for. Free text, bounded.
  style text check (style is null or char_length(style) <= 120),
  -- Object name in the story-actors bucket ('<uid>/<uuid>.<ext>').
  storage_path text not null,
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  source text not null default 'generated' check (source = 'generated'),
  created_at timestamptz not null default now()
);

create index if not exists story_actor_assets_user_idx
  on public.story_actor_assets (user_id, created_at desc);

alter table public.story_actor_assets enable row level security;

grant select, delete on public.story_actor_assets to authenticated;
grant all on public.story_actor_assets to service_role;

create policy "actor assets are read by their owner" on public.story_actor_assets
  for select to authenticated
  using (user_id = auth.uid());

create policy "actor assets are deleted by their owner" on public.story_actor_assets
  for delete to authenticated
  using (user_id = auth.uid());

-- INSERT goes through the RPC below and nothing else — the per-user bound
-- cannot be expressed as a row CHECK, and an unbounded insert grant is how a
-- loop fills a table. No UPDATE at all: a redraw is a new row (a new
-- user-approved version), and the old one is the owner's to delete.

create or replace function public.save_story_actor(
  _name text,
  _lock text,
  _style text,
  _path text,
  _mime text
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
  n int;
  new_id uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;

  nm := left(trim(coalesce(_name, '')), 60);
  lk := left(trim(coalesce(_lock, '')), 400);
  st := nullif(left(trim(coalesce(_style, '')), 120), '');
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

  insert into story_actor_assets (user_id, name, lock, style, storage_path, mime)
  values (me, nm, lk, st, _path, _mime)
  returning id into new_id;

  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

revoke all on function public.save_story_actor(text, text, text, text, text) from public, anon;
grant execute on function public.save_story_actor(text, text, text, text, text) to authenticated;
