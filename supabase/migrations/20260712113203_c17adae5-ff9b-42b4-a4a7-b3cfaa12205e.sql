-- Restrict public/authenticated SELECT on profiles to non-sensitive columns.
-- Sensitive columns (upi_vpa, omiq_wallet_address, is_admin) are no longer
-- readable via the Data API by ordinary users. Owners still access their own
-- payment identifiers through the public.get_my_profile_private() RPC, and
-- admin checks continue to run through the public.is_admin(uid) security
-- definer function. service_role retains full access for edge functions.

REVOKE SELECT ON public.profiles FROM authenticated;
REVOKE SELECT ON public.profiles FROM anon;

GRANT SELECT (
  id,
  username,
  display_name,
  avatar_url,
  bio,
  country_code,
  language,
  oniq_pay_enabled,
  created_at,
  updated_at,
  last_policy_notice_at
) ON public.profiles TO authenticated;

GRANT SELECT (
  id,
  username,
  display_name,
  avatar_url,
  bio,
  country_code,
  language,
  created_at
) ON public.profiles TO anon;

-- Ensure write privileges & service_role are intact.
GRANT INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;