-- P4 fix: is_minor lives in profiles_private (PII split), not profiles.
-- post_viewers now sources the minor flag from there; behaviour unchanged —
-- minors are never named in any viewer list.
CREATE OR REPLACE FUNCTION public.post_viewers(
  _post_type text, _post_id uuid, _limit int DEFAULT 30, _offset int DEFAULT 0
)
RETURNS TABLE(
  viewer_id uuid, username text, display_name text, avatar_url text,
  viewed_at timestamptz, anonymous boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  post_owner uuid;
  caller_hides boolean;
BEGIN
  IF me IS NULL THEN RETURN; END IF;
  IF _post_type = 'moment' THEN
    SELECT p.user_id INTO post_owner FROM moments_posts p WHERE p.id = _post_id;
  ELSIF _post_type = 'reel' THEN
    SELECT c.user_id INTO post_owner FROM clips c WHERE c.id = _post_id;
  ELSIF _post_type = 'update' THEN
    SELECT s.user_id INTO post_owner FROM status_updates s WHERE s.id = _post_id;
  END IF;
  IF post_owner IS NULL OR post_owner <> me THEN RETURN; END IF;

  SELECT NOT COALESCE(pr.show_view_identity, true) INTO caller_hides
  FROM profiles pr WHERE pr.id = me;

  RETURN QUERY
  SELECT
    CASE WHEN a.anon THEN NULL ELSE v.viewer_id END,
    CASE WHEN a.anon THEN NULL ELSE p.username END,
    CASE WHEN a.anon THEN NULL ELSE p.display_name END,
    CASE WHEN a.anon THEN NULL ELSE p.avatar_url END,
    v.last_viewed_at,
    a.anon
  FROM post_views v
  JOIN profiles p ON p.id = v.viewer_id
  LEFT JOIN profiles_private pp ON pp.user_id = v.viewer_id
  CROSS JOIN LATERAL (
    SELECT (caller_hides
            OR COALESCE(pp.is_minor, false)
            OR NOT COALESCE(p.show_view_identity, true)) AS anon
  ) a
  WHERE v.post_type = _post_type AND v.post_id = _post_id
    AND NOT EXISTS (
      SELECT 1 FROM blocked_users b
      WHERE (b.blocker_id = me AND b.blocked_id = v.viewer_id)
         OR (b.blocker_id = v.viewer_id AND b.blocked_id = me))
  ORDER BY v.last_viewed_at DESC
  LIMIT LEAST(GREATEST(_limit, 1), 100) OFFSET GREATEST(_offset, 0);
END;
$$;
