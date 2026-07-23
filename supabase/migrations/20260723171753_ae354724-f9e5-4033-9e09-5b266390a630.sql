
REVOKE SELECT ON public.profiles FROM authenticated;
REVOKE SELECT ON public.profiles FROM anon;

GRANT SELECT (
  id, username, display_name, avatar_url, bio,
  country_code, language, oniq_pay_enabled,
  created_at, updated_at, is_admin, last_policy_notice_at
) ON public.profiles TO authenticated;

DROP FUNCTION IF EXISTS public.get_my_profile_private();

CREATE OR REPLACE FUNCTION public.get_my_profile_private()
RETURNS TABLE(
  upi_vpa text,
  omiq_wallet_address text,
  oniq_pay_enabled boolean,
  date_of_birth date,
  is_minor boolean,
  parent_name text,
  parent_email text,
  parent_phone text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT upi_vpa, omiq_wallet_address, oniq_pay_enabled,
         date_of_birth, is_minor, parent_name, parent_email, parent_phone
  FROM public.profiles WHERE id = auth.uid();
$function$;

REVOKE EXECUTE ON FUNCTION public.get_my_profile_private() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_private() TO authenticated;
