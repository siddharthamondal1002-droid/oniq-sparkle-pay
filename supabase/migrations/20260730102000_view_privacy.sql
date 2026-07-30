-- P4: viewer-identity privacy gate.
-- "Let people see when I've viewed their posts" — default ON. When OFF the
-- user still counts toward view totals but appears anonymised, and
-- SYMMETRICALLY loses the ability to see other viewers' names.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS show_view_identity boolean NOT NULL DEFAULT true;
GRANT SELECT (show_view_identity), UPDATE (show_view_identity) ON public.profiles TO authenticated;

-- Owner-only viewer list with every privacy rule applied server-side:
--   * caller must own the post (else zero rows)
--   * blocked-either-direction viewers are omitted entirely
--   * minors are NEVER named (anonymous entry) — DPDP children's data
--   * viewers with show_view_identity=false are anonymous entries
--   * if the CALLER hides their own view identity, all entries come back
--     anonymous (symmetric enforcement)
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
    CASE WHEN anon THEN NULL ELSE v.viewer_id END,
    CASE WHEN anon THEN NULL ELSE p.username END,
    CASE WHEN anon THEN NULL ELSE p.display_name END,
    CASE WHEN anon THEN NULL ELSE p.avatar_url END,
    v.last_viewed_at,
    anon
  FROM post_views v
  JOIN profiles p ON p.id = v.viewer_id
  CROSS JOIN LATERAL (
    SELECT (caller_hides OR p.is_minor OR NOT COALESCE(p.show_view_identity, true)) AS anon
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
REVOKE ALL ON FUNCTION public.post_viewers(text, uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_viewers(text, uuid, int, int) TO authenticated;

-- Retire the reel-only viewer RPC in favour of the gated one above.
DROP FUNCTION IF EXISTS public.clip_viewers(uuid);
