-- Restrict column-level SELECT on profiles: public discovery fields only.
REVOKE SELECT ON public.profiles FROM authenticated;
REVOKE SELECT ON public.profiles FROM anon;

GRANT SELECT (
  id, username, display_name, avatar_url, bio, language,
  show_view_identity, created_at, updated_at
) ON public.profiles TO authenticated;

GRANT ALL ON public.profiles TO service_role;

-- Owner-only access to the private profile fields.
CREATE OR REPLACE FUNCTION public.get_my_profile_meta()
RETURNS TABLE (
  country_code text,
  oniq_pay_enabled boolean,
  is_admin boolean,
  last_policy_notice_at timestamptz,
  language text,
  show_view_identity boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.country_code,
         p.oniq_pay_enabled,
         p.is_admin,
         p.last_policy_notice_at,
         p.language,
         p.show_view_identity
  FROM public.profiles p
  WHERE p.id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.get_my_profile_meta() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile_meta() TO authenticated;