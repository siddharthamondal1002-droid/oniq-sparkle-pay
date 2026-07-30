-- P2: one shared view-recording layer for moments, reels and updates.
-- A view is a PERSON (unique per post+viewer), not an impression; repeat
-- views bump last_viewed_at. Owners are never recorded on their own posts;
-- blocked-in-either-direction pairs are never recorded.
CREATE TABLE IF NOT EXISTS public.post_views (
  post_type text NOT NULL CHECK (post_type IN ('moment','reel','update')),
  post_id uuid NOT NULL,
  viewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_viewed_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_type, post_id, viewer_id)
);
CREATE INDEX IF NOT EXISTS post_views_post_idx ON public.post_views (post_type, post_id, last_viewed_at DESC);

ALTER TABLE public.post_views ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.post_views TO authenticated;
GRANT ALL ON public.post_views TO service_role;

-- INSERT: only as yourself (the RPC below is the normal path; this policy
-- is the backstop if the table is hit directly).
DROP POLICY IF EXISTS post_views_insert_self ON public.post_views;
CREATE POLICY post_views_insert_self ON public.post_views
  FOR INSERT TO authenticated WITH CHECK (viewer_id = auth.uid());

-- SELECT: the post owner, and the viewer for their own rows. Nothing else —
-- not other viewers, not admins.
DROP POLICY IF EXISTS post_views_select ON public.post_views;
CREATE POLICY post_views_select ON public.post_views
  FOR SELECT TO authenticated
  USING (
    viewer_id = auth.uid()
    OR (post_type = 'moment' AND EXISTS (SELECT 1 FROM public.moments_posts p WHERE p.id = post_id AND p.user_id = auth.uid()))
    OR (post_type = 'reel'   AND EXISTS (SELECT 1 FROM public.clips c        WHERE c.id = post_id AND c.user_id = auth.uid()))
    OR (post_type = 'update' AND EXISTS (SELECT 1 FROM public.status_updates s WHERE s.id = post_id AND s.user_id = auth.uid()))
  );
-- No UPDATE/DELETE policies: rows are immutable to users.

-- The single write path. Skips: anonymous, owner-on-own-post, blocked pairs,
-- missing/deleted posts. First qualified view inserts; repeats bump
-- last_viewed_at only.
CREATE OR REPLACE FUNCTION public.record_post_view(_post_type text, _post_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  post_owner uuid;
BEGIN
  IF me IS NULL THEN RETURN; END IF;
  IF _post_type = 'moment' THEN
    SELECT user_id INTO post_owner FROM moments_posts WHERE id = _post_id AND is_deleted = false;
  ELSIF _post_type = 'reel' THEN
    SELECT user_id INTO post_owner FROM clips WHERE id = _post_id AND is_deleted = false;
  ELSIF _post_type = 'update' THEN
    SELECT user_id INTO post_owner FROM status_updates WHERE id = _post_id;
  ELSE
    RETURN;
  END IF;
  IF post_owner IS NULL OR post_owner = me THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM blocked_users b
    WHERE (b.blocker_id = me AND b.blocked_id = post_owner)
       OR (b.blocker_id = post_owner AND b.blocked_id = me)
  ) THEN RETURN; END IF;

  INSERT INTO post_views (post_type, post_id, viewer_id)
  VALUES (_post_type, _post_id, me)
  ON CONFLICT (post_type, post_id, viewer_id)
  DO UPDATE SET last_viewed_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.record_post_view(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_post_view(text, uuid) TO authenticated;
