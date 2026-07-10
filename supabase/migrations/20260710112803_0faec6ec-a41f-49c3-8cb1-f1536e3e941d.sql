-- Restrict sensitive payment identifier columns on profiles to owner-only access via column-level privileges.
REVOKE SELECT ON public.profiles FROM anon, authenticated;

GRANT SELECT (
  id, username, display_name, avatar_url, bio,
  country_code, language, is_admin, last_policy_notice_at,
  created_at, updated_at, oniq_pay_enabled
) ON public.profiles TO authenticated;

GRANT SELECT (
  id, username, display_name, avatar_url, bio, created_at
) ON public.profiles TO anon;

-- Owners can still read their own sensitive fields via the existing SECURITY DEFINER
-- function public.get_my_profile_private(). Updates remain governed by existing RLS.
