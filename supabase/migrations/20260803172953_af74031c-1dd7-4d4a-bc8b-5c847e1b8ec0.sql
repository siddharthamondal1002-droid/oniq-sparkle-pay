-- Viewer-identity privacy: the raw post_views rows expose viewer_id to post
-- owners, bypassing the show_view_identity preference honoured by
-- public.post_viewers(). Owners now read viewer identity ONLY through that
-- RPC (which anonymises opted-out viewers and minors), and read totals
-- through a new owner-scoped count function.

DROP POLICY IF EXISTS post_views_select ON public.post_views;
CREATE POLICY post_views_select ON public.post_views
  FOR SELECT TO authenticated
  USING (viewer_id = auth.uid());

-- Owner-only total viewer count (identity never returned).
CREATE OR REPLACE FUNCTION public.post_view_count(_post_type text, _post_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  post_owner uuid;
  n integer;
BEGIN
  IF me IS NULL THEN RETURN 0; END IF;
  IF _post_type = 'moment' THEN
    SELECT p.user_id INTO post_owner FROM moments_posts p WHERE p.id = _post_id;
  ELSIF _post_type = 'reel' THEN
    SELECT c.user_id INTO post_owner FROM clips c WHERE c.id = _post_id;
  ELSIF _post_type = 'update' THEN
    SELECT s.user_id INTO post_owner FROM status_updates s WHERE s.id = _post_id;
  ELSE
    RETURN 0;
  END IF;
  IF post_owner IS NULL OR post_owner <> me THEN RETURN 0; END IF;

  SELECT count(*) INTO n FROM post_views v
  WHERE v.post_type = _post_type AND v.post_id = _post_id;
  RETURN COALESCE(n, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.post_view_count(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_view_count(text, uuid) TO authenticated;