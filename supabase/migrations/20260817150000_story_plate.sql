-- ============================================================================
-- THE PLATE — one image the user supplies, used as the opening shot.
--
-- Asked for 2026-08-17: "no add video or image option in what happens in
-- story". There was none; the composer took text and nothing else.
--
-- WHY AN IMAGE AND NOT A VIDEO. The clip stage is Veo IMAGE-to-video: it is
-- handed a still and animates it. Every shot in every film already works that
-- way, with the still drawn by story-still. There is no video-in path anywhere
-- in the engine, so a video upload could only ever be decoration. An image
-- slots into a seam that already exists.
--
-- WHY THIS COSTS NOTHING EXTRA. A plate REPLACES the still the pipeline would
-- have drawn for shot 1 — it does not add a call. One fewer story-still
-- request per film, one clip request unchanged. That is what makes this an
-- engineering change rather than a spending decision.
--
-- WHAT IT DELIBERATELY IS NOT: a character reference. Locking a real person's
-- face across every shot of a film is a likeness question, not a technical
-- one, and it is the owner's to answer. A plate is one frame, and the film
-- moves on from it.
-- ============================================================================

-- The image itself. Small and private — this is not chat media and must not
-- share its bucket, whose policies let conversation members read each other's
-- files. A plate is readable by exactly its owner and the service role.
insert into storage.buckets (id, name, public)
values ('story-plates', 'story-plates', false)
on conflict (id) do nothing;

drop policy if exists "plates are written by their owner" on storage.objects;
create policy "plates are written by their owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'story-plates'
    -- Path is <uid>/<uuid>.<ext>: the first segment IS the owner, so a user
    -- cannot write into somebody else's folder even with a forged path.
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "plates are read by their owner" on storage.objects;
create policy "plates are read by their owner" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'story-plates'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "plates are deleted by their owner" on storage.objects;
create policy "plates are deleted by their owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'story-plates'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- The pointer. Nullable because a film without a plate is the normal case.
alter table public.story_jobs
  add column if not exists plate_path text;

comment on column public.story_jobs.plate_path is
  'Object name in the story-plates bucket used as the opening shot''s still. '
  'Null means the pipeline draws that still itself, which is the usual case.';

-- ---------------------------------------------------------------------------
-- Attaching it. Same shape and same guards as set_story_cast, for the same
-- reason: the dispatch cron can claim a job within a minute, and a plate that
-- lands after the plan is written would silently not be in the film. Refusing
-- beats pretending.
-- ---------------------------------------------------------------------------
create or replace function public.set_story_plate(_job_id uuid, _path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text;
begin
  if me is null then raise exception 'not authenticated'; end if;

  clean := trim(coalesce(_path, ''));
  if length(clean) = 0 or length(clean) > 400 then
    return jsonb_build_object('ok', false, 'reason', 'bad-path');
  end if;

  -- The path must live under the caller's own folder. Storage RLS already
  -- enforces this on write; re-checking here stops a row from POINTING at
  -- another user's object even if one were somehow uploaded, which is the
  -- difference between a failed read and a leaked image.
  if split_part(clean, '/', 1) <> me::text then
    return jsonb_build_object('ok', false, 'reason', 'not-your-path');
  end if;

  update story_jobs
     set plate_path = clean
   where id = _job_id and user_id = me and status = 'queued';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not-yours-or-started');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_story_plate(uuid, text) from public, anon;
grant execute on function public.set_story_plate(uuid, text) to authenticated;
