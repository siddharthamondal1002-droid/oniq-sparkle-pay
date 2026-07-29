-- FIX: every profiles UPDATE currently fails with 42501. The
-- profiles_update_own WITH CHECK ran a subquery reading profiles.is_admin,
-- but a later security pass revoked SELECT on is_admin from authenticated —
-- so the policy itself is denied. The subquery guard is redundant anyway:
-- column-level UPDATE grants exclude is_admin, so escalation is already
-- impossible. Simplify the policy to plain ownership.
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- FIX: the policy-notice banner reads last_policy_notice_at; the same
-- revocation removed it, so the read fails and the banner shows forever.
GRANT SELECT (last_policy_notice_at) ON public.profiles TO authenticated;

-- Reels "seen by": owner-only viewers list. clips_views already records
-- (clip_id, user_id, created_at); this exposes it to the CLIP OWNER only.
CREATE OR REPLACE FUNCTION public.clip_viewers(_clip_id uuid)
RETURNS TABLE(user_id uuid, username text, display_name text, avatar_url text, viewed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.user_id, p.username, p.display_name, p.avatar_url, v.created_at
  FROM public.clips_views v
  JOIN public.profiles p ON p.id = v.user_id
  WHERE v.clip_id = _clip_id
    AND EXISTS (SELECT 1 FROM public.clips c WHERE c.id = _clip_id AND c.user_id = auth.uid())
  ORDER BY v.created_at DESC
  LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.clip_viewers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clip_viewers(uuid) TO authenticated;
