
CREATE TABLE IF NOT EXISTS public.follows (
  follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  followee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.follows TO authenticated;
GRANT ALL ON public.follows TO service_role;
DROP POLICY IF EXISTS "follows_select_all" ON public.follows;
CREATE POLICY "follows_select_all" ON public.follows FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "follows_insert_own" ON public.follows;
CREATE POLICY "follows_insert_own" ON public.follows FOR INSERT TO authenticated
  WITH CHECK (follower_id = auth.uid());
DROP POLICY IF EXISTS "follows_delete_own" ON public.follows;
CREATE POLICY "follows_delete_own" ON public.follows FOR DELETE TO authenticated
  USING (follower_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  video_url TEXT NOT NULL,
  caption TEXT CHECK (char_length(caption) <= 300),
  hashtags TEXT[] DEFAULT '{}',
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clips_created ON public.clips(created_at DESC);
ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.clips TO authenticated;
GRANT ALL ON public.clips TO service_role;
DROP POLICY IF EXISTS "clips_select" ON public.clips;
CREATE POLICY "clips_select" ON public.clips FOR SELECT TO authenticated
  USING (is_deleted = FALSE OR user_id = auth.uid());
DROP POLICY IF EXISTS "clips_insert_own" ON public.clips;
CREATE POLICY "clips_insert_own" ON public.clips FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "clips_update_own" ON public.clips;
CREATE POLICY "clips_update_own" ON public.clips FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.clips_likes (
  clip_id UUID NOT NULL REFERENCES public.clips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (clip_id, user_id)
);
ALTER TABLE public.clips_likes ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.clips_likes TO authenticated;
GRANT ALL ON public.clips_likes TO service_role;
DROP POLICY IF EXISTS "clip_likes_select" ON public.clips_likes;
CREATE POLICY "clip_likes_select" ON public.clips_likes FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.clips_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id UUID NOT NULL REFERENCES public.clips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clip_comments ON public.clips_comments(clip_id, created_at DESC);
ALTER TABLE public.clips_comments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.clips_comments TO authenticated;
GRANT ALL ON public.clips_comments TO service_role;
DROP POLICY IF EXISTS "clip_comments_select" ON public.clips_comments;
CREATE POLICY "clip_comments_select" ON public.clips_comments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "clip_comments_insert_own" ON public.clips_comments;
CREATE POLICY "clip_comments_insert_own" ON public.clips_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "clip_comments_delete_own" ON public.clips_comments;
CREATE POLICY "clip_comments_delete_own" ON public.clips_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.clips_views (
  clip_id UUID NOT NULL REFERENCES public.clips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (clip_id, user_id)
);
ALTER TABLE public.clips_views ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.clips_views TO authenticated;
GRANT ALL ON public.clips_views TO service_role;
DROP POLICY IF EXISTS "clip_views_select_own" ON public.clips_views;
CREATE POLICY "clip_views_select_own" ON public.clips_views FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.bump_clip_comment_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE clips SET comment_count = comment_count + 1 WHERE id = NEW.clip_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE clips SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.clip_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$;
REVOKE EXECUTE ON FUNCTION public.bump_clip_comment_count() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_clip_comment_count ON public.clips_comments;
CREATE TRIGGER trg_clip_comment_count
  AFTER INSERT OR DELETE ON public.clips_comments
  FOR EACH ROW EXECUTE FUNCTION public.bump_clip_comment_count();

CREATE OR REPLACE FUNCTION public.toggle_clip_like(_clip_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  existed boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  DELETE FROM clips_likes WHERE clip_id = _clip_id AND user_id = me;
  existed := FOUND;
  IF existed THEN
    UPDATE clips SET like_count = GREATEST(0, like_count - 1) WHERE id = _clip_id;
    RETURN false;
  ELSE
    INSERT INTO clips_likes (clip_id, user_id) VALUES (_clip_id, me);
    UPDATE clips SET like_count = like_count + 1 WHERE id = _clip_id;
    RETURN true;
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.toggle_clip_like(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_clip_like(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_clip_view(_clip_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RETURN; END IF;
  INSERT INTO clips_views (clip_id, user_id) VALUES (_clip_id, me)
  ON CONFLICT DO NOTHING;
  IF FOUND THEN
    UPDATE clips SET view_count = view_count + 1 WHERE id = _clip_id;
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.record_clip_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_clip_view(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.clips_feed(_limit int DEFAULT 10, _offset int DEFAULT 0)
RETURNS SETOF public.clips
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM clips
  WHERE is_deleted = FALSE
  ORDER BY
    (like_count * 3 + comment_count * 5 + view_count)
      / POWER(GREATEST(EXTRACT(EPOCH FROM (now() - created_at)) / 3600, 1), 1.2) DESC,
    created_at DESC
  LIMIT LEAST(GREATEST(_limit, 1), 20) OFFSET GREATEST(_offset, 0);
$$;
REVOKE EXECUTE ON FUNCTION public.clips_feed(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clips_feed(int, int) TO authenticated;

DROP POLICY IF EXISTS "clips_storage_read" ON storage.objects;
CREATE POLICY "clips_storage_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'clips');
DROP POLICY IF EXISTS "clips_storage_insert_own" ON storage.objects;
CREATE POLICY "clips_storage_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'clips' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "clips_storage_delete_own" ON storage.objects;
CREATE POLICY "clips_storage_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'clips' AND (storage.foldername(name))[1] = auth.uid()::text);
