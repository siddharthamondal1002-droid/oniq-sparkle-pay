-- FIX: every profiles UPDATE currently fails with 42501 (policy WITH CHECK
-- reads is_admin, whose SELECT grant was revoked). Column-level UPDATE
-- grants already exclude is_admin, so plain ownership is safe.
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

GRANT SELECT (last_policy_notice_at) ON public.profiles TO authenticated;

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